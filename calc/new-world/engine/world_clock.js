// U4 (clock tower part) — Clock tower + time rampage + NewWorld pass entitlement (GameData.* of NewWorld mode 10).
// All logic from disassembly (decompile of these methods is mostly cut/mangled). Addresses are hex vaddrs.
// Convention (same as game_state.js / econ_*): fn(m, g, status, ...args); `g` = shared GameData state, m = Master.
// C# int return codes kept (0 = ok); out params returned as {code, ...}. Timestamp = ms Number (timestamp.js; 0 invalid),
// TimeSpan = ms Number. Seconds are JS doubles.
//
// State added to g by initClockState(g)  (offsets = GameData fields):
//   g.gameMode            +0x410 (int, 10 = NewWorld)         g.nwWorldId   +0x420 (NewWorld row Id, 90001..)
//   g.nwPassLevel         +0x424 (int, must be >= 1 for the pass to be "enabled" at all; set by ReadyGame/pass init, [unverified])
//   g.nwLocked            +0x13a8 (bool; true => pass/clock tower calls fail)   g.clearedField +0x13f0 (int, SetClearedField@3c178f4)
//   g.worldCrystal        +0x600 (Number/long)    g.rank +0x1400 (U3)   g.gold / g.power (U3, BigNumber)
//   g.ct = { b1:+0x1128, b2:+0x1130, b3:+0x1138 (double charge seconds, tiers 1..3, b1>=b2>=b3),
//            accrued:+0x1140 (double seconds accumulated since last collect), gold:+0x1148 (BN pending), power:+0x1158 (BN pending),
//            crystal:+0x1168 (System.Decimal pending -> JS Number), last:+0x1178 (Timestamp of last progress),
//            goldRate:+0x1180 (BN/s, divided by arc bonus), powerRate:+0x1190 (BN/s), crystalRate:+0x11a0 (Decimal/s) }
//   g.rampage = { start:+0x11b0, end:+0x11b8 (Timestamp), dailyReset:+0x11c0 (Timestamp), uses:+0x11c8 (int) }
//   g.pass    = { entitlement:+0x11d8 (bool), until:+0x11d0 (Timestamp; pass paid-until), pendA:+0x11e0 (16B Decimal-like, opaque),
//                 pendB:+0x11f0 (long) }   (pending amounts handed out by SetNewWorldPassEntitlement)
import { BigNumber } from './bignum.js';
import { fromKst, toKst, addDays, addSeconds, isValid, totalSeconds } from './timestamp.js';

const { ZERO, ONE } = BigNumber;

// ---- injectable dependencies (other units) ----
export const deps = {
  /** economy unit (U3): GameData.GetAllWeaponPower @3b99700 -> BigNumber */
  getAllWeaponPower: (g, status) => { throw new Error('world_clock deps.getAllWeaponPower not wired'); },
  /** world_arc.js (u4arc): GetClockTowerGoldArcBonus @3bf1728 / PowerArcBonus @3bf1950 -> BigNumber. Default ONE. */
  getClockTowerGoldArcBonus: (m, g, status) => ONE,
  getClockTowerPowerArcBonus: (m, g, status) => ONE,
  /** UpgradeStatus.GetNewWorldPassMultiplier @3aedab4 (type) */
  getNewWorldPassMultiplier: (status, type) => (status.getNewWorldPassMultiplier ? status.getNewWorldPassMultiplier(type) : ONE),
  /** GameData.ModifyGold @3b9a2a8 / ModifyPower @3ba0bbc (U3). Default: plain add. */
  modifyGold: (g, bn) => { g.gold = g.gold.add(bn); },
  modifyPower: (g, bn) => { g.power = g.power.add(bn); },
};
export const setDeps = (o) => Object.assign(deps, o);

export function initClockState(g) {
  g.gameMode ??= 10; g.nwWorldId ??= 90001; g.nwPassLevel ??= 0; g.nwLocked ??= false; g.clearedField ??= 0;
  g.worldCrystal ??= 0; g.gold ??= ZERO; g.power ??= ZERO; g.rank ??= 0;
  g.ct ??= { b1: 0, b2: 0, b3: 0, accrued: 0, gold: ZERO, power: ZERO, crystal: 0, last: 0, goldRate: ZERO, powerRate: ZERO, crystalRate: 0 };
  g.rampage ??= { start: 0, end: 0, dailyReset: 0, uses: 0 };
  g.pass ??= { entitlement: false, until: 0, pendA: 0, pendB: 0 };
  return g;
}

