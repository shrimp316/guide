// U4 / batch: NewWorld content time-progress engine ("process batches") + world tree.
// Ported from ARM64 disassembly of libil2cpp (decompile of these methods is mangled by Ghidra); addresses = hex vaddrs.
// See U4_BATCH_NOTES.md for state layout, uncertainties and open questions.
//
// Conventions (same as world_arc.js / world_clock.js): fn(gd, status, ...args); gd = shared GameData state (plain object),
// gd.m = Master. C# int codes kept (0 ok, 0x134 "still processing", 0x138 bad timestamp, 0x384(900) bad state, 0x241 no gain...).
// Timestamps = JS ms Number (timestamp.js; 0 = invalid, fractional ms allowed because batch math is in 100ns ticks);
// TimeSpan *ticks* (1e7/s) are plain Numbers (exact below 2^53); `dt`/`secs` args are seconds (double).
//
// State added by initNewWorldState(gd)  (offsets = GameData fields):
//   gd.nw = {
//     power    BN +0x12b8  world tree "power" (drives soul production)      soul     BN +0x12c8  world tree "soul" (drives mana production)
//     bonus    BN +0x12d8  accumulated growth bonus (efficiency = 1 + bonus)
//     contentTime ts +0x12e8  content progressed up to            contentEnd ts +0x12f0  sealed end of content (season end)
//     rate300  BN +0x12f8  tree-soul production bonus (type 300, /dynamic bonus)   rate910 BN +0x1308 (type 0x38e = 910, mana)
//     reservedPower BN +0x1318, reservedSoul BN +0x1328   gains received while a batch was pending (merged at batch finish)
//     processing bool +0x1338 re-entrancy guard           batches [] +0x1340 List<batch>     batchSeq int +0x1348
//     next300 BN|null +0x1350 (Nullable)  next910 BN|null +0x1368   applied when the queue drains (ApplyNewWorldNextBonuses)
//     lastReserveTime ts +0x1380          lastBatch +0x13a0 (object pool; unused in JS)
//     modeRate BN|null +0x10c0 (Nullable<BN>; NW mode-content science rate)   modeDirty bool +0x10d8   modeTime ts +0x10a8
//     processCount int +0xa94 (verification counter)
//   }
// Fields read from other units: gd.arc.{busy,lastProgress}(+0x1110,+0x10f8), gd.ct.{last,goldRate,powerRate,crystalRate}(+0x1178,+0x1180..),
//   gd.rampage.{start,end}(+0x11b0,+0x11b8), gd.pass.{entitlement,until}(+0x11d8,+0x11d0), gd.clearedField(+0x13f0), gd.gameMode(+0x410),
//   gd.nwLocked|gd.locked13a8 (+0x13a8), gd.nwWorldId|gd.newWorldId (+0x420), gd.gameTime (MainManager.TryGetGameTime),
//   gd.Pioneers (+0x1200; .Timestamp +0x38), gd.mana/soul/science.
//
// Batch object (NewWorldProcessBatch, fields by offset):
//   id +0x10  start +0x18  end +0x20  target +0x28  contentTicks +0x30  extraTicks +0x38 (virtual dt)  done +0x40  queuePos +0x48
//   passTicks +0x50  passBoundary +0x58  clockAhead +0x60  modeAhead +0x68  started +0x70  rampStart +0x78  rampEnd +0x80
//   rampExtra +0x88  rampMult +0x90  rampMultCur +0x98  rate300 +0xa0  rate910 +0xb0  goldRate +0xc0  powerRate +0xd0  crystalRate +0xe0
//   modeRate +0xf0 (BN|null)  snapshot +0x108 (Map)  reservePower +0x110  reserveSoul +0x120
//   totalTicks = contentTicks + extraTicks (@3c4317c); remainingTicks = total - done (@3c43188).
import { BigNumber } from './bignum.js';
import { isValid, addSeconds, totalSeconds } from './timestamp.js';
import * as clock from './world_clock.js';
import * as arc from './world_arc.js';
import { modifySoul as econModifySoul } from './econ_soul.js';
import { arcNodeUpgradeCost } from './expr_y.js';

const { ZERO, ONE } = BigNumber;
const TICK_MS = 1e4;            // ticks per ms
const TICKS_S = 1e7;            // ticks per second (dRam15e65e8)
const INT_MAX = 0x7fffffff;
const SEVEN_DAYS_S = 604800;    // dRam15e5680
const E3 = new BigNumber(0.001); // BigNumber static +0x78 (series threshold)
const LOG2 = 0.3010299956639812;  // [15e5fb0]
const LOG10E = 0.4342944819032518; // [15e54e0]
const roundEven = clock.roundHalfEven;
const mn = Math.min, mx = Math.max;

