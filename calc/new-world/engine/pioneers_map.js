// U5-A: Pioneers map generation + static map helpers (GameData::EnsurePioneers and friends). See U5_A_NOTES.md.
// Functions take the game object `g` first (g.m = Master, g.Pioneers = state, ...). Return codes follow the game (0 = ok).
import { BigNumber } from './bignum.js';
import { makeStateData, makeTileData, E_TERRAIN, E_FACILITY } from './pioneers_state.js';

// Cross-part hooks (set by pioneers.js / tests): touchPioneers(g, a, b) @3bf7708, recalculatePioneersTimes(g) @3bf7834,
// facilityValue(g, facilityId, level) -> BigNumber|number (Pioneers::FacilityValue @419e234, owned by u5-B),
// cloneProgress(progress) (ClonePioneersProgress @3c10554, owned by u5-C).
export const hooks = { touchPioneers: null, recalculatePioneersTimes: null, facilityValue: null, cloneProgress: null };

const i32 = (x) => (Number.isNaN(x) ? -2147483648 : x > 2147483647 ? 2147483647 : x < -2147483648 ? -2147483648 : x | 0);
const setting = (g) => g.m.setting('PioneersSetting');

// Pioneers::LayoutSeed @41a0a44 (uint32)
export const layoutSeed = (seed, number, difficulty) => (Math.imul(number, 0x9e3779b1) ^ seed ^ difficulty) >>> 0;
// Pioneers::Random @41a10f4: LCG on a uint32 state held in rng.s; returns the NEW state (uint32).
export function random(rng) { rng.s = (Math.imul(rng.s, 0x19660d) + 0x3c6ef35f) >>> 0; return rng.s; }
// Shuffle<int>(list, ref seed) @4b66c90: Fisher-Yates from the end, k = Random % n, swap(list[k], list[n-1]).
export function shuffle(list, rng) {
  for (let n = list.length; n - 1 >= 1; n--) {
    const k = random(rng) % n, a = list[k];
    list[k] = list[n - 1]; list[n - 1] = a;
  }
}

// Pioneers::Neighbor @419f0b0: dir 0 = left(x-1), 1 = up(y-1), 2 = right(x+1), else down(y+1); -1 when out of the grid.
export function neighbor(S, cell, dir) {
  const n = S.Size, x = cell % n, y = Math.trunc(cell / n);
  if (dir === 0) return x > 0 ? cell - 1 : -1;
  if (dir === 1) return y > 0 ? cell - n : -1;
  if (dir === 2) return x + 1 >= n ? -1 : cell + 1;
  return y + 1 < n ? cell + n : -1;
}

// GameData::PioneersTile @3bf97b8
export function pioneersTile(g, cell) {
  const S = g.Pioneers;
  return cell >= 0 && S && cell < S.Tiles.length ? S.Tiles[cell] : null;
}

// Pioneers::Walkable @419eebc: revealed, not forest, ore tile only if it holds an extractor.
export function walkable(S, cell) {
  if (cell < 0 || cell >= S.Tiles.length) return false;
  const t = S.Tiles[cell];
  if (!t.Revealed || t.Terrain === E_TERRAIN.FOREST) return false;
  if (t.Terrain === E_TERRAIN.ORE) return t.BuildingId === E_FACILITY.EXTRACTOR;
  return true;
}

// Pioneers::Ground @419ef78: speed multiplier of a tile (road level -> FacilityValue(road, level), else OffRoadSpeedMultiplier).
export function ground(g, tile) {
  if (tile.RoadLevel > 0) {
    const v = hooks.facilityValue(g, E_FACILITY.ROAD, tile.RoadLevel);
    return typeof v === 'number' ? v : v.toDouble();
  }
  return setting(g).OffRoadSpeedMultiplier;
}
// Pioneers::InitialGround @41a054c: Ground of the first path cell without a building (else the off-road multiplier).
export function initialGround(g, S, path) {
  for (const c of path) { const t = S.Tiles[c]; if (t.BuildingId === 0) return ground(g, t); }
  return setting(g).OffRoadSpeedMultiplier;
}
// Pioneers::ArrivalGround @41a080c: Ground of the LAST path cell without a building, else `dflt`.
export function arrivalGround(g, S, path, dflt) {
  let d = dflt;
  for (const c of path) { const t = S.Tiles[c]; if (t.BuildingId === 0) d = ground(g, t); }
  return d;
}

