// U5 bot: NewWorldBalanceSimulation pioneers policy (E_pioneers.md; asm addrs in comments). Engine = pioneers_*.js.
// sim = { data: g (GameData-like, see U5_NOTES.md), settings: {PioneersStepSeconds, TradingRatios[4], PioneersResearchManaRatio,
//   IdleManaRatio, MaxShrines, EventNumber, Seed, Difficulty}, user: {isUnlockedContents(id)}, start, end (ms),
//   isManaIdle (bool, read live), contentPending() -> bool, warn?(key, msg) }
// Bot-owned fields: isPioneersOpened(+0x91) ingotsTraded(+0xc8) forestsCleared(+0xcc) ingotReserve(+0x1a8)
import { BigNumber } from './bignum.js';
import { neighbor, walkable, zones, ensurePioneers } from './pioneers_map.js';
import { processPioneers, getPioneersTransportReport, getPioneersTileStats, previewPioneersRoute, setPioneersRoute } from './pioneers_proc.js';
import { getPioneersQuote, getPioneersConversionQuote, convertPioneers, startPioneersJob, upgradePioneers, researchPioneers } from './pioneers_econ.js';

const { ZERO } = BigNumber;
const EXT = 93001, SHR = 93002, MAGIC = 93004, INT_MAX = 2147483647;
const SOURCES = [100, 101, 102, 105, 153];

export class PioneersBot {
  constructor(sim) {
    this.sim = sim; this.isPioneersOpened = false; this.ingotsTraded = 0; this.forestsCleared = 0; this.ingotReserve = ZERO;
  }
  get g() { return this.sim.data; }
  get S() { return this.g.Pioneers; }
  tile(id) { return this.S.Tiles[id]; }
  nb(id, d) { return neighbor(this.S, id, d); }

  // ---- ProcessPioneersPrecisely @41671d8
  processPrecisely(end) {
    const { g, S, sim } = this;
    if (!S || sim.contentPending()) return;
    const step = sim.settings.PioneersStepSeconds * 1000;
    let t = S.Timestamp;
    while (t < end) {
      const st = processPioneers(g, Math.min(t + step, end));
      if (st !== 0) { sim.warn?.('ProcessPioneers', st); break; }
      if (S.Timestamp <= t) break;   // guard (game relies on ProcessPioneers advancing)
      t = S.Timestamp;
    }
  }

  // ---- PreparePioneers @41676dc
  prepare(now) {
    const { g, sim } = this;
    if (g && !g.Pioneers && !sim.contentPending() && sim.user.isUnlockedContents(0x74)) {
      const s = sim.settings;
      const st = ensurePioneers(g, s.EventNumber, s.Seed, s.Difficulty, sim.start, sim.end, now);
      if (st !== 0) throw new Error(`EnsurePioneers failed: ${st}`);
    }
  }

  // ---- PlayPioneers @4169d28
  play() {
    if (!this.S || this.sim.contentPending()) return;
    this.trade(); this.open(); this.connectExtractors(); this.rebalanceRoutes(); this.buildRoads(); this.buildExtractors();
    this.buildShrines(); this.buildMagicCircles(); this.upgradeFacilities(); this.spendManaStones(); this.research();
  }