// ---------------------------------------------------------------------------------------------------------------
// externals (other units). Override with setDeps(). Defaults are no-op / identity where the unit is not wired yet.
export const deps = {
  /** pioneers (U5): all default to "no pioneers" */
  getPioneersBoundaryTicks: (gd, status, ticks) => ticks,                     // GameData.GetPioneersBoundaryTicks @3c0be80
  beginPioneersProgress: (gd, status, totalSec, extraSec, startTs) => {},     // @3c0b34c
  endPioneersProgress: (gd, status) => {},                                    // @3c0c894
  resumePioneersProgress: (gd, status) => {},                                 // @3c0b7d4
  progressPioneers: (gd, status, dtSec) => {},                                // @3c0c530
  refreshPioneersExternalEffects: (gd, status, snapshot) => {},               // @3bf91f4 (called from ApplyNewWorldBatchRates)
  /** values copied into batch.snapshot at creation: Map(type -> BigNumber) from status.pioneersExternalEffects (+0x50) / gd +0x1288 */
  snapshotPioneersEffects: (gd, status) => new Map(),
  pioneersTimestamp: (gd) => (gd.Pioneers ? gd.Pioneers.Timestamp ?? 0 : 0),   // PioneersStateData +0x38
  isPioneersBusy: (gd) => !!gd.busy1228,                                      // byte at GameData +0x1228 (meaning unknown)
  /** economy (U3). modifySoul default = econ_soul.modifySoul (calls the g.addWorldTreeSoul hook, see installWorldTreeHooks) */
  modifySoul: (gd, v) => econModifySoul(gd, v),
  modifyMana: (gd, v) => arc.modifyMana(gd, v),
  modifyScience: (gd, v) => { gd.science = (gd.science ?? ZERO).add(v); },     // GameData.ModifySciencePoint @3ba48f8 (plain add)
  /** UpgradeStatus.GetNewWorldPassMultiplier(type) @3aedab4 (static): product of MembershipStat nw_pass rows with ValueType 3 */
  getNewWorldPassMultiplier: (m, type) => {
    let r = ONE;
    for (const s of m.findAll('MembershipStat')) {
      if (s.Id === 'nw_pass' && s.UpgradeType === type && s.ValueType === 3) r = r.mul(new BigNumber(s.Value));
    }
    return r;
  },
};
export const setDeps = (o) => Object.assign(deps, o);

const mode = (gd) => gd.gameMode ?? 10;
const locked = (gd) => !!(gd.nwLocked || gd.locked13a8);
const passMult = (gd, type) => deps.getNewWorldPassMultiplier(gd.m, type);
const dyn = (gd, status, type) => arc.getNewWorldDynamicBonus(gd, status, type);
const bnMin = (a, b) => (a.lt(b) ? a : b);                  // sub_3c3881c (BigNumber.Min)
const tickDiff = (a, b) => Math.round((b - a) * TICK_MS);    // (Timestamp b - Timestamp a).Ticks
const addTicks = (ts, t) => ts + t / TICK_MS;

// ---------------------------------------------------------------------------------------------------------------
// state
export function initNewWorldState(gd) {
  gd.nw ??= {
    power: ZERO, soul: ZERO, bonus: ZERO, contentTime: 0, contentEnd: 0, rate300: ONE, rate910: ONE,
    reservedPower: ZERO, reservedSoul: ZERO, processing: false, batches: [], batchSeq: 0, next300: null, next910: null,
    lastReserveTime: 0, modeRate: null, modeDirty: false, modeTime: 0, processCount: 0,
  };
  gd.mana ??= ZERO; gd.soul ??= ZERO; gd.science ??= ZERO; gd.gameMode ??= 10;
  return gd.nw;
}

/** CopyPermanentPlayDataWorldTree @3c11784 (reset branch: different mode / pass level) + InitWorldTree @3c11364 */
export function resetWorldTree(gd) {
  const w = gd.nw;
  w.power = ZERO; w.soul = ZERO; w.bonus = ZERO; w.contentTime = 0;
  w.rate300 = ONE; w.rate910 = ONE; w.reservedPower = ZERO; w.reservedSoul = ZERO;
  w.batches = []; w.batchSeq = 0; w.processing = false; w.next300 = null; w.next910 = null; w.lastReserveTime = 0;
}

/** Install the callbacks U3 (econ_soul.modifySoul -> g.addWorldTreeSoul(amount); econ_gold.modifyPower -> g.hooks.addWorldTreePower(g, amt)). */
export function installWorldTreeHooks(gd) {
  if (!gd.addWorldTreeSoul) gd.addWorldTreeSoul = (amt) => addWorldTreeSoul(gd, gd.status ?? null, amt);
  gd.hooks ??= {};
  if (!gd.hooks.addWorldTreePower) gd.hooks.addWorldTreePower = (g, amt) => addWorldTreePower(g, g.status ?? null, amt);
}

/** get_IsNewWorldContentPending @3b93d40 */
export const isNewWorldContentPending = (gd) => gd.nw.batches.length > 0;

// ---------------------------------------------------------------------------------------------------------------
// Expression: world tree formulas (ARM64 only; Ghidra's BigNumber math is garbled)
const wt = (m) => m.setting('WorldTreeSetting');

/** Expression.IsWorldTreeSettingValid @4159e80 */
export function isWorldTreeSettingValid(m) {
  const s = wt(m);
  if (!s) return false;
  if (!BigNumber.parse(s.SoulPowerDivider).gt(ZERO)) return false;
  if (!BigNumber.parse(s.GrowthSoulScale).gt(ZERO)) return false;
  if (!Number.isFinite(s.ManaLogOffset)) return false;
  if (!(s.GrowthLogScale > 0) || !Number.isFinite(s.GrowthLogScale)) return false;
  if (!(s.GrowthExponent > 0 && s.GrowthExponent < 1)) return false;
  if (s.GrowthLogScale * s.GrowthExponent > 1) return false;
  return s.GrowthMinRate > 0 && Number.isFinite(s.GrowthMinRate);
}

/** WorldTreeLogOnePlus @415b070: ln(1+x) for BN x (x<=0 -> 0; x<0.001 -> 6-term series) */
export function worldTreeLogOnePlus(x) {
  if (x.le(ZERO)) return ZERO;
  if (x.ge(E3)) return ONE.add(x).ln();
  const q = x.toDouble();
  let d = q / -6 + 0.2;
  d = q * d + -0.25;
  d = q * d + 0.3333333333333333;
  d = q * d + -0.5;
  return x.mul(q * d + 1.0);
}

/** WorldTreeExponentialMinusOne @415b454: e^x - 1 */
export function worldTreeExponentialMinusOne(x) {
  if (x.le(ZERO)) return ZERO;
  if (x.lt(E3)) {
    const q = x.toDouble();
    let d = q / 720 + 0.008333333333333333;
    d = q * d + 0.041666666666666664;
    d = q * d + 0.16666666666666666;
    d = q * d + 0.5;
    return x.mul(q * d + 1.0);
  }
  const y = x.toDouble() * LOG10E;
  const f = Math.floor(y / 3);
  const e3 = f === Infinity || Number.isNaN(f) ? -2147483648 : f | 0;
  return new BigNumber(Math.pow(10, y - e3 * 3), e3).sub(ONE);
}