// Pioneers::Zones @419f11c: int[] per cell; magic-land (Terrain 3) 4-connected components labelled by their lowest cell index, else -1.
export function zones(S) {
  const z = new Array(S.Tiles.length).fill(-1);
  for (let i = 0; i < z.length; i++) {
    if (z[i] >= 0 || S.Tiles[i].Terrain !== E_TERRAIN.MAGIC) continue;
    const q = [i]; z[i] = i;
    for (let p = 0; p < q.length; p++)
      for (let d = 0; d < 4; d++) {
        const n = neighbor(S, q[p], d);
        if (n >= 0 && z[n] < 0 && S.Tiles[n].Terrain === E_TERRAIN.MAGIC) { z[n] = i; q.push(n); }
      }
  }
  return z;
}

// Pioneers::TakeSpacedCell @41a1118: removes from `cand` and returns the first cell whose min Manhattan distance to `occ`
// reaches minDist, else the one with the largest min distance (first on ties); appends it to `occ`.
export function takeSpacedCell(cand, occ, size, minDist) {
  let best = -1, bestIdx = 0;
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i], cy = Math.trunc(c / size), cx = c - cy * size;
    let m = minDist;
    for (const o of occ) {
      if (best >= m) break;
      const oy = Math.trunc(o / size);
      m = Math.min(m, Math.abs(cx - (o - oy * size)) + Math.abs(cy - oy));
    }
    if (best < m) bestIdx = i;
    if (m < best) m = best;
    if (minDist <= m) break;
    best = m;
  }
  const cell = cand[bestIdx];
  cand.splice(bestIdx, 1);
  occ.push(cell);
  return cell;
}

// GameData::get_PioneersCalculationTime @3bf4894: Progress.CalculationTime if set (>0), else state.Timestamp; 0 without state.
export function getPioneersCalculationTime(g) {
  const S = g.Pioneers;
  if (!S) return 0;
  const ct = S.Progress && S.Progress.CalculationTime;
  return ct > 0 ? ct : S.Timestamp;
}

// Pioneers::Weather @419eafc -> {Id, Slot, Day (1-based), Remaining (s), Beyond}
export function weather(g, S, now) {
  const none = { Id: 0, Slot: 0, Day: 0, Remaining: 0, Beyond: true };
  if (!S || S.WeatherSchedule.length === 0 || !(now > 0)) return none;
  const slotSec = setting(g).WeatherSlotSeconds;
  const elapsed = Math.max(0, (now - S.StartAt) / 1000);
  const slot = slotSec >= 1 ? i32(Math.floor(elapsed / slotSec)) : 0;
  const n = S.WeatherSchedule.length;
  const beyond = now >= S.EndAt ? true : slot >= n;
  const id = slot < n ? S.WeatherSchedule[slot] : 0;
  const day = i32(Math.floor(elapsed / 86400)) + 1;
  const left = (S.EndAt - now) / 1000;
  const rem = Math.max(0, Math.min(slotSec - (elapsed % Math.max(1, slotSec)), left));
  return { Id: id, Slot: slot, Day: day, Remaining: rem, Beyond: beyond };
}

