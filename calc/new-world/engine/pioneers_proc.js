// U5-C: Pioneers time engine (ProcessPioneers + carts + tile stats). Port of GameData::* @3c0cb10 and friends. See U5_C_NOTES.md.
// Functions take the game object `g` first; g.Pioneers = PioneersStateData (pioneers_state.js), g.m = Master.
// Hidden fields (no C# getter) that this module adds on demand, names are ours (offsets = IL2CPP field offsets):
//   cart:  LegProgress +0x28 (0..1 inside a leg, 0.5 = cell border), Ground +0x30 (speed factor of current half-leg),
//          ArrivedAt +0x48 (ContentSeconds when it joined a queue), Unloaded +0x50 (bool, partial unload happened),
//          RouteVersion +0x54, HasMultiplier +0x78 (bool);  cart.X90 (+0x90) = zones already used (List<int>)
//   tile:  RouteVersion +0x64 (++ on SetPioneersRoute/auto reroute), BurnDuration +0x58 (burn duration of the running burn; u5-B uses the same name)
//   state: NextCartId = state.Format (+0x48)  (u5a names it Format; we use it as the cart id counter, see notes)
import { BigNumber } from './bignum.js';
import { makeCartData, makeStockData, makeHasteData, makeRouteData, E_FACILITY, E_TERRAIN } from './pioneers_state.js';
import * as MAP from './pioneers_map.js';

const econ = await import('./pioneers_econ.js').catch(() => ({}));
/** test/glue overrides for functions owned by other parts: { name: fn } (lowerCamel C# names, `g` first). */
export const deps = {};
const dcache = new Map();   // perf: econ/MAP resolution is constant; `deps` overrides stay live
const D = (n) => { const o = deps[n]; if (o) return o; let f = dcache.get(n); if (!f) { f = econ[n] ?? MAP[n]; if (!f) throw new Error('pioneers_proc: missing dependency ' + n); dcache.set(n, f); } return f; };

const ZERO = BigNumber.ZERO, ONE = BigNumber.ONE;
const TICKS = 1e7, EPS = 1e-7;
const EXTRACTOR = E_FACILITY.EXTRACTOR, SHRINE = E_FACILITY.SHRINE, ROAD = E_FACILITY.ROAD, MAGIC = E_FACILITY.MAGIC_CIRCLE;
export const PHASE = { WAIT_EXTRACTOR: 0, LOADING: 1, OUTBOUND: 2, WAIT_SHRINE: 3, UNLOADING: 4, RETURN: 5 };
const setting = (g) => (g._pset ??= g.m.setting('PioneersSetting'));   // perf: cached sheet lookup
const bnMin = (a, b) => (a.lt(b) ? a : b);
const bnMax = (a, b) => (a.gt(b) ? a : b);
const roundEven = (x) => { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; };
const tileOf = (g, cell) => MAP.pioneersTile(g, cell);
const minLoad = (g) => BigNumber.parse(setting(g).MinLoadAmount);

// ---------------------------------------------------------------- hidden-field helpers
export function fixCart(c) {
  if (c.LegProgress === undefined) { c.LegProgress = 0; c.Ground = 0; c.ArrivedAt = 0; c.Unloaded = false; c.RouteVersion = -1; c.HasMultiplier = false; }
  if (!c.X90) c.X90 = [];
  return c;
}
export function newCart(g, tile) {          // SynchronizePioneersCarts @3bfef20 body
  const S = g.Pioneers, c = fixCart(makeCartData());
  c.Id = S.Format; S.Format++;
  g.PioneersCandDirty = true; c.TargetCell = -1; c.Phase = 0; c.OwnerCell = tile.Cell;
  c.X = tile.X; c.Y = tile.Y;
  c.ArrivedAt = S.ContentSeconds;
  c.Ground = setting(g).OffRoadSpeedMultiplier;
  c.RouteVersion = -1;
  return c;
}
const progressBudget = (g, d) => { const P = g.Pioneers.Progress; if (P) P.Budget += d; };

// ---------------------------------------------------------------- PioneersBaseStats @3c010a0
function zeroStats() {
  return {
    Rate: ZERO, Stock: ZERO, Capacity: ZERO, CartCapacity: ZERO, BurnAmount: ZERO, Effect: ZERO, Inflow: ZERO, BurnRate: ZERO, Net: ZERO,
    CartCount: 0, Level: 0, MaxLevel: 0, Waiting: 0, Unloading: 0, CartSpeed: 0, LoadSeconds: 0, UnloadSeconds: 0, BurnSeconds: 0,
    BurnRemaining: 0, BoostDuration: 0, BoostSpeed: 0,
  };
}
const lvl = (tile, id) => (tile.UpgradeLevels && tile.UpgradeLevels.get(id)) || 0;
const maxLevelOf = (g, fid) => { const r = g.m.tryGet('PioneersFacility', fid); return r ? (r.MaxLevel | 0) : 0; };
/** perf: read-only stats without the per-call copy (callers must not read Stock/BurnRemaining or mutate); S.Act = ordered extractor/shrine tiles (reset where BuildingId changes) */
function statsRO(g, tile) { if (tile._sc === g.PioneersStatsCache && tile._sc !== undefined) return tile._s; const h = g.PioneersStatsCache && g.PioneersStatsCache.get(tile.Cell); if (h) { tile._sc = g.PioneersStatsCache; tile._s = h; return h; } return pioneersBaseStats(g, tile); }
const activeTiles = (S) => S.Act ??= S.Tiles.filter((t) => t.BuildingId === EXTRACTOR || t.BuildingId === SHRINE);
const shrineTiles = (S) => S.Shr ??= S.Tiles.filter((t) => t.BuildingId === SHRINE);
const extractorTiles = (S) => S.Ext ??= S.Tiles.filter((t) => t.BuildingId === EXTRACTOR);
export function pioneersBaseStats(g, tile) {
  const S = g.Pioneers;
  if (!tile || !S) return zeroStats();
  g.PioneersStatsCache ??= new Map();
  const hit = g.PioneersStatsCache.get(tile.Cell);
  if (hit) { const r = { ...hit }; r.Stock = tile.Stock; r.BurnRemaining = tile.BurnRemaining; return r; }
  const st = zeroStats(), s = setting(g);
  st.Level = tile.Level;
  st.LoadSeconds = D('pioneersSeconds')(g, s.LoadSeconds, 923);
  st.UnloadSeconds = D('pioneersSeconds')(g, s.UnloadSeconds, 923);
  const FE = D('pioneersFacilityEffect'), UV = D('upgradeValue'), UE = D('pioneersUpgradeEffect');
  st.Stock = tile.Stock;
  if (tile.BuildingId === EXTRACTOR) {
    st.MaxLevel = maxLevelOf(g, EXTRACTOR);
    st.Rate = FE(g, tile, EXTRACTOR, tile.Level);
    st.Capacity = UV(g, tile, 94001);
    st.CartCount = UV(g, tile, 94002).toInt();
    st.CartSpeed = UE(g, 94003, lvl(tile, 94003)).toDouble();
    st.CartCapacity = UE(g, 94004, lvl(tile, 94004));
  } else if (tile.BuildingId === SHRINE) {
    st.MaxLevel = maxLevelOf(g, SHRINE);
    st.Capacity = UV(g, tile, 94005);
    st.BurnAmount = UE(g, 94006, lvl(tile, 94006));
    st.BurnSeconds = D('pioneersSeconds')(g, s.BurnSeconds, 924);
    st.BurnRemaining = tile.BurnRemaining;
    st.BurnRate = bnMin(st.Capacity, st.BurnAmount).div(st.BurnSeconds);
    st.Effect = FE(g, tile, SHRINE, tile.Level);
  } else if (tile.Terrain === E_TERRAIN.MAGIC) {
    st.Level = tile.MagicLevel;
    st.MaxLevel = maxLevelOf(g, MAGIC);
    st.Effect = pioneersMagicMultiplier(g, tile);
    st.BoostDuration = UV(g, tile, 94007).toDouble();
    st.BoostSpeed = UV(g, tile, 94008).toDouble();
  } else if (tile.RoadLevel >= 1) {
    st.Level = tile.RoadLevel;
    st.MaxLevel = maxLevelOf(g, ROAD);
    st.Effect = D('facilityValue')(g, ROAD, tile.RoadLevel);
  }
  g.PioneersStatsCache.set(tile.Cell, { ...st });
  return st;
}