  // ---- helpers
  balance(id) { return SOURCES.includes(id) ? this.g.getBalance(id) : ZERO; }                       // GetSourceBalance @417afa0
  tradingRatio(res) {                                                                                  // @417ae74
    const { TradingRatios: r, IdleManaRatio } = this.sim.settings;
    switch (res) {
      case 100: return r[0];
      case 102: return r[1];
      case 105: return r[2];
      case 153: return this.sim.isManaIdle ? Math.max(r[3], IdleManaRatio) : r[3];
      default: return 0;
    }
  }
  convCost(id) {                                                                                       // @417b0a4
    const q = getPioneersConversionQuote(this.g, id, 1), bal = this.balance(q.Source);
    return bal.gt(ZERO) ? q.Cost.div(bal) : q.Cost;
  }
  countJobs(type) { return this.S.Jobs.filter((j) => j.Action === type).length; }                    // @417a288
  buildQueue() { return this.S.Jobs.filter((j) => j.Action !== 5 && j.Action !== 6).length; }        // @417d54c
  countBuildings(fac) { return this.S.Tiles.filter((t) => t.BuildingId === fac).length; }            // @417c1b8
  tryStart(type, cell) {                                                                               // @417ad60
    if (type !== 5 && type !== 6 && this.buildQueue() > 5) return false;
    return getPioneersQuote(this.g, type, cell, 0).Allowed && startPioneersJob(this.g, type, cell) === 0;
  }
  isEmptyGrass(t) { return !!t && t.Revealed && t.Terrain === 0 && t.BuildingId === 0 && t.RoadLevel === 0 && t.JobId === 0; }  // @417b4a4
  dist(a, b) { return Math.abs(a.X - b.X) + Math.abs(a.Y - b.Y); }                                   // @417c12c
  oreValue(ore) {                                                                                      // @417ac6c
    if (ore === -1) return 0.8;
    const c = this.g.m.tryGet('PioneersConversion', ore);
    return c ? c.PointExponent : 0;
  }
  oreMoveOrder(ore) { return ore === -1 ? Number.MAX_VALUE : this.oreValue(ore); }                   // @417c47c
  fullyRevealed() { return this.S.Tiles.every((t) => t.Revealed); }                                  // @417b884
  nextToRevealed(id) {                                                                                 // @417dd0c
    for (let d = 0; d < 4; d++) { const n = this.nb(id, d); if (n >= 0 && this.tile(n).Revealed) return true; }
    return false;
  }
  onOrNextTo(set, id) {                                                                                // @417cf2c
    if (set.has(id)) return true;
    for (let d = 0; d < 4; d++) { const n = this.nb(id, d); if (n >= 0 && set.has(n)) return true; }
    return false;
  }
  shrineLoad(st) { return st.BurnRate.gt(ZERO) ? st.Inflow.div(st.BurnRate).toDouble() : 0; }       // @417bee0
  hasSpareShrine() {                                                                                   // @417b4e8
    let any = false;
    for (const t of this.S.Tiles) if (t.BuildingId === SHR) {
      any = true;
      if (this.shrineLoad(getPioneersTileStats(this.g, t.Cell)) < 1) return true;
    }
    return !any;
  }
  saturatedShrine() {                                                                                  // @417bb38 -> {id, stats}|null
    let best = 1, o = null;
    for (const t of this.S.Tiles) if (t.BuildingId === SHR) {
      const st = getPioneersTileStats(this.g, t.Cell), l = this.shrineLoad(st);
      if (l > best) { best = l; o = { id: t.Cell, stats: st }; }
    }
    return o;
  }
  canSpareIngots(q) { return q.IngotCost.le(ZERO) || this.g.PioneersIngots.sub(q.IngotCost).ge(this.ingotReserve); }  // @417d00c
  magicAnchors() {                                                                                     // @417d0e8
    const z = zones(this.S), seen = new Set(), out = new Set();
    for (const t of this.S.Tiles) { const k = z[t.Cell]; if (k >= 0 && t.MagicLevel >= 1 && t.Revealed && !seen.has(k)) { seen.add(k); out.add(t.Cell); } }
    return out;
  }
  routedExtractors() {                                                                                 // @417c4ec
    const out = new Set();
    for (const t of this.S.Tiles) if (t.BuildingId === EXT && getPioneersTransportReport(this.g, t.Cell).Allowed) out.add(t.Cell);
    return out;
  }
  routeCells() {                                                                                       // @417cbd0
    const out = new Set();
    for (const t of this.S.Tiles) if (t.BuildingId === EXT) {
      const r = getPioneersTransportReport(this.g, t.Cell).Route;
      if (r && r.Allowed) { for (const c of r.Outbound) out.add(c); for (const c of r.Return) out.add(c); }
    }
    return out;
  }

  // ---- Trade @4175b38
  trade() {
    const g = this.g;
    const list = g.m.findAll('PioneersConversion').map((c) => [c, this.convCost(c.Id)]).sort((a, b) => a[1].cmp(b[1])).map((x) => x[0]);
    for (const c of list) {
      let q = getPioneersConversionQuote(g, c.Id, 1);
      const ratio = this.tradingRatio(q.Source);
      if (!(ratio > 0)) continue;
      let budget = this.balance(q.Source).mul(ratio);
      for (let i = 0; i < 50; i++) {
        q = getPioneersConversionQuote(g, c.Id, 1);
        if (!q.Allowed || q.Cost.gt(budget)) break;
        if (convertPioneers(g, c.Id, 1) !== 0) break;
        budget = budget.sub(q.Cost);
        this.ingotsTraded++;
      }
    }
  }