/** Expression.WorldTreeGrowthBonus @415b1f4 (soul BN -> BN) */
export function worldTreeGrowthBonus(m, s) {
  if (s.le(ZERO) || !isWorldTreeSettingValid(m)) return ZERO;
  const st = wt(m);
  const x = s.div(BigNumber.parse(st.GrowthSoulScale));
  const a = worldTreeLogOnePlus(x).mul(LOG10E);
  const b = a.mul(st.GrowthLogScale);
  const c = worldTreeLogOnePlus(b);
  const d = c.mul(st.GrowthExponent);
  const e = worldTreeExponentialMinusOne(d);
  return worldTreeExponentialMinusOne(e.div(LOG10E));
}

/** Expression.WorldTreeManaThreshold @415a4f8 = 10^ManaLogOffset as BN */
export function worldTreeManaThreshold(m) {
  const off = wt(m).ManaLogOffset;
  const f = Math.floor(off / 3);
  const e3 = f === Infinity || Number.isNaN(f) ? -2147483648 : f | 0;
  return new BigNumber(Math.pow(10, off - e3 * 3), e3);
}

/** Expression.WorldTreeSoulPerSecond @415a13c */
export function worldTreeSoulPerSecond(m, power, eff, bonus) {
  const div = BigNumber.parse(wt(m).SoulPowerDivider);
  if (power.le(ZERO) || div.le(ZERO)) return ZERO;
  return power.div(div).mul(eff).mul(bonus);
}

/** Expression.WorldTreeManaPerSecond @415a338 */
export function worldTreeManaPerSecond(m, soul, eff, bonus) {
  if (soul.le(ZERO)) return ZERO;
  const T = worldTreeManaThreshold(m);
  const q = soul.div(T);
  const v = soul.lt(T) ? q.pow(LOG2) : q.log10();
  return v.mul(eff).mul(bonus);
}

/** Expression.WorldTreeManaPowerAverage @415ab3c: average of (x/T)^log10(2) for x in [a, a+b] */
export function worldTreeManaPowerAverage(a, b, T) {
  if (a.gt(ZERO)) {
    const r = b.div(a);
    if (r.lt(E3)) {
      const q = r.toDouble();
      let d = q * -0.6989700043360187;
      d = d * 1.6989700043360187;
      d = d * 2.6989700043360187;
      d = d / 120.0;
      d = d + 0.049480377970729704;
      d = q * d;
      d = d + -0.11649500072266979;
      d = q * d;
      d = d + 0.5;
      const f = q * LOG2 * d + 1.0;
      return a.div(T).pow(LOG2).mul(f);
    }
  }
  const s = a.add(b);
  const r1 = a.div(s);
  const r2 = s.div(T);
  const num = r2.pow(LOG2).mul(ONE.sub(r1.pow(1.3010299956639813)));
  const den = ONE.sub(r1).mul(1.3010299956639813);
  return num.div(den);
}

/** Expression.WorldTreeManaLogAverage @415ae34: average of log10(x/T) for x in [a, a+b] */
export function worldTreeManaLogAverage(a, b, T) {
  const q = b.div(a);
  if (q.lt(E3)) {
    const d = q.toDouble();
    let t = d / 30 + -0.05;
    t = d * t;
    t = t + 0.08333333333333333;
    t = d * t;
    t = t + -0.16666666666666666;
    const S = d * t + 0.5;
    return a.div(T).log10().add(q.mul(S).mul(LOG10E));
  }
  const L1 = a.add(b).div(T).log10().sub(LOG10E);
  return L1.add(worldTreeLogOnePlus(q).div(q).mul(LOG10E));
}

/** Expression.WorldTreeProduction @415a62c -> {soul, mana} produced during dt seconds */
export function worldTreeProduction(m, dt, power, soul0, eff, b300, b910) {
  let soul = ZERO, mana = ZERO;
  if (dt > 0 && Number.isFinite(dt)) {
    soul = worldTreeSoulPerSecond(m, power, eff, b300).mul(dt);
    let rate;
    if (soul.gt(ZERO)) {
      const cur0 = ZERO.gt(soul0) ? ZERO : soul0;           // max(0, tree soul)
      const T = worldTreeManaThreshold(m);
      let acc = ZERO, rem = soul, cur = cur0;
      if (cur0.lt(T)) {
        const u = bnMin(soul, T.sub(cur0));
        acc = worldTreeManaPowerAverage(cur0, u, T).mul(u.div(soul));
        rem = soul.sub(u);
        cur = T;
      }
      if (rem.gt(ZERO)) acc = acc.add(worldTreeManaLogAverage(cur, rem, T).mul(rem.div(soul)));
      if (ZERO.gt(acc)) acc = ZERO;
      rate = acc.mul(eff).mul(b910);
    } else {
      rate = worldTreeManaPerSecond(m, soul0, eff, b910);
    }
    mana = rate.mul(dt);
  }
  return { soul, mana };
}