// PioneersMagicMultiplier @3c017fc
export function pioneersMagicMultiplier(g, tile) {
  if (tile && tile.MagicLevel > 0) return D('pioneersFacilityEffect')(g, tile, MAGIC, tile.MagicLevel);
  return ONE;
}

// ---------------------------------------------------------------- GetPioneersTileStats @3c01888
export function getPioneersTileStats(g, cell) {
  const S = g.Pioneers, tile = tileOf(g, cell);
  const st = pioneersBaseStats(g, tile);
  if (tile && tile.BuildingId === SHRINE) {
    buildPioneersReports(g);
    let inflow = ZERO;
    for (const rep of g.PioneersReports.values()) {
      const ex = S.Tiles[rep.Cell];
      if (ex && ex.RouteTarget === cell) inflow = inflow.add(rep.Inflow);      // report value +0x68
    }
    st.Inflow = inflow;
    st.Net = inflow.sub(st.BurnRate);
    let w = 0, u = 0;
    for (const c of S.Carts) if (c.TargetCell === cell) { if (c.Phase === 3) w++; else if (c.Phase === 4) u++; }
    st.Waiting = w; st.Unloading = u;
  }
  return st;
}

// ---------------------------------------------------------------- haste / magic @3c05e08, @3c05f50
export function refreshPioneersHaste(g, cart) {
  if (!cart) return;
  cart.HasteRemaining = 0; cart.HasteMultiplier = 1;
  const list = cart.HasteEffects;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h.RemainingSeconds <= EPS) { list.splice(i, 1); continue; }
    if (h.Multiplier > cart.HasteMultiplier) { cart.HasteRemaining = h.RemainingSeconds; cart.HasteMultiplier = h.Multiplier; }
    else if (h.Multiplier === cart.HasteMultiplier) cart.HasteRemaining = Math.max(cart.HasteRemaining, h.RemainingSeconds);
  }
}
export function applyPioneersMagic(g, cart, cell) {
  const S = g.Pioneers, tile = tileOf(g, cell);
  if (!cart || cart.Phase !== 2 || !tile || tile.MagicLevel < 1) return;
  if (cart.RawLoad.le(ZERO)) return;
  const zone = g.PioneersZones[cell];
  if (cart.X90.includes(zone)) return;
  cart.X90.push(zone);
  let mult = pioneersMagicMultiplier(g, tile);
  if (cart.HasMultiplier) mult = cart.Multiplier.add(mult);
  cart.Multiplier = mult; cart.HasMultiplier = true;
  const list = cart.HasteEffects;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].Zone === zone) list.splice(i, 1);
  const h = makeHasteData();
  h.Zone = zone;
  h.Multiplier = D('upgradeValue')(g, tile, 94008).toDouble();
  h.RemainingSeconds = D('upgradeValue')(g, tile, 94007).toDouble();
  list.push(h);
  refreshPioneersHaste(g, cart);
  progressBudget(g, -1);
}

// ---------------------------------------------------------------- UpdatePioneersCartPosition @3bf5014
export function updatePioneersCartPosition(g, cart) {
  const S = g.Pioneers;
  let path = cart.Phase === 5 ? cart.ReturnPath : cart.Phase === 2 ? cart.OutboundPath : null;
  let done = false;
  if (path) {
    const leg = cart.LegIndex;
    if (leg + 1 < path.length) {
      const A = tileOf(g, path[leg]), B = tileOf(g, path[leg + 1]), p = cart.LegProgress;
      cart.X = p * (B.X - A.X) + A.X; cart.Y = p * (B.Y - A.Y) + A.Y;
      done = true;
    }
  }
  if (!done) {
    const cell = (cart.Phase === 3 || cart.Phase === 4) ? cart.TargetCell : cart.OwnerCell;
    if (cell >= 0 && cell < S.Tiles.length) { cart.X = S.Tiles[cell].X; cart.Y = S.Tiles[cell].Y; }
  }
  refreshPioneersHaste(g, cart);
}

// ---------------------------------------------------------------- stock / reward / burn @3c06c38, @3c0781c, @3c07b70
export function addPioneersStock(g, tile, owner, ore, amount, mult) {
  if (amount.le(ZERO)) return;
  const packets = tile.Packets;
  const last = packets.length ? packets[packets.length - 1] : null;
  if (last && last.OwnerCell === owner && last.OreId === ore && last.Multiplier.eq(mult)) last.Amount = last.Amount.add(amount);
  else { const e = makeStockData(); e.OwnerCell = owner; e.OreId = ore; e.Amount = amount; e.Multiplier = mult; packets.push(e); }
  const wasEmpty = tile.Stock.le(ZERO);
  tile.Stock = tile.Stock.add(amount);
  if (wasEmpty || !(tile.BurnRemaining > 0)) {
    const st = pioneersBaseStats(g, tile);
    tile.BurnRemaining = st.BurnSeconds; tile.BurnDuration = st.BurnSeconds;
  }
}
export function rewardPioneersOre(g, ore, a, b) {
  const S = g.Pioneers;
  if (a.le(ZERO)) return;
  if (ore !== -1) {
    const conv = g.m.tryGet('PioneersConversion', ore);
    if (!conv) return;
    const type = conv.MilestoneType;
    const cur = S.Points.get(type) ?? ZERO;
    const delta = a.mul(b).mul(D('getPioneersOreReward')(g, ore)).div(100.0);
    S.Points.set(type, cur.add(delta));
    D('touchPioneers')(g, true, false);
  } else {
    g.PioneersManaStone = g.PioneersManaStone.add(a.mul(b).mul(setting(g).ManaStonePerOre));
    g.PioneersChanged = true;                     // flag @+0x1271
  }
}
export function burnPioneersStock(g, tile) {
  const st = pioneersBaseStats(g, tile);
  burnStock(g, tile, st.BurnAmount, st.Effect);
}
function burnStock(g, tile, amount, mult) {            // BurnPioneersStock @3c07bc0
  let burn = bnMin(tile.Stock, amount);
  tile.LastBurnSequence++;
  tile.LastBurnAmount = burn;
  tile.LastBurnRewards.length = 0;
  let remaining = burn;
  if (burn.gt(ZERO)) {
    while (remaining.gt(ZERO) && tile.Packets.length > 0) {
      const e = tile.Packets[0];
      const take = bnMin(remaining, e.Amount);
      rewardPioneersOre(g, e.OreId, take, mult);
      const pts = take.mul(mult).mul(D('getPioneersOreReward')(g, e.OreId));
      const rec = tile.LastBurnRewards.find((r) => r.OreId === e.OreId);
      if (rec) rec.Amount = rec.Amount.add(pts); else tile.LastBurnRewards.push({ OreId: e.OreId, Amount: pts });
      e.Amount = e.Amount.sub(take);
      remaining = remaining.sub(take);
      tile.Stock = bnMax(ZERO, tile.Stock.sub(take));
      if (e.Amount.le(ZERO)) tile.Packets.shift();
    }
  }
  if (tile.Packets.length !== 0 && tile.Stock.le(ZERO)) { tile.Stock = ZERO; tile.Packets.length = 0; }
  progressBudget(g, -1);
}