/** CopyPermanentPlayDataClockTower @3bf0fbc when modes/pass level differ: reset everything (also used as initial state). */
export function resetClockTower(g) {
  g.ct = { b1: 0, b2: 0, b3: 0, accrued: 0, gold: ZERO, power: ZERO, crystal: 0, last: 0, goldRate: ZERO, powerRate: ZERO, crystalRate: 0 };
  g.rampage = { start: 0, end: 0, dailyReset: 0, uses: 0 };
}

const S = (m) => m.setting('ClockTowerSetting');
const finite = (x) => Number.isFinite(x);
const min = Math.min, max = Math.max;
/** Math.Round(x) (banker's, as the inlined modf sequence in @3bf2910 does) */
export function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
const TICK = 1e7;
const roundTick = (s) => roundHalfEven(s * TICK) / TICK;

// ================= charge / quote =================

/** GetClockTowerChargeRoom @3bf31e0 */
export const getClockTowerChargeRoom = (g, maxSec) =>
  max(0, maxSec - g.ct.b1) + max(0, maxSec - g.ct.b2) + max(0, maxSec - g.ct.b3);

/** GetClockTowerMaxChargeCount @3bf30cc (int; TimeSpan.MaxValue check always true) */
export function getClockTowerMaxChargeCount(m, g, maxSec) {
  if (!(maxSec > 0) || !finite(maxSec)) return 0;
  const room = getClockTowerChargeRoom(g, maxSec);
  if (!(room > 0.001)) return 0;
  return min(Math.trunc(maxSec / 3600), Math.trunc(room / 3600));
}

/** QuoteClockTowerCharge @3bf3288 -> {code, seconds, cost}. 0x384 bad args, 0x242 no room, 0x386 count>max/overflow,
 *  0x3ee bad setting, 0x17 not enough crystal (outs still filled). */
export function quoteClockTowerCharge(m, g, maxSec, count) {
  const out = { code: 0, seconds: 0, cost: 0 };
  if (count < 1 || !(maxSec > 0) || !finite(maxSec)) return { ...out, code: 0x384 };
  const n = getClockTowerMaxChargeCount(m, g, maxSec);
  if (n === 0) return { ...out, code: 0x242 };
  if (n < count) return { ...out, code: 0x386 };
  const perHour = S(m).ClockTowerWorldCrystalPerHour;
  if (perHour < 1) return { ...out, code: 0x3ee };
  if (Math.floor(9223372036854775807 / perHour) < count) return { ...out, code: 0x386 };
  const room = getClockTowerChargeRoom(g, maxSec);
  out.seconds = min(count * 3600, min(maxSec, room));
  out.cost = perHour * count;
  out.code = g.worldCrystal < out.cost ? 0x17 : 0;
  return out;
}

/** AddClockTowerCharge @3bf355c: fill a tier up to `cap`, taking from rem.v */
function addCharge(obj, key, cap, rem) {
  const add = min(rem.v, max(0, cap - obj[key]));
  obj[key] += add; rem.v -= add;
}

/** ModifyWorldCrystal @3b9ee50 (crystal += amount; mission/event hooks ignored) */
export const modifyWorldCrystal = (g, amount) => { g.worldCrystal += amount; };

/** ChargeClockTower @3bf3478 (maxSec = seconds until end, count = hours to charge) -> int code */
export function chargeClockTower(m, g, status, maxSec, count) {
  const q = quoteClockTowerCharge(m, g, maxSec, count);
  if (q.code !== 0) return q.code;
  modifyWorldCrystal(g, -q.cost);
  const rem = { v: q.seconds };
  addCharge(g.ct, 'b1', maxSec, rem);
  addCharge(g.ct, 'b2', maxSec, rem);
  addCharge(g.ct, 'b3', maxSec, rem);
  return 0;
}

// ================= progress =================