// ---------------------------------------------------------------------------------------------------------------
// world tree getters
/** GetReservedWorldTreeGain @3c10ad0: sum of batch reserves (isPower ? +0x110 : +0x120) */
export function getReservedWorldTreeGain(gd, isPower) {
  let r = ZERO;
  for (const b of gd.nw.batches) r = r.add(isPower ? b.reservePower : b.reserveSoul);
  return r;
}
export const worldTreePower = (gd) => gd.nw.power.add(gd.nw.reservedPower).add(getReservedWorldTreeGain(gd, true));   // @3c10a28
export const worldTreeSoul = (gd) => gd.nw.soul.add(gd.nw.reservedSoul).add(getReservedWorldTreeGain(gd, false));      // @3c10ca8
export const worldTreeEfficiency = (gd) => ONE.add(gd.nw.bonus);                                                      // @3c10d60
/** get_WorldTreeGrowthMultiplier @3c10dc8: magic-theme world => BonusParam2 (>0), else 1 */
export function worldTreeGrowthMultiplier(gd) {
  if (mode(gd) === 10) {
    const w = gd.m.tryGetNewWorld(gd.nwWorldId ?? gd.newWorldId);
    if (w && w.Theme === 'nw_magic' && w.BonusParam2 > 0) return new BigNumber(w.BonusParam2);
  }
  return ONE;
}
/** GetWorldTreeGrowthGain @3c15ab0 */
export const getWorldTreeGrowthGain = (gd) => worldTreeGrowthBonus(gd.m, worldTreeSoul(gd)).mul(worldTreeGrowthMultiplier(gd));

/** CanGrowWorldTree @3c15b78 */
export function canGrowWorldTree(gd) {
  const w = gd.nw;
  if (w.processing || w.batches.length > 0 || mode(gd) !== 10 || locked(gd) || !isWorldTreeSettingValid(gd.m)) return false;
  return getWorldTreeGrowthGain(gd).ge(worldTreeEfficiency(gd).mul(wt(gd.m).GrowthMinRate));
}

/** GrowWorldTree @3c15d0c (gd, status, now) -> code (0 ok, 0x241 gain too small, 0x138 bad ts, 900 busy/after end) */
export function growWorldTree(gd, status, now) {
  const w = gd.nw;
  if (!isValid(now) || !isValid(w.contentEnd)) return 0x138;
  if (w.processing || now >= w.contentEnd) return 900;
  const rc = processNewWorldBatches(gd, status, 0, now, false, INT_MAX, false);
  if (rc !== 0) return rc;
  const gain = getWorldTreeGrowthGain(gd);
  if (gain.le(ZERO)) return 0x241;
  if (gain.lt(worldTreeEfficiency(gd).mul(wt(gd.m).GrowthMinRate))) return 0x241;
  w.bonus = w.bonus.add(gain);
  w.power = ZERO; w.soul = ZERO; w.reservedPower = ZERO; w.reservedSoul = ZERO;
  return 0;
}

// AddWorldTreePower @3ba3198 / AddWorldTreeSoul @3ba3dc0 (identical but for the fields touched)
function addWorldTreeGain(gd, status, amt, isPower) {
  const w = gd.nw;
  amt = BigNumber.of(amt);
  if (amt.le(ZERO) || mode(gd) !== 10 || locked(gd)) return;
  if (w.processing) { if (isPower) w.power = w.power.add(amt); else w.soul = w.soul.add(amt); return; }
  const hasTime = isValid(gd.gameTime);
  let direct = false;
  if (hasTime) {
    const rc = processNewWorldBatches(gd, status, 0, gd.gameTime, false, INT_MAX, false);
    if (rc === 0x134) { reserveWorldTreeGain(gd, status, gd.gameTime, amt, isPower); return; }
    if (rc === 0) direct = true;
  }
  if (direct) { if (isPower) w.power = w.power.add(amt); else w.soul = w.soul.add(amt); return; }
  if (isPower) w.reservedPower = w.reservedPower.add(amt); else w.reservedSoul = w.reservedSoul.add(amt);
  if (hasTime && gd.gameTime > w.lastReserveTime) w.lastReserveTime = gd.gameTime;
}
export const addWorldTreePower = (gd, status, amt) => addWorldTreeGain(gd, status, amt, true);
export const addWorldTreeSoul = (gd, status, amt) => addWorldTreeGain(gd, status, amt, false);

/** ReserveWorldTreeGain @3c150b4: put `amt` on a (new) batch ending at ts (clamped to contentEnd) so it lands when that batch finishes */
export function reserveWorldTreeGain(gd, status, ts, amt, isPower) {
  const w = gd.nw;
  const t = ts < w.contentEnd ? ts : w.contentEnd;
  appendNewWorldBatch(gd, null, 0, t);
  const b = w.batches.length ? w.batches[w.batches.length - 1] : null;
  if (b) { if (isPower) b.reservePower = b.reservePower.add(amt); else b.reserveSoul = b.reserveSoul.add(amt); }
  else if (isPower) w.power = w.power.add(amt); else w.soul = w.soul.add(amt);
}

// ---------------------------------------------------------------------------------------------------------------
// batch time helpers
export const batchTotalTicks = (b) => b.contentTicks + b.extraTicks;       // @3c4317c
export const batchRemainingTicks = (b) => b.contentTicks + b.extraTicks - b.done; // @3c43188

/** GetNewWorldBatchContentTicks @3c14350: content ticks (real ticks + rampage extra) between two timestamps of batch b */
export function getNewWorldBatchContentTicks(b, from, to) {
  if (to <= from) return 0;
  const lo = from > b.rampStart ? from : b.rampStart;           // max(from, rampStart)
  const hi = to < b.rampEnd ? to : b.rampEnd;                   // min(to, rampEnd)
  let extra = 0;
  if (isValid(b.rampStart) && hi > lo) extra = roundEven(b.rampExtra * tickDiff(lo, hi));
  return tickDiff(from, to) + extra;
}

/** GetNewWorldBatchTime @3c154b0: timestamp at which `ticks` content ticks of the batch have elapsed */
export function getNewWorldBatchTime(b, ticks) {
  if (ticks >= b.contentTicks) return b.end;
  if (b.rampExtra > 0 && isValid(b.rampStart) && !(b.rampEnd <= b.start) && !(b.rampStart >= b.end)) {
    let lo = 0, hi = tickDiff(b.start, b.end);                  // search in ticks after batch start
    if (hi <= lo) return b.start;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (getNewWorldBatchContentTicks(b, b.start, addTicks(b.start, mid)) < ticks) lo = mid + 1; else hi = mid;
    }
    return addTicks(b.start, lo);
  }
  return addTicks(b.start, ticks);
}