// ---------------------------------------------------------------- load candidates / loads / unloads
export function refreshPioneersLoadCandidates(g) {
  const S = g.Pioneers, n = S.Tiles.length;
  if (!g.PioneersCandDirty && g.PioneersLoadCand && g.PioneersLoadCand.length === n && g.PioneersLoadCandS === S) return;   // perf: nothing that feeds the candidates changed
  g.PioneersCandDirty = false; g.PioneersLoadCandS = S;
  if (!g.PioneersLoadCand || g.PioneersLoadCand.length !== n) { g.PioneersLoadCand = new Array(n).fill(null); g.PioneersLoadBusy = new Array(n).fill(false); g.PioneersLoadSet = []; }
  else { const set = g.PioneersLoadSet; for (let i = 0; i < set.length; i++) { g.PioneersLoadCand[set[i]] = null; g.PioneersLoadBusy[set[i]] = false; } set.length = 0; }
  const touched = g.PioneersLoadSet ??= [];
  for (const c of S.Carts) {
    if (c.Phase >= 2) continue;
    const o = c.OwnerCell;
    if (o < 0 || o >= n) continue;
    if (S.Tiles[o].BuildingId !== EXTRACTOR) continue;
    touched.push(o);
    if (c.Phase === 1) { g.PioneersLoadBusy[o] = true; continue; }
    const cur = g.PioneersLoadCand[o];
    if (!cur || c.ArrivedAt < cur.ArrivedAt || (c.ArrivedAt === cur.ArrivedAt && c.Id < cur.Id)) g.PioneersLoadCand[o] = c;
  }
}
export function startPioneersLoads(g) {
  const S = g.Pioneers;
  refreshPioneersLoadCandidates(g);
  const ml = minLoad(g);
  for (const t of extractorTiles(S)) {
    if (t.Stock.lt(ml)) continue;
    const cart = g.PioneersLoadCand[t.Cell];
    if (!cart || g.PioneersLoadBusy[t.Cell]) continue;
    const route = pioneersRoute(g, t);
    if (!route || !route.Allowed) continue;
    const st = statsRO(g, t);
    const amount = bnMin(t.Stock, st.CartCapacity);
    if (amount.lt(ml)) continue;
    cart.RawLoad = amount;
    t.Stock = t.Stock.sub(amount);
    cart.OutboundPath.length = 0; cart.OutboundPath.push(...route.Outbound);
    cart.ReturnPath.length = 0; cart.ReturnPath.push(...route.Return);
    if (cart.RouteVersion !== (t.RouteVersion | 0)) cart.Ground = MAP.initialGround(g, S, route.Outbound);
    cart.RouteVersion = t.RouteVersion | 0;
    cart.TargetCell = t.RouteTarget; cart.LegIndex = 0; cart.LegProgress = 0;
    cart.X90.length = 0;
    cart.Multiplier = ONE; cart.HasMultiplier = false;
    g.PioneersCandDirty = true; cart.Phase = 1; cart.PhaseRemaining = st.LoadSeconds; cart.PhaseDuration = st.LoadSeconds; cart.Unloaded = false;
    progressBudget(g, -1);
  }
}
export function startPioneersUnloads(g) {
  const S = g.Pioneers;
  for (const sh of shrineTiles(S)) {
    let busy = false;
    for (const c of S.Carts) if (c.TargetCell === sh.Cell && c.Phase === 4) { busy = true; break; }
    if (busy) continue;
    const st = statsRO(g, sh);
    for (let i = 0; i < S.Carts.length; i++) {
      if (sh.Stock.ge(st.Capacity)) break;
      let cand = null;
      for (const c of S.Carts) {
        if (c.TargetCell !== sh.Cell || c.Phase !== 3) continue;
        if (!cand || c.ArrivedAt < cand.ArrivedAt || (c.ArrivedAt === cand.ArrivedAt && c.Id < cand.Id)) cand = c;
      }
      if (!cand) break;
      if (cand.Unloaded) { unloadPioneersCart(g, cand); continue; }
      cand.PhaseRemaining = st.UnloadSeconds; cand.PhaseDuration = st.UnloadSeconds; cand.Phase = 4;
      progressBudget(g, -1);
      break;
    }
  }
}
export function unloadPioneersCart(g, cart) {
  const S = g.Pioneers;
  const shrine = tileOf(g, cart.TargetCell);
  if (shrine && shrine.BuildingId === SHRINE) {
    const st = pioneersBaseStats(g, shrine);
    let room = st.Capacity.sub(shrine.Stock);
    room = bnMax(ZERO, room);
    const load = cart.RawLoad.mul(cart.Multiplier);
    const amount = bnMin(room, load);
    const owner = S.Tiles[cart.OwnerCell];
    addPioneersStock(g, shrine, cart.OwnerCell, owner.OreId, amount, cart.Multiplier);
    if (amount.ge(load)) { cart.RawLoad = ZERO; returnPioneersCart(g, cart); }
    else {
      const rem = cart.RawLoad.sub(amount.div(cart.Multiplier));
      g.PioneersCandDirty = true; cart.Phase = 3; cart.Unloaded = true;
      cart.RawLoad = bnMax(ZERO, rem);
      cart.PhaseRemaining = 0; cart.PhaseDuration = 0;
    }
  }
  progressBudget(g, -1);
}
export function returnPioneersCart(g, cart) {          // ReturnPioneersCart @3c06ee0
  const S = g.Pioneers;
  const ok = FindPath(g, cart.TargetCell, cart.OwnerCell, cart.ReturnPath, null, 0, cart.Ground);
  g.PioneersCandDirty = true;
  if (ok) { cart.Phase = 5; cart.LegIndex = 0; cart.LegProgress = 0; } else cart.Phase = 3;
  cart.Unloaded = false; cart.PhaseRemaining = 0; cart.PhaseDuration = 0;
  cart.RawLoad = ZERO;
  updatePioneersCartPosition(g, cart);
}
export function synchronizePioneersCarts(g) {
  const S = g.Pioneers;
  if (!S) return;
  for (const t of S.Tiles) {
    if (t.BuildingId !== EXTRACTOR) continue;
    let have = 0;
    for (const c of S.Carts) if (c.OwnerCell === t.Cell) have++;
    const want = pioneersBaseStats(g, t).CartCount;
    for (let n = want - have; n > 0; n--) { S.Carts.push(newCart(g, t)); g.PioneersCandDirty = true; }
  }
}
export function refreshPioneersDockedCartGround(g) {
  const S = g.Pioneers, off = setting(g).OffRoadSpeedMultiplier;
  for (const c of S.Carts) {
    let a, b;
    if (c.Phase === 3 || c.Phase === 4) { a = c.OutboundPath; b = c.ReturnPath; }
    else if (c.Phase <= 1) { a = c.ReturnPath; b = c.OutboundPath; }
    else continue;
    c.Ground = MAP.arrivalGround(g, S, a, MAP.arrivalGround(g, S, b, off));
  }
}
export function hasPioneersJourney(g) {
  const S = g.Pioneers;
  return !!S && S.Carts.some((c) => c.Phase !== 0);
}