/** GetClockTowerWeightedSeconds @3bf2748(g, useTiers, dt): reward-weighted seconds. ClockTowerRewardUp = [0,1,2,4]. */
export function getClockTowerWeightedSeconds(m, g, useTiers, dt) {
  const up = S(m).ClockTowerRewardUp;
  const c = g.ct;
  if (useTiers) {
    const b3 = min(dt, c.b3), b2only = min(dt, c.b2) - b3;
    return b3 * up[3] + (b2only * up[2] + up[1] * (dt - b2only - b3));
  }
  const tier = c.b3 > 0 ? 3 : c.b2 > 0 ? 2 : c.b1 > 0 ? 1 : 0;
  return up[tier] * dt;
}

/**
 * ProgressClockTower @3bf2910 (g, passApplied=w1, dt=d0, span=d1, mult=d2).
 *  dt   = wall seconds of this slice, span = seconds by which the charge tiers drain (>0 => tiers used and drained),
 *  mult = extra multiplier on gold/power (rampage GoldAndPower, from the batch engine's boundary routine).
 */
export function progressClockTower(m, g, status, passApplied, dt, span, mult) {
  const c = g.ct, s = S(m);
  const ratio = span > 0 ? dt / span : 1;                       // d13
  const room = max(0, s.ClockTowerTimeLimit - c.accrued);       // d12
  let sec = (c.b3 > 0 || c.b2 > 0 || c.b1 > 0) ? min(dt, room) : 0;
  if (span > 0) sec = min(sec, ratio * c.b1);
  sec = roundTick(sec);
  if (sec > 0) {
    const weighted = getClockTowerWeightedSeconds(m, g, span > 0, sec / ratio);
    const d10 = ratio * weighted;
    let gold = c.goldRate.mul(deps.getClockTowerGoldArcBonus(m, g, status)).mul(d10).mul(mult);
    let power = c.powerRate.mul(deps.getClockTowerPowerArcBonus(m, g, status)).mul(d10).mul(mult);
    if (passApplied) {
      gold = gold.mul(deps.getNewWorldPassMultiplier(status, 1));
      power = power.mul(deps.getNewWorldPassMultiplier(status, 2));
    }
    c.gold = c.gold.add(gold);
    c.power = c.power.add(power);
    c.crystal = c.crystal + c.crystalRate * d10;                // Decimal in the game (see notes)
    c.accrued = (roundHalfEven(c.accrued * TICK) + roundHalfEven(sec * TICK)) / TICK;
  }
  if (span > 0) {
    const sp = roundHalfEven(span * TICK);
    for (const k of ['b1', 'b2', 'b3']) c[k] = max(0, roundHalfEven(c[k] * TICK) - sp) / TICK;
  }
}

// ================= collect =================

/** CollectClockTower @3bf360c -> {code, rewards:[{type,amount}]}; 0x243 nothing/too little, 0x244 crystal overflow. */
export function collectClockTower(m, g, status) {
  const c = g.ct;
  if (!(c.accrued > 0) || c.accrued < S(m).ClockTowerTimeMin) return { code: 0x243, rewards: [] };
  const crystal = Math.ceil(c.crystal);
  if (crystal > 9223372036854775807 || crystal > 9223372036854775807 - g.worldCrystal) return { code: 0x244, rewards: [] };
  const gold = c.gold, power = c.power;
  c.gold = ZERO; c.crystal = 0; c.power = ZERO; c.accrued = 0;
  deps.modifyGold(g, gold);
  deps.modifyPower(g, power);
  modifyWorldCrystal(g, crystal);
  // AddClockTowerReward @3bf39e0: only added to the reward list when amount > 0 (log/UI only)
  const rewards = [[100, gold], [101, power], [132, BigNumber.of(crystal)]]
    .filter(([, a]) => a.gt(ZERO)).map(([type, amount]) => ({ type, amount }));
  return { code: 0, rewards };
}

// ================= rates / daily / prepare =================