  // ---- OpenPioneers @4176088
  open() {
    if (this.isPioneersOpened) return;
    const id = this.S.StartCell, t = this.tile(id);
    if (!t) return;
    if (t.BuildingId !== 0 || t.JobId !== 0 || this.tryStart(1, id)) this.isPioneersOpened = this.buildShrineNear(id);
  }

  // ---- TryBuildShrineNear @417b198
  buildShrineNear(id) {
    for (let d = 0; d < 4; d++) {
      const n1 = this.nb(id, d); if (n1 < 0) break;
      const n2 = this.nb(n1, d); if (n2 < 0) break;
      if (this.isEmptyGrass(this.tile(n1)) && this.isEmptyGrass(this.tile(n2)) && this.tryStart(2, n2)) { this.tryStart(3, n1); return true; }
    }
    for (let d = 0; d < 4; d++) {
      const n = this.nb(id, d); if (n < 0) break;
      if (this.isEmptyGrass(this.tile(n)) && this.tryStart(2, n)) return true;
    }
    return false;
  }

  // ---- FindForestPaths @417a54c -> {dist, prev}
  forestPaths() {
    const { S } = this, N = S.Tiles.length, dist = new Array(N), prev = new Array(N).fill(-1), vis = new Array(N).fill(false);
    for (let i = 0; i < N; i++) dist[i] = S.Tiles[i].BuildingId === SHR ? 0 : INT_MAX;
    for (;;) {
      let cur = -1;
      for (let i = 0; i < N; i++) if (!vis[i] && dist[i] !== INT_MAX && (cur < 0 || dist[i] < dist[cur])) cur = i;
      if (cur < 0) break;
      vis[cur] = true;
      for (let d = 0; d < 4; d++) {
        const n = this.nb(cur, d); if (n < 0 || vis[n]) continue;
        const t = S.Tiles[n]; let cost;
        if (t.Revealed && t.Terrain === 2) cost = t.JobId === 0 ? 1 : 0;
        else { if (!walkable(S, n)) continue; cost = 0; }
        if (dist[cur] + cost < dist[n]) { dist[n] = dist[cur] + cost; prev[n] = cur; }
      }
    }
    return { dist, prev };
  }

  // ---- ConnectExtractors @417618c
  connectExtractors() {
    const { g, S } = this;
    let n = this.countJobs(6);
    while (n <= 2) {
      const { dist, prev } = this.forestPaths();
      let best = -1, bestV = -Infinity;
      for (const t of S.Tiles) {
        if (t.BuildingId !== EXT) continue;
        const d = dist[t.Cell];
        if (!(d >= 1) || d === INT_MAX) continue;
        if (getPioneersTransportReport(g, t.Cell).Allowed) continue;
        const v = this.oreValue(t.OreId) + (t.OreId === -1 ? 0 : 0.001);
        if (best < 0 || v > bestV || (v === bestV && d < dist[best])) { best = t.Cell; bestV = v; }
      }
      if (best < 0) break;
      let id = best;
      while (!(this.tile(id).Terrain === 2 && this.tile(id).JobId === 0)) id = prev[id];
      if (!this.tryStart(6, id)) break;
      n++; this.forestsCleared++;
      if (n === 3) break;
    }
  }

  // ---- RebalanceRoutes @4176898
  rebalanceRoutes() {
    const { g, S } = this;
    for (let it = 0; it < 4; it++) {
      const o = this.saturatedShrine(); if (!o) return;
      let bestEx = -1, bestSh = -1, bestOrder = Number.MAX_VALUE, bestTime = Number.MAX_VALUE;
      for (const e of S.Tiles) {
        if (e.BuildingId !== EXT || e.RouteTarget !== o.id) continue;
        const order = this.oreMoveOrder(e.OreId);
        const limit = Math.max(getPioneersTransportReport(g, e.Cell).CycleSeconds * 1.5, 180);
        for (const s of S.Tiles) {
          if (s.BuildingId !== SHR || s.Cell === o.id) continue;
          if (this.shrineLoad(getPioneersTileStats(g, s.Cell)) >= 1) continue;
          const r = previewPioneersRoute(g, e.Cell, s.Cell, null);
          if (!r.Allowed) continue;
          const rt = r.CycleSeconds;
          if (rt > limit) continue;
          if (order < bestOrder || (order === bestOrder && rt < bestTime)) { bestOrder = order; bestTime = rt; bestEx = e.Cell; bestSh = s.Cell; }
        }
      }
      if (bestEx < 0) return;
      if (setPioneersRoute(g, bestEx, bestSh, null) !== 0) return;
    }
  }