// ---------------------------------------------------------------- clock / events @3c0b0bc, @3c081b4, @3c08c04
export function advancePioneersClock(g, dt) {
  const S = g.Pioneers, P = S.Progress;
  const wid = () => { const w = MAP.weather(g, S, MAP.getPioneersCalculationTime(g)); return w.Beyond ? 0 : w.Id; };
  const before = wid();
  S.ContentSeconds += dt;
  if (P) { P.Done += dt; P.CalculationTime = pioneersActualTime(g, P.Done); }
  const after = wid();
  if (after !== before) { g.PioneersWeatherDirty = true; D('recalculatePioneersTimes')(g); D('touchPioneers')(g, true, true); }
}
export function pioneersActualTime(g, done) {            // @3c0ba7c (content-time -> wall time; default = linear)
  const P = g.Pioneers.Progress;
  if (!P) return g.Pioneers.Timestamp;
  if (P.Total <= done) return P.To;
  if (g.getNewWorldProcessedTime) return g.getNewWorldProcessedTime(done);
  return Math.min(P.To, P.From + done * 1000);
}
const contentTicks = (g, from, to) => (g.getNewWorldContentTicks ? g.getNewWorldContentTicks(from, to) : (to - from) * 1e4);
export function nextPioneersEvent(g, maxSeconds) {
  const S = g.Pioneers;
  refreshPioneersLoadCandidates(g);
  const ml = minLoad(g);
  let d = maxSeconds;
  for (const j of S.Jobs) if (j.Active) d = Math.min(d, j.RemainingSeconds);
  for (const t of activeTiles(S)) {
    if (t.BuildingId === SHRINE) {
      if (t.Stock.gt(ZERO) && t.BurnRemaining > 0) d = Math.min(d, t.BurnRemaining);
    } else {
      const cand = g.PioneersLoadCand[t.Cell];
      if (!cand || g.PioneersLoadBusy[t.Cell]) continue;
      const st = statsRO(g, t);
      if (!t.Stock.lt(ml)) continue;
      if (!st.Capacity.ge(ml)) continue;
      if (!st.Rate.gt(ZERO)) continue;
      if (t.RouteTarget < 0) continue;
      const tb = ml.sub(t.Stock).div(st.Rate);
      if (tb.lt(new BigNumber(d))) d = Math.max(0, tb.toDouble());
    }
  }
  for (const c of S.Carts) {
    for (const h of c.HasteEffects) if (h.RemainingSeconds > 0) d = Math.min(d, h.RemainingSeconds);
    if (c.Phase === 1 || c.Phase === 4) d = Math.min(d, c.PhaseRemaining);
    else if (c.Phase === 2 || c.Phase === 5) {
      const st = statsRO(g, S.Tiles[c.OwnerCell]);
      const limit = c.LegProgress < 0.5 ? 0.5 : 1.0;
      d = Math.min(d, (limit - c.LegProgress) / (st.CartSpeed * c.Ground * c.HasteMultiplier));
    }
  }
  return Math.max(EPS, d);
}
const LEG_END = 0.9999999999, HALF_HI = 0.5000000001;
export function advancePioneersExact(g, seconds, journeyOnly) {
  const S = g.Pioneers;
  D('refreshPioneersJobs')(g);
  startPioneersUnloads(g);
  if (!journeyOnly) startPioneersLoads(g);
  let remaining = seconds;
  while (remaining > 0) {
    if (journeyOnly && !hasPioneersJourney(g)) break;
    const P = S.Progress;
    P.Budget -= 1; P.EventsUsed += 1;       // budget exhaustion fallback (AdvancePioneersConservative) is not ported: we keep stepping exactly
    const saved = remaining;
    const dt = Math.min(remaining, nextPioneersEvent(g, remaining));
    // pass 1: accrue
    for (const t of activeTiles(S)) {
      if (t.BuildingId === EXTRACTOR) {
        const st = statsRO(g, t);
        const room = bnMax(ZERO, st.Capacity.sub(t.Stock));
        const prod = st.Rate.mul(dt);
        t.Stock = t.Stock.add(bnMin(room, prod));
      } else if (t.BuildingId === SHRINE) {
        if (t.Stock.gt(ZERO)) t.BurnRemaining -= dt;
      }
    }
    for (const j of S.Jobs) if (j.Active) j.RemainingSeconds -= dt;
    for (const c of S.Carts) {
      switch (c.Phase) {
        case 1: case 4: c.PhaseRemaining -= dt; break;
        case 2: case 5: {
          const limit = c.LegProgress < 0.5 ? 0.5 : 1.0;
          const st = statsRO(g, S.Tiles[c.OwnerCell]);
          c.LegProgress = Math.min(limit, c.LegProgress + dt * st.CartSpeed * c.Ground * c.HasteMultiplier);
          break;
        }
        default: break;
      }
      for (const h of c.HasteEffects) h.RemainingSeconds -= dt;
      refreshPioneersHaste(g, c);
    }
    advancePioneersClock(g, dt);
    remaining = Math.max(0, saved - dt);
    D('completePioneersJobs')(g);
    // pass 2: shrine burns
    for (const t of shrineTiles(S)) {
      if (t.Stock.le(ZERO)) continue;
      if (t.BurnRemaining > EPS) continue;
      const st = statsRO(g, t);
      const total = st.BurnSeconds;
      burnPioneersStock(g, t);
      t.BurnRemaining = t.Stock.gt(ZERO) ? total : 0;
      t.BurnDuration = total;
    }
    // pass 3: cart transitions
    for (const c of S.Carts) {
      switch (c.Phase) {
        case 1:
          if (c.PhaseRemaining <= EPS) { c.PhaseRemaining = 0; c.Phase = 2; g.PioneersCandDirty = true; progressBudget(g, -1); }
          break;
        case 4:
          if (c.PhaseRemaining <= EPS) { c.Unloaded = true; unloadPioneersCart(g, c); }
          break;
        case 2: case 5: {
          const path = c.Phase === 2 ? c.OutboundPath : c.ReturnPath;
          const leg = c.LegIndex;
          if (leg + 1 >= path.length) continue;
          const p = c.LegProgress;
          if (p >= LEG_END) {
            applyPioneersMagic(g, c, path[leg + 1]);
            c.LegProgress = 0; c.LegIndex = leg + 1;
            progressBudget(g, -1);
            if (leg + 2 >= path.length) { g.PioneersCandDirty = true; c.Phase = c.Phase === 2 ? 3 : 0; c.ArrivedAt = S.ContentSeconds; }
          } else if (p >= 0.5 && p < HALF_HI) {
            c.LegProgress = 0.5;
            const nt = S.Tiles[path[leg + 1]];
            if (nt.BuildingId === 0) c.Ground = MAP.ground(g, nt);
            progressBudget(g, -1);
          }
          updatePioneersCartPosition(g, c);
          break;
        }
        default: break;
      }
    }
    startPioneersUnloads(g);
    if (!journeyOnly) startPioneersLoads(g);
  }
  return seconds - remaining;
}