/** GetClockTowerRampageBoundaryTicks @3c15268 -> {ticks, scale}: cut `ticks` at the rampage window edge; scale = gold/power multiplier of the slice */
export function getClockTowerRampageBoundaryTicks(gd, status, b, ticks) {
  let scale = 1.0;
  if (b.done >= b.contentTicks) return { ticks, scale: b.rampMultCur };
  const wStart = b.start > b.rampStart ? b.start : b.rampStart;       // max(start, rampStart)
  const wEnd = b.end < b.rampEnd ? b.end : b.rampEnd;                 // min(end, rampEnd)
  if (isValid(b.rampStart) && wEnd > wStart) {
    const toWin = getNewWorldBatchContentTicks(b, b.start, wStart) - b.done;
    if (toWin > 0) return { ticks: mn(ticks, toWin), scale };       // before the window: normal speed
    const toEnd = getNewWorldBatchContentTicks(b, b.start, wEnd) - b.done;
    if (toEnd > 0) return { ticks: mn(ticks, toEnd), scale: b.rampMult };
  }
  return { ticks, scale };
}

/** GetWorldTreeArcBoundaryTicks @3c1561c: shorten `ticks` so that no arc node finishes a level in the middle of a step. */
export function getWorldTreeArcBoundaryTicks(gd, status, ticks) {
  const lim = new BigNumber(ticks / TICKS_S);            // fixed from the incoming value (not updated)
  let out = ticks;
  for (const [id, nd] of gd.arc.nodes) {
    if (nd.p.le(ZERO)) continue;
    const max = arc.getArcNodeMaxLevel(gd, status, id);
    if (!(max > nd.level)) continue;
    const base = gd.m.tryGet('Ark', id);
    if (!base) continue;
    const cost1 = arcNodeCost(gd, base, nd.level, 1);
    const t = cost1.sub(nd.q).div(nd.p);                  // seconds until the next level
    if (t.ge(lim)) continue;
    out = mn(out, mx(1, Math.ceil(t.toDouble() * TICKS_S)));
  }
  return out;
}
const arcNodeCost = (gd, row, level, n) => arcNodeUpgradeCost(gd.m, row, level, n);

// ---------------------------------------------------------------------------------------------------------------
// validation / mode content
/** ValidateNewWorldContentProgress @3c11bec (gd, status, dt, now, end) */
export function validateNewWorldContentProgress(gd, status, dt, now, end) {
  const w = gd.nw;
  if (!isValid(now) || !isValid(end)) return 0x138;
  if (dt > 0 && now >= end) return 0x130;
  if (w.processing || gd.arc.busy || deps.isPioneersBusy(gd) || mode(gd) !== 10 || locked(gd)) return 900;
  if (!isWorldTreeSettingValid(gd.m)) return 900;
  const arcOk = arc.isWorldTreeArcValid(gd, status);
  if (dt < 0 || !arcOk || !Number.isFinite(dt)) return 900;
  if (dt > 922337203685.4775807 - 1209600) return 900;          // TimeSpan.MaxValue.TotalSeconds - 14d
  const t = now < end ? now : end;
  const rc = clock.validateClockTowerProgress(gd.m, gd, dt, t);
  if (rc !== 0) return rc;
  if (isValid(w.contentTime) && t < w.contentTime) return 0x138;
  if (isValid(gd.arc.lastProgress) && t < gd.arc.lastProgress) return 0x138;
  const pt = deps.pioneersTimestamp(gd);
  if (gd.Pioneers && isValid(pt) && t < pt) return 0x138;
  if (isValid(w.modeTime) && t < w.modeTime) return 0x138;
  let base = isValid(w.contentTime) ? w.contentTime : t;
  if (totalSeconds(t - base) > SEVEN_DAYS_S) base = addSeconds(t, -SEVEN_DAYS_S);
  if (w.batches.length > 0) return 0;
  return gd.arc.lastProgress > base ? 900 : 0;
}

/** PrepareNewWorldModeContent @3beac9c */
export function prepareNewWorldModeContent(gd, status, now) {
  const w = gd.nw;
  if (!isValid(now)) return 0x138;
  if (isValid(w.modeTime) && now < w.modeTime) return 0x138;
  if (mode(gd) !== 10 || locked(gd)) return 900;
  if (!isValid(w.modeTime)) w.modeTime = now;
  if (!w.modeRate) refreshNewWorldModeContentRates(gd, status);
  return 0;
}

/** GetNewWorldModeContentRate @3beab6c: science production rate (type 0x140) without dynamic/pass bonuses */
export function getNewWorldModeContentRate(gd, status) {
  let r = status.get(0x140, ZERO).div(dyn(gd, status, 0x140));
  if (status.isNewWorldPassApplied) r = r.div(passMult(gd, 0x140));
  return r;
}
/** RefreshNewWorldModeContentRates @3beade8 */
export function refreshNewWorldModeContentRates(gd, status) { gd.nw.modeRate = getNewWorldModeContentRate(gd, status); }

/** ProgressNewWorldModeContent @3beaf10: science += dt * rate * dynamic(0x140) [* passMult(0x140) if the pass covers the slice] */
export function progressNewWorldModeContent(gd, status, dt, passed) {
  const w = gd.nw;
  if (!(dt > 0) || !w.modeRate) return;
  let v = w.modeRate.mul(dyn(gd, status, 0x140)).mul(dt);
  if (passed) v = v.mul(passMult(gd, 0x140));
  deps.modifyScience(gd, v);
  w.modeDirty = true;
  if (!w.processing) w.modeDirty = false;                   // (UI event) fired immediately when not inside a batch loop
}