/** Expression.ClockTowerEarningGold @415b65c(level, status) -> BN (gold per second at field `level`) */
export function clockTowerEarningGold(m, level, status) {
  const b = m.tryGetNewWorldBlockByField(level);
  if (!b) return ZERO;
  let v = m.bn(b, 'Reward').mul(m.setting('MiningSetting').GoldMultiplier);
  if (status) v = v.mul(status.getBlockGoldBonus(b.Id)).mul(status.get(1, ONE)).mul(status.get(0x136, ONE));
  return v;
}

/** Expression.MiningPower @414695c(power, status) -> BN */
export function miningPower(m, power, status) {
  let v = BigNumber.of(power).mul(m.setting('MiningSetting').PowerMultiplier);
  if (status) v = v.mul(status.get(2, ONE)).mul(status.get(0x136, ONE));
  return v;
}

/** get_ClockTowerWorldCrystalMultiplier @3bf1b54: magic-theme world => BonusParam1, else 1 (theme literal assumed nw_magic). */
export function getClockTowerWorldCrystalMultiplier(m, g) {
  if (g.gameMode === 10) {
    const w = m.tryGetNewWorld(g.nwWorldId);
    if (w && w.Theme === 'nw_magic' && w.BonusParam1 > 0) return w.BonusParam1;
  }
  return 1;
}

/** get_ClockTowerWorldCrystalBaseRate @3bf1a10 = PerRank(0.0002) * rank * multiplier (Decimal in game) */
export const getClockTowerWorldCrystalBaseRate = (m, g) =>
  S(m).ClockTowerWorldCrystalPerRank * g.rank * getClockTowerWorldCrystalMultiplier(m, g);

/** RefreshClockTowerRates @3bf1500 */
export function refreshClockTowerRates(m, g, status) {
  const c = g.ct;
  c.goldRate = clockTowerEarningGold(m, max(1, g.clearedField), status);
  c.powerRate = miningPower(m, deps.getAllWeaponPower(g, status), status);
  if (status.isNewWorldPassApplied) {
    c.goldRate = c.goldRate.div(deps.getNewWorldPassMultiplier(status, 1));
    c.powerRate = c.powerRate.div(deps.getNewWorldPassMultiplier(status, 2));
  }
  c.goldRate = c.goldRate.div(deps.getClockTowerGoldArcBonus(m, g, status));
  c.powerRate = c.powerRate.div(deps.getClockTowerPowerArcBonus(m, g, status));
  c.crystalRate = getClockTowerWorldCrystalBaseRate(m, g);
}

/** RefreshClockTowerDaily @3bf10cc: at/after dailyReset => reset rampage uses, next reset = next KST midnight. */
export function refreshClockTowerDaily(g, t) {
  const r = g.rampage;
  if (!isValid(t) || !(t >= r.dailyReset)) return;
  const k = toKst(t);
  r.uses = 0;
  r.dailyReset = addDays(fromKst(k.y, k.mo, k.d), 1);
}

/** ValidateClockTowerProgress @3bf1e48 (structural checks; the tail overflow simulation of the crystal Decimal is not ported). */
export function validateClockTowerProgress(m, g, secs, t) {
  const c = g.ct, s = S(m);
  if (!isValid(t) || (isValid(c.last) && t < c.last)) return 0x138;
  const limit = s.ClockTowerTimeLimit, up = s.ClockTowerRewardUp;
  const perRank = s.ClockTowerWorldCrystalPerRank;
  if (!(limit >= 1) || s.ClockTowerTimeMin < 0 || s.ClockTowerTimeMin > limit || up.length !== 4
    || perRank < 0 || !finite(perRank) || perRank > 3.689348816459897e19 / limit) return 0x3ee;
  const ts = s.TimeRampageTimeScale, gp = s.TimeRampageGoldAndPower;
  if (ts < 1 || ts > 2 || !finite(ts) || gp < 0 || !finite(gp)) return 0x3ee;
  let mx = 1;
  for (const u of up) { if (u < 0 || !finite(u)) return 0x3ee; mx = max(mx, u); }
  if (perRank > 3.689348816459897e19 / limit / mx) return 0x3ee;
  if (secs < 0 || !finite(secs)) return 0x3e8;
  if (c.b1 < c.b2 || c.b2 < c.b3 || c.b3 < 0 || !finite(c.b1) || !finite(c.b2) || !finite(c.b3)) return 0x3e8;
  if (c.accrued < 0 || !finite(c.accrued) || c.crystal < 0) return 0x3e8;
  return 0;
}