// ---------------------------------------------------------------- caches (g+0x1238 routes, +0x1240 rerouted set, +0x1248 path sets, +0x1250 topology sig, +0x1258 reports, +0x1260 stats)
/** Called by TouchPioneers(g, _, true) @3bf7708 (u5-B owns Touch): clears route/rerouted/stats caches, marks reports dirty. */
export function clearPioneersCaches(g) {
  g.PioneersRouteCache = new Map(); g.PioneersRerouted = new Set(); g.PioneersStatsCache = new Map();
  g.PioneersRoutesDirty = true;
}
/** RecalculatePioneersTimes @3bf7834 tail: clears route cache + rerouted set, marks reports dirty. */
export function clearPioneersRouteCaches(g) { g.PioneersRouteCache = new Map(); g.PioneersRerouted = new Set(); g.PioneersRoutesDirty = true; }

// ---------------------------------------------------------------- Pioneers::FindPath @419f57c (uniform-cost search, state = (cell, ground))
class MinHeap {                     // PushSearch @41a00bc / PopSearch @41a0280: binary heap ordered by (priority, index)
  constructor() { this.a = []; }
  get count() { return this.a.length; }
  static less(p1, i1, p2, i2) { return p1 < p2 || (p1 === p2 && i1 < i2); }
  push(p, i) {
    const a = this.a; a.push([p, i]);
    let k = a.length - 1;
    while (k > 0) {
      const par = (k - 1) >> 1;
      if (MinHeap.less(a[k][0], a[k][1], a[par][0], a[par][1])) { [a[k], a[par]] = [a[par], a[k]]; k = par; } else break;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let k = 0;
      for (;;) {
        let c = 2 * k + 1; if (c >= a.length) break;
        if (c + 1 < a.length && MinHeap.less(a[c + 1][0], a[c + 1][1], a[c][0], a[c][1])) c++;
        if (MinHeap.less(a[c][0], a[c][1], a[k][0], a[k][1])) { [a[k], a[c]] = [a[c], a[k]]; k = c; } else break;
      }
    }
    return top;
  }
}
/** FindPath(S, from, to, out, waypoints, idx, _, ground0): fills `out` (array, cleared) with cells from..to; returns bool.
 *  `waypoints`/`idx` have no effect in the binary (a loop over them has no observable result). */
export function FindPath(g, from, to, out, waypoints, idx, ground0) {
  const S = g.Pioneers;
  out.length = 0;
  if (!MAP.walkable(S, from) || !MAP.walkable(S, to)) return false;
  let gd = ground0;
  const t0 = S.Tiles[from];
  if (t0.BuildingId === 0) gd = MAP.ground(g, t0);
  const nodes = [{ cell: from, parent: -1, ground: gd, cost: 0, stat: 0, closed: false }];
  const best = new Map([[from + '|' + gd, 0]]);
  const heap = new MinHeap(); heap.push(0, 0);
  const E = 1e-9;
  for (;;) {
    if (heap.count <= 0) return false;
    const [prio, ni] = heap.pop();
    const nd = nodes[ni];
    if (nd.closed) continue;
    if (nd.cost !== prio) continue;
    if (nd.cell === to) {
      for (let k = ni; k >= 0; k = nodes[k].parent) out.push(nodes[k].cell);
      out.reverse();
      return true;
    }
    nd.closed = true;
    const half = 0.5 / nd.ground, border = nd.cost + half;
    for (let dir = 0; dir < 4; dir++) {
      const n = MAP.neighbor(S, nd.cell, dir);
      if (!MAP.walkable(S, n)) continue;
      const nt = S.Tiles[n];
      let ng = nd.ground, nh = half;
      if (nt.BuildingId === 0) { ng = MAP.ground(g, nt); nh = 0.5 / ng; }
      const stat = nd.stat + (nt.MagicLevel > 0 ? 1 : 0);
      const cost = border + nh;
      const key = n + '|' + ng;
      const ex = best.get(key);
      if (ex !== undefined) {
        const o = nodes[ex];
        if (o.closed) continue;
        if (o.cost - E > cost || (!(o.cost + E < cost) && stat > o.stat)) {
          nodes[ex] = { cell: o.cell, parent: ni, ground: o.ground, cost, stat, closed: false };
          heap.push(cost, ex);
        }
      } else {
        nodes.push({ cell: n, parent: ni, ground: ng, cost, stat, closed: false });
        best.set(key, nodes.length - 1);
        heap.push(cost, nodes.length - 1);
      }
    }
  }
}

// ---------------------------------------------------------------- BuildPioneersPath @3c03fa0
export function buildPioneersPath(g, from, to, waypoints, out, ground) {
  const S = g.Pioneers;
  out.length = 0; out.push(from);
  const n = waypoints ? waypoints.length : 0;
  let cur = from, gd = ground;
  for (let i = 0; i <= n; i++) {
    const tgt = i < n ? waypoints[i] : to;
    const seg = [];
    if (!FindPath(g, cur, tgt, seg, waypoints, i + 1, gd)) return false;
    gd = MAP.arrivalGround(g, S, seg, gd);
    for (let k = 1; k < seg.length; k++) out.push(seg[k]);
    cur = tgt;
  }
  return true;
}

// ---------------------------------------------------------------- RefreshPioneersPathTopology @3c04420 / PioneersPaths @3c045cc
export function refreshPioneersPathTopology(g) {
  const S = g.Pioneers;
  if (!S) return;
  const n = S.Tiles.length;
  let changed = false;
  if (!g.PioneersTopo || g.PioneersTopo.length !== n) { g.PioneersTopo = new Array(n).fill(0); changed = true; }
  for (let i = 0; i < n; i++) {
    const t = S.Tiles[i];
    const sig = (t.Revealed ? 1 : 0) + t.Terrain * 2 + (t.MagicLevel > 0 ? 8 : 0) + t.RoadLevel * 16 + t.BuildingId * 65536;
    if (g.PioneersTopo[i] !== sig) { g.PioneersTopo[i] = sig; changed = true; }
  }
  if (changed) g.PioneersPathSets = [];
}
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export function pioneersPaths(g, from, to, waypoints) {
  const S = g.Pioneers;
  refreshPioneersPathTopology(g);
  g.PioneersPathSets ??= [];
  const wps = waypoints ?? [];
  for (const ps of g.PioneersPathSets) if (ps.From === from && ps.To === to && sameList(ps.Waypoints, wps)) return ps;
  if (g.PioneersPathSets.length >= 0x80) g.PioneersPathSets.length = 0;
  const ps = { From: from, To: to, Waypoints: wps.slice(), Candidates: [] };
  const off = setting(g).OffRoadSpeedMultiplier;
  const grounds = [off];
  for (const t of S.Tiles) {
    if (t.Revealed && t.BuildingId === 0 && MAP.walkable(S, t.Cell)) {
      const gv = MAP.ground(g, t);
      if (!grounds.includes(gv)) grounds.push(gv);
    }
  }
  for (let gd of grounds) {
    const A = [], B = [];
    if (!buildPioneersPath(g, from, to, waypoints, A, gd)) continue;
    gd = MAP.arrivalGround(g, S, A, gd);
    if (!FindPath(g, to, from, B, null, 0, gd)) continue;
    gd = MAP.arrivalGround(g, S, B, gd);
    const init = MAP.initialGround(g, S, A);
    if (init === off && A.length === 2 && S.Tiles[from].BuildingId !== 0 && S.Tiles[to].BuildingId !== 0) gd = off;
    ps.Candidates.push({ Ground: gd, Arrival: MAP.arrivalGround(g, S, A, gd), Outbound: A, Return: B });
  }
  g.PioneersPathSets.push(ps);
  return ps;
}