// ---------------------------------------------------------------------------------------------------------------
// batches
/** ApplyNewWorldNextBonuses @3c15018 */
export function applyNewWorldNextBonuses(gd) {
  const w = gd.nw;
  if (w.next300) { w.rate300 = w.next300; w.next300 = null; }
  if (w.next910) { w.rate910 = w.next910; w.next910 = null; }
}

/**
 * AppendNewWorldBatch @3c13700 (gd, status|null, dt, t) -> id (>0) or 0 when nothing to append.
 * dt = virtual extra seconds; t = target timestamp. Span is cut to 7 days. status == null keeps the rates stored in gd.
 */
export function appendNewWorldBatch(gd, status, dt, t) {
  const w = gd.nw;
  const prev = w.batches.length ? w.batches[w.batches.length - 1] : null;
  let start = prev ? prev.target : w.contentTime;
  if (!isValid(start)) start = t;
  if (t < start) return 0;
  if (dt <= 0 && t === start) return 0;
  let end = t;
  if (totalSeconds(t - start) > SEVEN_DAYS_S) end = addSeconds(start, SEVEN_DAYS_S);
  const s = gd.m.setting('ClockTowerSetting');
  const pass = gd.pass ?? { entitlement: false, until: 0 };
  const rampage = gd.rampage ?? { start: 0, end: 0 };
  const b = {
    id: ++w.batchSeq, start, end, target: t, done: 0, started: false,
    queuePos: prev ? prev.queuePos + batchTotalTicks(prev) : 0,
    passBoundary: pass.entitlement ? end : pass.until,
    rampStart: rampage.start, rampEnd: rampage.end,
    rampExtra: 0, rampMult: 0, rampMultCur: 1,
    contentTicks: 0, extraTicks: 0, passTicks: 0, clockAhead: 0, modeAhead: 0,
    reservePower: ZERO, reserveSoul: ZERO,
    rate300: w.rate300, rate910: w.rate910,
    goldRate: gd.ct.goldRate, powerRate: gd.ct.powerRate, crystalRate: gd.ct.crystalRate, modeRate: w.modeRate,
    snapshot: null,
  };
  if (b.rampEnd > b.passBoundary) b.rampEnd = b.passBoundary;
  b.rampExtra = mx(0, s.TimeRampageTimeScale - 1.0);
  b.rampMult = s.TimeRampageGoldAndPower;
  b.rampMultCur = clock.isTimeRampageActive(gd, end) ? b.rampMult : 1.0;
  b.contentTicks = getNewWorldBatchContentTicks(b, start, end);
  b.extraTicks = roundEven(dt * TICKS_S);
  b.passTicks = getNewWorldBatchContentTicks(b, start, end < b.passBoundary ? end : b.passBoundary);
  if (clock.isNewWorldPassEnabledAt(gd, end)) b.passTicks += b.extraTicks;
  b.snapshot = deps.snapshotPioneersEffects(gd, status);
  if (status) {
    b.rate300 = status.getWorldTreeProductionBonus(300).div(dyn(gd, status, 300));
    b.rate910 = status.getWorldTreeProductionBonus(0x38e).div(dyn(gd, status, 0x38e));
    b.goldRate = clock.clockTowerEarningGold(gd.m, mx(1, gd.clearedField ?? 0), status);
    b.powerRate = clock.miningPower(gd.m, clock.deps.getAllWeaponPower(gd, status), status);
    if (status.isNewWorldPassApplied) {
      b.rate300 = b.rate300.div(passMult(gd, 300));
      b.rate910 = b.rate910.div(passMult(gd, 0x38e));
      b.goldRate = b.goldRate.div(passMult(gd, 1));
      b.powerRate = b.powerRate.div(passMult(gd, 2));
    }
    b.goldRate = b.goldRate.div(clock.deps.getClockTowerGoldArcBonus(gd.m, gd, status));
    b.powerRate = b.powerRate.div(clock.deps.getClockTowerPowerArcBonus(gd.m, gd, status));
    b.crystalRate = clock.getClockTowerWorldCrystalBaseRate(gd.m, gd);
    b.modeRate = getNewWorldModeContentRate(gd, status);
  }
  w.batches.push(b);
  return b.id;
}

/** ApplyNewWorldBatchRates @3c14550: load the batch's rates into gd */
export function applyNewWorldBatchRates(gd, status, b) {
  const w = gd.nw;
  w.rate300 = b.rate300; w.rate910 = b.rate910;
  gd.ct.goldRate = b.goldRate; gd.ct.powerRate = b.powerRate; gd.ct.crystalRate = b.crystalRate;
  w.modeRate = b.modeRate;
  if (!b.started) deps.refreshPioneersExternalEffects(gd, status, b.snapshot);
}

/** ProgressClockTowerBatchInterval @3c149e8: advance the clock tower [from, to) before the batch with rampage/pass-aware slices */
export function progressClockTowerBatchInterval(gd, status, b, from, to) {
  while (from < to) {
    let seg = to;
    const beforePass = from < b.passBoundary;
    if (beforePass && b.passBoundary < to) seg = b.passBoundary;
    const inRamp = isValid(b.rampStart) && from >= b.rampStart && from < b.rampEnd;
    if (isValid(b.rampStart) && from < b.rampStart) { if (b.rampStart < seg) seg = b.rampStart; }
    else if (inRamp && b.rampEnd < seg) seg = b.rampEnd;
    const ct = getNewWorldBatchContentTicks(b, from, seg);
    const span = totalSeconds(seg - from);
    clock.progressClockTower(gd.m, gd, status, beforePass, ct / TICKS_S, span, inRamp ? b.rampMult : 1.0);
    from = seg;
  }
}