  // ---- BuildRoads @4177094 / BuildRoadsOn @417c820
  buildRoads() {
    let n = this.countJobs(3);
    for (const t of this.S.Tiles) {
      if (t.BuildingId !== EXT || n >= 4) continue;
      const route = getPioneersTransportReport(this.g, t.Cell).Route;
      if (!route || !route.Allowed) continue;
      n += this.roadsOn(route.Outbound, 4 - n);
      n += this.roadsOn(route.Return, 4 - n);
    }
  }
  roadsOn(cells, limit) {
    let cnt = 0;
    for (const id of cells) {
      if (cnt >= limit) break;
      const t = this.tile(id);
      if (t.BuildingId === 0 && t.RoadLevel === 0 && t.JobId === 0 && (t.Terrain === 0 || t.Terrain === 3) && this.tryStart(3, id)) cnt++;
    }
    return cnt;
  }

  // ---- BuildExtractors @4177418 (+ comparator @41ad454)
  buildExtractors() {
    const { g, S } = this;
    this.ingotReserve = ZERO;
    const cand = [], covered = new Set();
    for (const t of S.Tiles) {
      if (!t.Revealed || t.Terrain !== 1) continue;
      if (t.BuildingId === EXT || t.JobId !== 0) covered.add(t.OreId);
      else if (t.BuildingId === 0) cand.push(t.Cell);
    }
    const anchor = this.tile(S.StartCell);
    cand.sort((a, b) => {
      const ta = this.tile(a), tb = this.tile(b), va = this.oreValue(ta.OreId), vb = this.oreValue(tb.OreId);
      return va !== vb ? (vb < va ? -1 : 1) : this.dist(ta, anchor) - this.dist(tb, anchor);
    });
    const spare = this.hasSpareShrine(), full = this.fullyRevealed();
    for (const id of cand) {
      const ore = this.tile(id).OreId;
      if (!(spare || ore === -1 || (!covered.has(ore) && this.oreValue(ore) >= 0.5))) continue;
      const q = getPioneersQuote(g, 1, id, 0);
      if (q.Status === 0x2d && full) { this.ingotReserve = q.IngotCost; break; }
      if (this.tryStart(1, id)) covered.add(ore);
    }
  }

  // ---- BuildShrines @4178018 (+ comparator @41986d8)
  buildShrines() {
    const { g, S } = this;
    if (!this.isPioneersOpened || this.countBuildings(SHR) >= this.sim.settings.MaxShrines || this.countJobs(2) > 0) return;
    for (let pass = 0; pass < 2; pass++)
      for (const t of S.Tiles) {
        if (t.BuildingId !== EXT || (pass !== 0) === (t.OreId !== -1)) continue;
        const rep = getPioneersTransportReport(g, t.Cell);
        if (rep.Allowed && rep.CycleSeconds <= 180) continue;
        if (this.buildShrineNear(t.Cell)) return;
      }
    if (this.hasSpareShrine()) return;
    const o = this.saturatedShrine(); if (!o) return;
    const ex = S.Tiles.filter((t) => t.BuildingId === EXT && t.RouteTarget === o.id).map((t) => t.Cell);
    const cyc = (id) => getPioneersTransportReport(g, id).CycleSeconds;
    ex.sort((a, b) => cyc(b) - cyc(a));
    for (const id of ex) if (this.buildShrineNear(id)) break;
  }

  // ---- BuildMagicCircles @4178864
  buildMagicCircles() {
    const { g, S } = this;
    const rc = this.routeCells(), done = new Set(), z = zones(S);
    for (const t of S.Tiles) {
      const k = z[t.Cell];
      if (k < 0 || done.has(k)) continue;
      if (t.MagicLevel >= 1) { done.add(k); continue; }
      if (!t.Revealed || t.JobId !== 0 || !this.onOrNextTo(rc, t.Cell)) continue;
      if (!this.canSpareIngots(getPioneersQuote(g, 4, t.Cell, 0))) break;
      if (this.tryStart(4, t.Cell)) done.add(k);
    }
  }