// ---------------------------------------------------------------- PioneersTravelSeconds @3c0385c
/** hastes: array of {Zone, Mult, End}; zones: Set; clk: {t}; mult: {v: BigNumber}; magicCells: array|null. Returns seconds. */
export function pioneersTravelSeconds(g, ground, speed, path, outbound, hastes, zones, clk, mult, magicCells) {
  const S = g.Pioneers;
  const start = clk.t;
  for (let k = 1; k < path.length; k++) {
    const A = S.Tiles[path[k - 1]], B = S.Tiles[path[k]];
    if (A.BuildingId === 0) ground = MAP.ground(g, A);
    for (let half = 0; half < 2; half++) {
      if (half === 1 && B.BuildingId === 0) ground = MAP.ground(g, B);
      const gs = ground * speed;
      let rem = 0.5;
      for (;;) {
        let m = 1.0, bound = Infinity;
        for (const h of hastes) if (h.End > clk.t) { m = Math.max(m, h.Mult); bound = Math.min(bound, h.End); }
        const tEnd = rem / (gs * m) + clk.t;
        if (!(tEnd > bound)) { clk.t = tEnd; break; }
        const part = bound - clk.t;
        clk.t = bound;
        rem -= m * (ground * (part * speed));
        if (!(rem > 0)) { clk.t = tEnd; break; }
      }
    }
    if (outbound && B.MagicLevel >= 1) {
      const zone = g.PioneersZones[B.Cell];
      if (!zones.has(zone)) {
        zones.add(zone);
        const mm = pioneersMagicMultiplier(g, B);
        mult.v = zones.size === 1 ? mm : mult.v.add(mm);
        if (magicCells) magicCells.push(B.Cell);
        for (let i = hastes.length - 1; i >= 0; i--) if (hastes[i].Zone === zone || !(hastes[i].End > clk.t)) hastes.splice(i, 1);
        const hm = D('upgradeValue')(g, B, 94008).toDouble();
        const dur = D('upgradeValue')(g, B, 94007).toDouble();
        hastes.push({ Zone: zone, Mult: hm, End: clk.t + dur });
      }
    }
  }
  return clk.t - start;
}

// ---------------------------------------------------------------- PreviewPioneersRoute @3bff840
export function previewPioneersRoute(g, from, to, waypoints) {
  const S = g.Pioneers;
  const route = makeRouteData(); route.Result = 0x384;
  const ex = tileOf(g, from), sh = tileOf(g, to);
  if (!ex || ex.BuildingId !== EXTRACTOR || !sh || sh.BuildingId !== SHRINE || !sh.Revealed) return route;
  if (waypoints) for (const w of waypoints) { const wt = tileOf(g, w); if (!wt || !wt.Revealed || wt.MagicLevel < 1) return route; }
  const st = pioneersBaseStats(g, ex);
  const speed = st.CartSpeed, load = st.LoadSeconds, unload = st.UnloadSeconds;
  const ps = pioneersPaths(g, from, to, waypoints);
  const TOL = 1e-7;
  let bestCycle = Infinity;
  for (const cand of ps.Candidates) {
    const hastes = [], zones = new Set();
    let prev = Infinity, hastes2 = [];
    const clk = { t: 0 }, mult = { v: ONE };
    let accepted = false, d10 = 0, d11 = 0, d13 = 0;
    for (let it = 0; it < 0x20; it++) {
      zones.clear();
      const startClock = clk.t;
      mult.v = ONE;
      clk.t = load + startClock;
      d10 = pioneersTravelSeconds(g, cand.Ground, speed, cand.Outbound, true, hastes, zones, clk, mult, null);
      clk.t = unload + clk.t;
      d11 = pioneersTravelSeconds(g, cand.Arrival, speed, cand.Return, false, hastes, zones, clk, mult, null);
      const end = clk.t;
      d13 = end - startClock;
      let same = Math.abs(d13 - prev) <= TOL, alive = 0;
      for (const h of hastes) {
        if (h.End <= end) continue;
        alive++;
        if (!hastes2.some((e) => e.Zone === h.Zone && e.Mult === h.Mult && Math.abs(e.End - (h.End - end)) <= TOL)) same = false;
      }
      if (same && alive === hastes2.length) { accepted = true; break; }
      hastes2 = [];
      for (const h of hastes) if (h.End > end) hastes2.push({ Zone: h.Zone, Mult: h.Mult, End: h.End - end });
      prev = d13;
    }
    if (accepted && d13 < bestCycle) {
      route.Outbound = cand.Outbound.slice(); route.Return = cand.Return.slice();
      bestCycle = d13;
      route.OutboundSeconds = d10; route.ReturnSeconds = d11; route.CycleSeconds = d13;
      route.Multiplier = mult.v; route.Result = 0;
      break;
    }
  }
  if (route.Allowed) {
    const hastes = [], zones = new Set(), clk = { t: load }, mult = { v: ONE };
    route.MagicCells = [];
    const init = MAP.initialGround(g, S, route.Outbound);
    route.InitialOutboundSeconds = pioneersTravelSeconds(g, init, speed, route.Outbound, true, hastes, zones, clk, mult, route.MagicCells);
    clk.t = unload + clk.t;
    const arr = MAP.arrivalGround(g, S, route.Outbound, init);
    route.InitialReturnSeconds = pioneersTravelSeconds(g, arr, speed, route.Return, false, hastes, zones, clk, mult, null);
  }
  return route;
}