/** PrepareClockTowerProgress @3bf1cc8(secs, ts1, ts2, status): 0x138 invalid ts, 0x384 bad mode/args. */
export function prepareClockTowerProgress(m, g, status, secs, ts1, ts2) {
  if (!isValid(ts1) || !isValid(ts2)) return 0x138;
  if (g.gameMode !== 10 || secs < 0 || g.nwLocked || !finite(secs)) return 0x384;
  const t = ts1 < ts2 ? ts1 : ts2;
  const code = validateClockTowerProgress(m, g, secs, t);
  if (code !== 0) return code;
  if (!isValid(g.ct.last)) { g.ct.last = t; refreshClockTowerRates(m, g, status); }
  refreshClockTowerDaily(g, ts1);
  return 0;
}

// ================= pass / time rampage =================

/** IsNewWorldPassEnabledAt @3bf1308 */
export function isNewWorldPassEnabledAt(g, t) {
  if (!isValid(t) || g.gameMode !== 10 || g.nwLocked) return false;
  if (!(g.nwPassLevel >= 1)) return false;
  if (g.pass.entitlement) return true;
  return g.pass.until > t;
}

/** IsTimeRampageActive @3bf122c */
export function isTimeRampageActive(g, t) {
  if (!isNewWorldPassEnabledAt(g, t)) return false;
  const r = g.rampage;
  return isValid(r.start) && t >= r.start && t < r.end;
}

/** RefreshNewWorldPassTimeRampage @3bf13dc: clip a running rampage to the pass end (or end it now if the pass is off). */
export function refreshNewWorldPassTimeRampage(g, t) {
  const r = g.rampage;
  if (!isValid(t) || !isValid(r.end) || r.end <= t) return;
  if (isNewWorldPassEnabledAt(g, t)) {
    if (g.pass.entitlement) return;
    if (g.pass.until < r.end) r.end = g.pass.until;
  } else r.end = t;
}

/** ActivateTimeRampage @3bf3b44 -> 0 ok, 0x245 pass off, 0x134 already active, 0x246 daily limit */
export function activateTimeRampage(m, g, t) {
  refreshClockTowerDaily(g, t);
  if (!isNewWorldPassEnabledAt(g, t)) return 0x245;
  if (isTimeRampageActive(g, t)) return 0x134;
  const s = S(m);
  if (g.rampage.uses >= s.TimeRampageDailyLimit) return 0x246;
  g.rampage.start = t;
  g.rampage.uses += 1;
  g.rampage.end = addSeconds(t, s.TimeRampageDuration);
  refreshNewWorldPassTimeRampage(g, t);
  return 0;
}

/** GetTimeRampageExtraSeconds @3beeb80(from, to): extra (bonus) seconds granted by the rampage inside [from,to]. */
export function getTimeRampageExtraSeconds(m, g, from, to) {
  const r = g.rampage;
  if (!isValid(from) || !isValid(to) || !isValid(r.start) || to <= from) return 0;
  const start = from > r.start ? from : r.start;
  let end = to < r.end ? to : r.end;
  if (!g.pass.entitlement && g.pass.until < end) end = g.pass.until;
  if (!(end > start)) return 0;
  return totalSeconds(end - start) * max(0, S(m).TimeRampageTimeScale - 1);
}

/** SetNewWorldPassEntitlement @3bf472c(enable) -> {code, pendA, pendB}; 0xca bad mode/level, 0x3e8 bad pending. */
export function setNewWorldPassEntitlement(g, enable) {
  const out = { code: 0, pendA: 0, pendB: 0 };
  if (g.gameMode !== 10 || g.nwLocked || !(g.nwPassLevel >= 1)) return { ...out, code: 0xca };
  const p = g.pass;
  if (!enable) { p.entitlement = false; return out; }
  if (p.entitlement) return out;
  if (p.pendA < 0 || p.pendB < 0) return { ...out, code: 0x3e8 };
  out.pendA = p.pendA; out.pendB = p.pendB;
  p.entitlement = true; p.until = 0; p.pendB = 0; p.pendA = 0;
  return out;
}