// Pioneers::FillWeather @41a0a5c: extend S.WeatherSchedule to ceil(period/slot) slots with shuffled bags of weather ids.
export function fillWeather(g, S) {
  const slotSec = setting(g).WeatherSlotSeconds;
  const rows = g.m.findAll('PioneersWeather');
  if (slotSec < 1 || rows.length === 0 || S.EndAt <= S.StartAt) return 0;
  const slots = i32(Math.ceil(((S.EndAt - S.StartAt) / 1000) / slotSec));
  if (S.WeatherSchedule.length >= slots) return 0;
  const rng = { s: (S.Seed ^ S.Difficulty ^ 0x9e3779b9 ^ Math.imul(S.Number, 0x9e3779b1)) >>> 0 };
  let filled = 0;
  while (filled < slots) {
    const bag = rows.map((r) => r.Id).sort((a, b) => a - b);
    shuffle(bag, rng);
    let i = 0;
    for (; filled + i < slots && i < bag.length; i++)
      if (filled + i >= S.WeatherSchedule.length) S.WeatherSchedule.push(bag[i]);
    filled += i;
  }
  return 1;
}

// GameData::UpdatePioneersPeriod @3bf75c4
export function updatePioneersPeriod(g, start, end) {
  const S = g.Pioneers;
  const before = weather(g, S, getPioneersCalculationTime(g));
  const w0 = before.Beyond ? 0 : before.Id;
  S.StartAt = start; S.EndAt = end;
  fillWeather(g, S);
  const after = weather(g, S, getPioneersCalculationTime(g));
  const changed = w0 !== (after.Beyond ? 0 : after.Id);
  if (changed) { g.PioneersWeatherDirty = true; hooks.recalculatePioneersTimes?.(g); }   // flag @GameData+0x12a0
  hooks.touchPioneers?.(g, changed, changed);
}

// Math.Round (banker's)
const roundHalfEven = (x) => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1; };