// ---------------------------------------------------------------- PioneersRoute @3c056f0 / SetPioneersRoute @3bff5c8 / RefreshPioneersRoutes @3bf98ec
export function pioneersRoute(g, tile) {
  if (!tile) return null;
  g.PioneersRouteCache ??= new Map();
  let r = g.PioneersRouteCache.get(tile.Cell);
  if (r) return r;
  r = previewPioneersRoute(g, tile.Cell, tile.RouteTarget, tile.Waypoints);
  g.PioneersRouteCache.set(tile.Cell, r);
  return r;
}
export function setPioneersRoute(g, ex, shrine, waypoints) {
  if (!D('canChangePioneers')(g)) return 0x384;
  const route = previewPioneersRoute(g, ex, shrine, waypoints);
  if (!route.Allowed) return route.Result;
  const t = tileOf(g, ex);
  t.RouteTarget = shrine;
  t.Waypoints.length = 0;
  if (waypoints) for (const w of waypoints) t.Waypoints.push(w);
  t.RouteVersion = (t.RouteVersion | 0) + 1;
  D('touchPioneers')(g, false, true);
  return 0;
}
export function refreshPioneersRoutes(g) {
  const S = g.Pioneers;
  let changed = false;
  if (!S) return false;
  g.PioneersRerouted ??= new Set();
  for (const t of S.Tiles) {
    if (t.BuildingId !== EXTRACTOR) continue;
    const route = pioneersRoute(g, t);
    if (route.Allowed) continue;
    if (g.PioneersRerouted.has(t.Cell)) continue;      // HashSet.Add == false
    g.PioneersRerouted.add(t.Cell);
    let best = -1, bestRoute = route;
    for (const s of S.Tiles) {
      if (s.BuildingId !== SHRINE || !s.Revealed) continue;
      const r = previewPioneersRoute(g, t.Cell, s.Cell, null);
      if (!r.Allowed) continue;
      if (bestRoute.Allowed && !(r.InitialOutboundSeconds < bestRoute.InitialOutboundSeconds)) continue;
      bestRoute = r; best = s.Cell;
    }
    if (t.RouteTarget === best) { if (t.Waypoints.length >= 1) { t.Waypoints.length = 0; t.RouteVersion = (t.RouteVersion | 0) + 1; changed = true; } }
    else { t.RouteTarget = best; t.Waypoints.length = 0; t.RouteVersion = (t.RouteVersion | 0) + 1; changed = true; }
    g.PioneersRouteCache.set(t.Cell, bestRoute);
  }
  if (changed) g.PioneersRoutesDirty = true;
  return changed;
}

// ---------------------------------------------------------------- BuildPioneersReports @3c01db8 / GetPioneersTransportReport @3c05990
// Report value struct (0xe0 B in the dictionary at g+0x1258, key = extractor cell). Bot-visible fields: Allowed (+0), CycleSeconds (+0xd0), Route (+0xd8).
// Pass 1 (per extractor): C = min(CartCapacity, Capacity); T = min(C*carts/cycle, C/Load, C/Unload) (0 if C < MinLoad);
//   R (+0x48) = min(extractor Rate, T); E (+0x58) = R * route.Multiplier; (+0x18..) Surplus = Rate - min(CartCap*carts/cycle, CartCap/Load, CartCap/Unload).
// Pass 2 (per shrine S, over reports routed to S with CartCapacity>0): U = sum(R/C * UnloadSeconds) (dock utilisation), scale = U>1 ? 1/U : 1,
//   Inflow (+0x68) = E*scale  <- what GetPioneersTileStats sums; A = sum(E*scale); factor = A > BurnRate ? BurnRate/A : 1;
//   PointsPerSecond (+0x38) = E*scale*factor*shrineEffect*OreReward(ore).
export function buildPioneersReports(g) {
  const S = g.Pioneers;
  if (!S) { g.PioneersReports = new Map(); return; }
  if (g.PioneersReports && g.PioneersRoutesDirty === false) return;
  g.PioneersRoutesDirty = false;
  const reps = g.PioneersReports = new Map();
  const ml = minLoad(g);
  for (const t of S.Tiles) {
    if (t.BuildingId !== EXTRACTOR) continue;
    const st = pioneersBaseStats(g, t), route = pioneersRoute(g, t);
    const rep = { Allowed: route.Allowed, Cell: t.Cell, Route: route, OutboundSeconds: 0, ReturnSeconds: 0, CycleSeconds: 0, Multiplier: ONE,
      CartCapacity: st.CartCapacity, Capacity: st.Capacity, UnloadSeconds: st.UnloadSeconds, Surplus: ZERO, Rate: ZERO, RawRate: ZERO,
      PointsPerSecond: ZERO, Inflow: ZERO };
    if (route.Allowed && route.CycleSeconds > 0) {
      const cyc = route.CycleSeconds, cc = st.CartCapacity, n = st.CartCount;
      const m2 = bnMin(cc.mul(n).div(cyc), bnMin(cc.div(st.LoadSeconds), cc.div(st.UnloadSeconds)));
      const C = bnMin(cc, st.Capacity);
      let m4 = bnMin(C.mul(n).div(cyc), bnMin(C.div(st.LoadSeconds), C.div(st.UnloadSeconds)));
      if (C.lt(ml)) m4 = ZERO;
      const R = bnMin(st.Rate, m4);
      Object.assign(rep, { OutboundSeconds: route.OutboundSeconds, ReturnSeconds: route.ReturnSeconds, CycleSeconds: cyc, Multiplier: route.Multiplier,
        Surplus: st.Rate.sub(m2), RawRate: R, Rate: R.mul(route.Multiplier) });
    }
    reps.set(t.Cell, rep);
  }
  for (const sh of S.Tiles) {
    if (sh.BuildingId !== SHRINE) continue;
    const routed = [];
    let U = ZERO;
    for (const r of reps.values()) {
      if (!r.Allowed) continue;
      if (S.Tiles[r.Cell].RouteTarget !== sh.Cell) continue;
      if (r.CartCapacity.le(ZERO)) continue;
      routed.push(r);
      const C = bnMin(r.CartCapacity, r.Capacity);
      if (!C.gt(ZERO)) continue;
      U = U.add(r.RawRate.div(C).mul(r.UnloadSeconds));
    }
    if (!routed.length) continue;
    const scale = U.gt(ONE) ? ONE.div(U) : ONE;
    let A = ZERO;
    for (const r of routed) A = A.add(r.Rate.mul(scale));
    const sst = pioneersBaseStats(g, sh);
    const factor = (A.gt(sst.BurnRate) && A.gt(ZERO)) ? sst.BurnRate.div(A) : ONE;
    for (const r of routed) {
      const ore = S.Tiles[r.Cell].OreId;
      r.Inflow = r.Rate.mul(scale);
      r.PointsPerSecond = r.Rate.mul(scale).mul(factor).mul(sst.Effect).mul(D('getPioneersOreReward')(g, ore));
    }
  }
}
export function getPioneersTransportReport(g, cell) {
  buildPioneersReports(g);
  return g.PioneersReports.get(cell) ?? { Allowed: false, Cell: cell, Route: null, OutboundSeconds: 0, ReturnSeconds: 0, CycleSeconds: 0, Multiplier: ONE, RawRate: ZERO, Rate: ZERO, Inflow: ZERO, PointsPerSecond: ZERO };
}