/** ProcessArc @3bee7a8: catch the arc nodes up to ts (with rampage extra seconds) */
export function processArc(gd, status, ts) {
  if (!isValid(ts)) return 0x138;
  if (gd.arc.busy || mode(gd) !== 10 || locked(gd)) return 900;
  for (const id of gd.arc.nodes.keys()) {
    const base = gd.m.tryGet('Ark', id);
    if (!base || !((base.CostUp ?? 0) >= 1) || BigNumber.parse(base.Cost).le(ZERO)) return 900;
  }
  const last = gd.arc.lastProgress;                          // TryGetProcessSeconds @3b5e83c
  if (isValid(last)) {
    const d = totalSeconds(ts - last);
    if (d > 0) {
      let secs = mn(d, SEVEN_DAYS_S);
      secs += clock.getTimeRampageExtraSeconds(gd.m, gd, addSeconds(ts, -secs), ts);
      arc.progressArc(gd, status, secs, ts);
    }
  }
  return 0;
}

/** StartNewWorldBatch @3c145b0 */
export function startNewWorldBatch(gd, status, b) {
  const w = gd.nw;
  if (!isValid(gd.ct.last)) gd.ct.last = b.end;
  if (!isValid(w.modeTime) || !b.modeRate) w.modeTime = b.end;
  if (gd.ct.last < b.start) {
    progressClockTowerBatchInterval(gd, status, b, gd.ct.last, b.start);
    gd.ct.last = b.start;
  }
  if (w.modeTime < b.start) {
    let seg = w.modeTime;
    const floor = addSeconds(b.start, -SEVEN_DAYS_S);
    if (seg < floor) seg = floor;
    const lim = b.start < b.passBoundary ? b.start : b.passBoundary;
    const all = getNewWorldBatchContentTicks(b, seg, b.start);
    const passed = getNewWorldBatchContentTicks(b, seg, lim);
    progressNewWorldModeContent(gd, status, passed / TICKS_S, true);
    progressNewWorldModeContent(gd, status, (all - passed) / TICKS_S, false);
    w.modeTime = b.start;
  }
  b.clockAhead = getNewWorldBatchContentTicks(b, b.start, gd.ct.last);
  b.modeAhead = getNewWorldBatchContentTicks(b, b.start, w.modeTime);
  const last = gd.arc.lastProgress;
  if (!isValid(last) || !(last < b.start)) {
    const rc = processArc(gd, status, b.start);
    if (rc !== 0) return rc;
  } else {
    arc.progressArc(gd, status, getNewWorldBatchContentTicks(b, last, b.start) / TICKS_S, b.start);
  }
  deps.beginPioneersProgress(gd, status, b.contentTicks / TICKS_S, b.extraTicks / TICKS_S, b.start);
  b.started = true;
  return 0;
}

/** FinishNewWorldBatch @3c14ce8 */
export function finishNewWorldBatch(gd, status, b) {
  const w = gd.nw;
  w.contentTime = b.target;
  gd.arc.lastProgress = b.target;                            // GameData +0x10f8
  if (gd.ct.last < b.target) gd.ct.last = b.target;
  if (w.modeTime < b.target) w.modeTime = b.target;
  deps.endPioneersProgress(gd, status);
  w.batches.shift();
  w.power = w.power.add(b.reservePower);
  w.soul = w.soul.add(b.reserveSoul);
  if (isValid(w.lastReserveTime) && !(w.lastReserveTime <= w.contentTime)) return;
  w.power = w.power.add(w.reservedPower);
  w.soul = w.soul.add(w.reservedSoul);
  w.reservedPower = ZERO; w.reservedSoul = ZERO; w.lastReserveTime = 0;
}

/** SealNewWorldContent @3c13470 (gd, status, now, end) */
export function sealNewWorldContent(gd, status, now, end) {
  const w = gd.nw;
  let rc = validateNewWorldContentProgress(gd, status, 0, now, end);
  if (!status || rc !== 0) return rc !== 0 ? rc : 900;
  w.contentEnd = end;
  const t = now < end ? now : end;
  if (!isValid(w.contentTime)) {
    w.contentTime = t;
    let b300 = status.getWorldTreeProductionBonus(300), b910 = status.getWorldTreeProductionBonus(0x38e);
    if (status.isNewWorldPassApplied) { b300 = b300.div(passMult(gd, 300)); b910 = b910.div(passMult(gd, 0x38e)); }
    w.rate300 = b300.div(dyn(gd, status, 300));
    w.rate910 = b910.div(dyn(gd, status, 0x38e));
  }
  rc = clock.prepareClockTowerProgress(gd.m, gd, status, 0, now, end);
  if (rc === 0) rc = prepareNewWorldModeContent(gd, status, now);
  if (rc === 0) { appendNewWorldBatch(gd, null, 0, t); return 0; }
  return rc;
}

/** QueueNewWorldTime @3c142a0 (gd, status, seconds, now, end) -> {code, id} */
export function queueNewWorldTime(gd, status, seconds, now, end) {
  const out = { code: 900, id: 0 };
  if (!(seconds > 0) || !Number.isFinite(seconds)) return out;
  let rc = validateNewWorldContentProgress(gd, status, seconds, now, end);
  if (rc === 0) rc = sealNewWorldContent(gd, status, now, end);
  if (rc !== 0) return { code: rc, id: 0 };
  const id = appendNewWorldBatch(gd, status, seconds, now);
  return { code: id < 1 ? 0x386 : 0, id };
}

/**
 * SyncWorldTree @3c11920 (gd, status, dt, now, end, bonus1, bonus2, flag): sim passes dt=0, now=t, end=season end,
 * GetPassExcludedBonus(300), GetPassExcludedBonus(910), flag=true. Returns 0 when everything up to `now` is processed.
 */