// GameData::EnsurePioneers @3bf6460 -> 0 ok | 0x384 not NewWorld / disabled / number<1 | 0x138 bad period |
// 0x3e8 existing state belongs to another event | 0x3ee bad settings.
// g needs: GameMode (==10), PioneersDisabled (falsy), m, Pioneers, PioneersIngots, PioneersManaStone; writes PioneersZones.
export function ensurePioneers(g, number, seed, difficulty, start, end, now) {
  if (number < 1 || g.GameMode !== 10 || g.PioneersDisabled) return 0x384;
  if (!(start > 0) || !(end > 0) || !(now > 0) || end <= start || now < start) return 0x138;
  const old = g.Pioneers;
  if (old) {
    if (old.Number !== number || old.Seed !== seed || old.Difficulty !== difficulty) return 0x3e8;
    if (old.StartAt !== start || old.EndAt !== end) updatePioneersPeriod(g, start, end);
    return 0;
  }
  const st = setting(g);
  const sizes = st.GridSizes, ores = st.OreCounts, magics = st.MagicCounts;
  if (difficulty < 0 || difficulty >= sizes.length || ores.length !== sizes.length || magics.length !== sizes.length ||
      !(st.TickSeconds > 0) || st.WeatherSlotSeconds < 1 || !(st.CartSpeed > 0) || !(st.OffRoadSpeedMultiplier > 0)) return 0x3ee;
  const convs = g.m.findAll('PioneersConversion');
  if (convs.length === 0) return 0x3ee;
  const N = sizes[difficulty], R = st.InitialRevealRadius, span = N - 2 * R;
  if (R < 1 || N > 100 || span <= 0) return 0x3ee;

  const S = makeStateData();
  S.Number = number; S.Seed = seed; S.Difficulty = difficulty; S.Size = N;
  S.StartAt = start; S.EndAt = end; S.Timestamp = now < end ? now : end;
  const rng = { s: layoutSeed(seed, number, difficulty) };
  const sx = (random(rng) % span) + R;           // start X
  const sy = (random(rng) % span) + R;           // start Y
  S.StartCell = sy * N + sx;
  const cand = [];                                // non-revealed cells, row-major
  for (let y = 0, base = 0; y < N; y++, base += N)
    for (let x = 0; x < N; x++) {
      const dy = Math.abs(y - sy), dx = Math.abs(x - sx);
      const revealed = dy <= R && dx <= R && !(dy === R && dx === R);   // square minus its 4 corners
      const t = makeTileData();
      t.Cell = base + x; t.X = x; t.Y = y; t.Revealed = revealed;
      S.Tiles.push(t);
      if (!revealed) cand.push(t.Cell);
    }
  shuffle(cand, rng);

  const oreCount = ores[difficulty], magicCount = magics[difficulty];
  const extra = oreCount - convs.length;
  const room = cand.length - (oreCount - 1);
  if (extra <= 0 || magicCount < 0 || room < 0 || magicCount > room) return 0x3ee;
  const rr = random(rng) / 4294967296;
  const manaCount = Math.max(1, Math.min(extra, i32(Math.ceil((st.ManaOreRatioMin + (st.ManaOreRatioMax - st.ManaOreRatioMin) * rr) * oreCount))));

  const dock = S.Tiles[S.StartCell]; dock.Terrain = E_TERRAIN.ORE; dock.OreId = -1;   // start tile is a mana ore
  const bag = convs.map((c) => c.Id).sort((a, b) => a - b);
  const occ = [S.StartCell];
  let bi = bag.length;
  for (let k = 1; k < oreCount; k++) {
    const t = S.Tiles[takeSpacedCell(cand, occ, N, st.OreMinDistance)];
    t.Terrain = E_TERRAIN.ORE;
    if (k < manaCount) t.OreId = -1;
    else {
      if (bi === bag.length) { shuffle(bag, rng); bi = 0; }
      t.OreId = bag[bi++];
    }
  }
  for (let m = 0; m < magicCount; m++) S.Tiles[cand[m]].Terrain = E_TERRAIN.MAGIC;

  const forest = S.Tiles.filter((t) => t.Terrain === 0 && !t.Revealed).map((t) => t.Cell);
  shuffle(forest, rng);
  const nForest = Math.min(forest.length, i32(roundHalfEven(st.ForestRatio * N * N)));
  for (let i = 0; i < nForest; i++) {
    const t = S.Tiles[forest[i]]; t.Terrain = E_TERRAIN.FOREST;
    const d = Math.abs(t.X - sx) + Math.abs(t.Y - sy);
    for (const b of st.ForestDistanceBands) if (d > b) t.ForestType++;
  }
  fillWeather(g, S);
  g.Pioneers = S;
  g.PioneersZones = zones(S);
  g.PioneersIngots = g.PioneersIngots.add(BigNumber.parse(st.InitialIngot));
  g.PioneersManaStone = g.PioneersManaStone.add(BigNumber.parse(st.InitialManaStone));
  hooks.touchPioneers?.(g, false, true);
  return 0;
}

// GameData::ClonePioneers @3bf5368: deep copy (BigNumbers are immutable and shared). Progress is copied generically unless
// hooks.cloneProgress (ClonePioneersProgress @3c10554, u5-C) is set.
function deep(v) {
  if (Array.isArray(v)) return v.map(deep);
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, deep(x)]));
  if (v instanceof BigNumber || v === null || typeof v !== 'object') return v;
  const o = {};
  for (const k of Object.keys(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    Object.defineProperty(o, k, d.get ? d : { value: deep(d.value), writable: true, enumerable: true, configurable: true });
  }
  return o;
}
export function clonePioneers(S) {
  if (!S) return null;
  const c = deep({ ...S, Progress: null });
  c.Progress = hooks.cloneProgress ? hooks.cloneProgress(S.Progress) : deep(S.Progress);
  return c;
}

// GameData::InitPioneers @3bf4960 (only the part that concerns the map: rebuild the zones cache, GameData+0x1230)
export function initPioneers(g) { g.PioneersZones = g.Pioneers ? zones(g.Pioneers) : null; }