  // ---- UpgradeFacilities @4178e40
  upgradeFacilities() {
    const { g, S } = this;
    const anchors = this.magicAnchors(), routed = this.routedExtractors();
    for (let it = 0; it < 200; it++) {
      if (this.buildQueue() >= 6) break;
      let best = -1, bestType = 0, bestCost = null;
      for (const t of S.Tiles) {
        let type;
        if (t.BuildingId === EXT) { if (!routed.has(t.Cell)) continue; type = 7; }
        else if (t.BuildingId === SHR) type = 8;
        else { if (!anchors.has(t.Cell)) continue; type = 10; }
        if (t.JobId !== 0) continue;
        const q = getPioneersQuote(g, type, t.Cell, 0);
        if (!q.Allowed || !this.canSpareIngots(q)) continue;
        if (best < 0 || q.StoneCost.lt(bestCost)) { best = t.Cell; bestType = type; bestCost = q.StoneCost; }
      }
      if (best < 0 || startPioneersJob(g, bestType, best) !== 0) break;
    }
  }

  // ---- RelieveShrines @417bfac
  relieveShrines() {
    for (let i = 0; i < 200; i++) {
      const o = this.saturatedShrine(); if (!o) return;
      const upg = o.stats.Capacity.le(o.stats.BurnAmount) ? 94005 : 94006;
      if (!getPioneersQuote(this.g, 11, o.id, upg).Allowed || upgradePioneers(this.g, o.id, upg) !== 0) return;
    }
  }

  // ---- SpendManaStones @41794dc (+ Consider @417dbec, TryGetExploreCell @417d810)
  spendManaStones() {
    const { g, S } = this;
    this.relieveShrines();
    const anchors = this.magicAnchors(), rc = this.routeCells(), routed = this.routedExtractors();
    const upgrades = g.m.findAll('PioneersUpgrade');
    for (let it = 0; it < 200; it++) {
      let best = null;
      const consider = (type, cell, upgrade) => {
        const q = getPioneersQuote(g, type, cell, upgrade);
        if (q.Allowed && (!best || q.StoneCost.lt(best.cost))) best = { id: cell, type, upgrade, cost: q.StoneCost };
      };
      if (this.countJobs(5) <= 1) {
        const cell = this.exploreCell();
        if (cell >= 0) consider(5, cell, 0);
      }
      for (const t of S.Tiles) {
        let fac = t.BuildingId, skip = false;
        if (fac === 0) { if (anchors.has(t.Cell)) fac = MAGIC; else skip = true; }
        else if (fac === EXT && !routed.has(t.Cell)) skip = true;
        if (!skip) for (const u of upgrades) if (u.FacilityId === fac) consider(11, t.Cell, u.Id);
        if (t.RoadLevel >= 1 && t.JobId === 0 && rc.has(t.Cell) && this.buildQueue() === 0) consider(9, t.Cell, 0);
      }
      if (!best) break;
      const st = best.type === 11 ? upgradePioneers(g, best.id, best.upgrade) : startPioneersJob(g, best.type, best.id);
      if (st !== 0) break;
    }
  }
  exploreCell() {
    const anchor = this.tile(this.S.StartCell); let out = -1, bd = INT_MAX;
    for (const t of this.S.Tiles) if (!t.Revealed && t.JobId === 0 && this.nextToRevealed(t.Cell)) {
      const d = this.dist(t, anchor); if (d < bd) { bd = d; out = t.Cell; }
    }
    return out;
  }

  // ---- ResearchPioneers @4179db8
  research() {
    const { g, sim } = this;
    let ratio = sim.settings.PioneersResearchManaRatio;
    if (sim.isManaIdle) ratio = Math.max(ratio, sim.settings.IdleManaRatio);
    let budget = g.getBalance(153).mul(ratio);
    const list = g.m.findAll('PioneersResearch');
    for (let i = 0; i < 50; i++) {
      const noSat = !this.saturatedShrine();
      let best = 0, bestStone = ZERO;
      for (const r of list) {
        if (!noSat && ![95004, 95005, 95008].includes(r.Id)) continue;
        const q = getPioneersQuote(g, 12, -1, r.Id);
        if (!q.Allowed || !q.ManaCost.le(budget)) continue;
        if (best !== 0 && !q.StoneCost.lt(bestStone)) continue;
        best = r.Id; bestStone = q.StoneCost;
      }
      if (best === 0) break;
      const before = g.getBalance(153);
      if (researchPioneers(g, best) !== 0) break;
      budget = budget.sub(before.sub(g.getBalance(153)));
    }
  }
}