export function syncWorldTree(gd, status, dt, now, end, bonus1, bonus2, flag) {
  const w = gd.nw;
  if (w.processing) return 0;
  if (!isValid(now) || !isValid(end)) return 0x138;
  if (mode(gd) !== 10 || locked(gd) || bonus1.le(ZERO) || bonus2.le(ZERO)) return 900;
  const rc = validateNewWorldContentProgress(gd, status, dt, now, end);
  if (rc !== 0) return rc;
  if (w.batches.length > 0 && dt > 0) return 0x134;
  w.next300 = bonus1.div(dyn(gd, status, 300));
  w.next910 = bonus2.div(dyn(gd, status, 0x38e));
  w.contentEnd = end;
  return processNewWorldBatches(gd, status, dt, now, !!flag, INT_MAX, false);
}

/**
 * ProcessNewWorldBatches @3c125c0 / ProcessNewWorldContentForVerification @3c133d0 (same loop; the latter is noBudget=true).
 * The real-time (Stopwatch/frame) budget of the game is NOT modelled: the loop runs until the queue drains or maxIters steps.
 */
export function processNewWorldBatches(gd, status, dt, now, flag, maxIters, noBudget) {
  const w = gd.nw;
  if (w.processing) return 0x134;
  let rc = validateNewWorldContentProgress(gd, status, dt, now, w.contentEnd);
  if (maxIters < 1 || rc !== 0) return rc !== 0 ? rc : 900;
  if (w.batches.length > 0 && dt > 0) return 0x134;
  const t = now < w.contentEnd ? now : w.contentEnd;
  if (!isValid(w.contentTime)) w.contentTime = t;
  if (w.batches.length < 1) appendNewWorldBatch(gd, null, dt, t);
  if (w.batches.length < 1) { applyNewWorldNextBonuses(gd); return 0; }
  installWorldTreeHooks(gd);
  w.processing = true; w.processCount++;
  try {
    for (let i = 0; ; i++) {
      if (w.batches.length < 1 || i >= maxIters) {
        if (w.batches.length > 0) return 0x134;
        applyNewWorldNextBonuses(gd);
        clock.refreshClockTowerDaily(gd, now);
        return 0;
      }
      const b = w.batches[0];
      applyNewWorldBatchRates(gd, status, b);
      if (!b.started) { rc = startNewWorldBatch(gd, status, b); if (rc !== 0) return rc; }
      else deps.resumePioneersProgress(gd, status);
      stepBatch(gd, status, b, t);
    }
  } finally { w.processing = false; }
}
export const processNewWorldContentForVerification = (gd, status, dt, now, maxIters) =>
  processNewWorldBatches(gd, status, dt, now, false, maxIters, true);

/** One iteration of the loop body of @3c125c0 for the head batch b (t = min(now, contentEnd)) */
function stepBatch(gd, status, b, t) {
  const w = gd.nw;
  const pos = b.done + b.queuePos;
  let q = pos < 215999999999 + 1 ? 1000000 : pos < 863999999999 + 1 ? 10000000 : 50000000;
  const total = batchTotalTicks(b);
  if (total > 10000000) {
    const c256 = Math.floor((total + 0xff) / 256);                       // (total+0xff)>>8 (total >= 0)
    const n = q === 0 ? 0 : Math.floor((q + c256 - 1) / q);
    q = mx(q, n * q);
  }
  const limit = pos < 216000000000 ? 216000000000 : pos < 864000000000 ? 864000000000 : Infinity;
  let step = mn(q, mn(batchRemainingTicks(b), limit - pos));
  if (total < 10000001) step = getWorldTreeArcBoundaryTicks(gd, status, step);
  step = deps.getPioneersBoundaryTicks(gd, status, step);
  const passRem = b.passTicks;
  if (passRem > 0) step = mn(step, passRem);
  const remain30 = mx(0, b.contentTicks - b.done);
  if (remain30 > 0) step = mn(step, remain30);
  const rb = getClockTowerRampageBoundaryTicks(gd, status, b, step);
  const ticks = rb.ticks;
  const newTime = getNewWorldBatchTime(b, b.done + ticks);
  let span = 0;
  if (remain30 > 0 && newTime > gd.ct.last) span = totalSeconds(newTime - gd.ct.last);
  const passed = passRem > 0;
  clock.progressClockTower(gd.m, gd, status, passed, mx(0, ticks - b.clockAhead) / TICKS_S, span, rb.scale);
  progressNewWorldModeContent(gd, status, mx(0, ticks - b.modeAhead) / TICKS_S, passed);
  b.clockAhead = mx(0, b.clockAhead - ticks);
  b.modeAhead = mx(0, b.modeAhead - ticks);
  let r300 = b.rate300.mul(dyn(gd, status, 300)), r910 = b.rate910.mul(dyn(gd, status, 0x38e));
  if (passed) { r300 = r300.mul(passMult(gd, 300)); r910 = r910.mul(passMult(gd, 0x38e)); }
  const dtS = ticks / TICKS_S;
  const p = worldTreeProduction(gd.m, dtS, w.power, w.soul, worldTreeEfficiency(gd), r300, r910);
  if (p.soul.gt(ZERO)) deps.modifySoul(gd, p.soul);
  if (p.mana.gt(ZERO)) deps.modifyMana(gd, p.mana);
  arc.progressArc(gd, status, dtS, newTime);
  deps.progressPioneers(gd, status, dtS);
  b.done += ticks;
  b.passTicks = mx(0, b.passTicks - ticks);
  w.contentTime = newTime;
  if (gd.ct.last < newTime) gd.ct.last = newTime;
  if (w.modeTime < newTime) w.modeTime = newTime;
  if (batchRemainingTicks(b) === 0) {
    finishNewWorldBatch(gd, status, b);
    if (w.batches.length < 1 && w.contentTime < t) appendNewWorldBatch(gd, null, 0, t);
  }
}