// ---------------------------------------------------------------- progress engine @3c0b34c .. @3c0cb10
export function makeProgress() {            // PioneersProgressData (fields, offsets in IL2CPP object)
  return {
    From: 0, To: 0,                         // +0x10,+0x18 Timestamp
    CalculationTime: 0,                     // +0x20 (Nullable<Timestamp> in the binary: set => > 0)
    Total: 0,                               // +0x28 requested seconds
    Done: 0,                                // +0x30 content seconds processed
    PreSkip: 0,                             // +0x38
    Budget: 0,                              // +0x40 remaining event budget (u5-B calls it JobCount)
    Precise: 0,                             // +0x48 seconds left for exact stepping
    HasExact: false,                        // +0x50
    EventsUsed: 0,                          // +0x54
    ExternalEffects: null,                  // +0xa0 snapshot of external effects (u5-B PioneersEffectSources reads it)
    get JobCount() { return this.Budget; }, set JobCount(v) { this.Budget = v; },
  };
}
export function pioneersEventBudget(g, cartCount) {          // @3c0b20c
  const s = setting(g);
  let b = s.MaxProcessEvents;
  if (s.MaxProcessCartEvents >= 1) b = Math.min(b, Math.max(1, Math.trunc(s.MaxProcessCartEvents / Math.max(1, cartCount))));
  return b;
}
export function resumePioneersProgress(g) {                  // @3c0b7d4
  const S = g.Pioneers;
  if (!S || !S.Progress) return;
  g.PioneersInProgress = true;                               // +0x1229
  if (refreshPioneersRoutes(g)) D('touchPioneers')(g, false, false);
}
export function beginPioneersProgress(g, from, to, total, extra) {
  const S = g.Pioneers;
  if (!S) throw new Error('no pioneers state');
  if (S.Progress) { resumePioneersProgress(g); return; }
  const s = setting(g), P = makeProgress();
  P.From = from; P.To = to; P.Total = total; P.Done = 0; P.CalculationTime = S.Timestamp;
  P.PreSkip = S.Timestamp > from ? contentTicks(g, from, S.Timestamp) / TICKS : 0;
  P.Budget = pioneersEventBudget(g, S.Carts.length);
  P.Precise = s.PreciseProcessSeconds;
  P.HasExact = (total + extra) > s.TickSeconds;
  P.ExternalEffects = new Map(g.PioneersExternalEffects ?? []);
  S.Progress = P;
  g.PioneersBudgetLeft = P.Budget; g.PioneersEventsUsed = 0; g.PioneersChanged = false;
  resumePioneersProgress(g);
  synchronizePioneersCarts(g);
}
export function checkpointPioneersProgress(g, ts) {          // @3c0c6b0
  const S = g.Pioneers;
  if (!S) return;
  const P = S.Progress;
  const cap = P ? P.To : S.EndAt;
  const val = ts > cap ? cap : ts;
  if (val > 0 && val > S.Timestamp) S.Timestamp = val;
  if (P) { g.PioneersBudgetLeft = P.Budget; g.PioneersEventsUsed = P.EventsUsed; }
  g.PioneersInProgress = false;
  if (g.PioneersChanged) { g.PioneersChanged = false; if (deps.flushPioneersChanged ?? econ.flushPioneersChanged) D('flushPioneersChanged')(g); }
}
export function endPioneersProgress(g, ts) {                 // @3c0c894
  const S = g.Pioneers;
  if (!S) return;
  const P = S.Progress;
  if (P) { g.PioneersBudgetLeft = P.Budget; g.PioneersEventsUsed = P.EventsUsed; S.Progress = null; }
  checkpointPioneersProgress(g, ts);
}
export function abortPioneersProgress(g) {                   // @3c0cae4
  if (g.PioneersInProgress) checkpointPioneersProgress(g, MAP.getPioneersCalculationTime(g));
}
export function getPioneersBoundaryTicks(g, ticks) {         // @3c0be80
  const S = g.Pioneers, s = setting(g);
  if (!S || ticks < 1 || !g.PioneersInProgress) return ticks;
  const P = S.Progress;
  if (!P) throw new Error('no progress');
  if (P.PreSkip > 0) return Math.min(ticks, Math.max(1, Math.ceil(P.PreSkip * TICKS)));
  let secs = ticks / TICKS;
  let fine = true;
  if (P.HasExact) { if (P.Budget < 1) fine = false; else if (!(P.Precise > 0) && !hasPioneersJourney(g)) fine = false; }
  if (fine) secs = Math.min(secs, s.TickSeconds);
  for (const j of S.Jobs) if (j.Active) secs = Math.min(secs, j.RemainingSeconds);
  const calc = MAP.getPioneersCalculationTime(g);
  const w = MAP.weather(g, S, calc);
  if (!w.Beyond && calc < P.To) {
    const t2 = calc + w.Remaining * 1000;
    if (t2 <= P.To) secs = Math.min(secs, contentTicks(g, calc, t2) / TICKS);
  }
  if (P.Precise > 0 && P.Budget >= 1) {
    secs = Math.min(secs, P.Precise);
    for (const t of shrineTiles(S)) if (t.Stock.gt(ZERO) && t.BurnRemaining > 0) secs = Math.min(secs, t.BurnRemaining);
  }
  return Math.min(ticks, Math.max(1, Math.ceil(secs * TICKS)));
}
export function progressPioneers(g, seconds) {               // @3c0c530
  const S = g.Pioneers;
  const P = S && S.Progress;
  if (!P || !(seconds > 0)) return;
  let d8 = seconds;
  if (P.PreSkip > 0) {
    const m = Math.min(d8, P.PreSkip);
    d8 -= m; P.Done += m; P.PreSkip -= m;
    P.CalculationTime = pioneersActualTime(g, P.Done);
  }
  if (d8 > 0) {
    let d9 = d8;
    if (P.HasExact) {
      d9 = P.Precise;
      if (d9 > 0 && P.Budget >= 1) d9 = Math.min(d8, d9);
    }
    if (!P.HasExact || (P.Precise > 0 && P.Budget >= 1)) {
      advancePioneersExact(g, d9, false);
      P.Precise -= d9;
      d8 -= d9;
    }
    if (d8 > 0) advancePioneersExact(g, d8, false);          // AdvancePioneersConservative @3c09c20 is not ported: exact stepping instead
  }
}
/** GameData::ProcessPioneers @3c0cb10 (until: ms Timestamp, extra: seconds). Returns the game status code (0 = ok). */
export function processPioneers(g, until, extra = 0) {
  const S = g.Pioneers;
  if (!S) return 0x384;
  if (S.Progress) return 0x134;
  if (g.PioneersDisabled || g.PioneersInProgress || g.PioneersBusy) return 0x384;
  if (!(until > 0)) return 0x138;
  if (until < S.Timestamp) return 0x138;
  if (extra < 0 || !Number.isFinite(extra)) return 0x384;
  const target = until < S.EndAt ? until : S.EndAt;
  if (extra > 0 && until >= S.EndAt) return 0x130;
  let from = S.Timestamp;
  if ((target - from) / 1000 > 604800) from = target - 604800 * 1000;
  const rampage = g.getTimeRampageExtraSeconds ? g.getTimeRampageExtraSeconds(from, target) : 0;
  const total = (target - from) / 1000 + rampage;
  beginPioneersProgress(g, from, target, total, extra);
  let ok = false;
  try {
    let d8 = total + extra;
    while (d8 > 0) {
      const ticks = roundEven(d8 * TICKS);
      if (ticks < 1) break;
      const chunk = getPioneersBoundaryTicks(g, ticks) / TICKS;
      progressPioneers(g, chunk);
      d8 = Math.max(0, d8 - chunk);
    }
    ok = true;
  } finally {
    if (ok) endPioneersProgress(g, target); else abortPioneersProgress(g);
  }
  return 0;
}

// wire u5-B's hooks (touchPioneers / recalculatePioneersTimes call back into this module)
if (econ.procHooks) Object.assign(econ.procHooks, { refreshPioneersRoutes, synchronizePioneersCarts, refreshPioneersDockedCartGround, clearCaches: clearPioneersCaches });
