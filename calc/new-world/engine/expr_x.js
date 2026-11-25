// Expression::* cost/power formulas (il2cpp, ported from ARM64 disassembly).
// All functions take a Master `m` first. `status` = UpgradeStatus-like object or null/undefined (the binary null-checks it).
//
// ASSUMED status methods (another unit's job):
//   status.get(type:int, def:BigNumber = BigNumber.ONE) -> BigNumber        UpgradeStatus.Get @3ae5258
//   status.getInt(type:int, def:int) -> int                                  UpgradeStatus.Get(int,int) @3b15cfc (dict lookup -> ToInt, else def)
//   status.getWeaponEnhanceCostDown(weaponId:int) -> BigNumber               @3b15f44
//   status.getWeaponTotalBonus(weaponId:int, level:int, weaponRow, opt:int|null) -> BigNumber   @3b102c8
//        (binary call: (status, weaponId, level, row, Nullable<int> opt, 0, 0); opt = null in WeaponPower, WeaponDmg's 3rd arg in WeaponDmg)
// Master data used: Weapon / Upgrade / NewWorldRank rows, WeaponSetting {SpecialGradeEnhances, EnhancePriceUnit, EnhancePriceMultiplier},
//   SoulMenuSetting.MaxLevel (the object at Root+0x158+0x70, get_MaxLevel @3d93900 -- identified by data match, not by name).
//
// Return convention: {code, value[, count]}. code = the C# int return. 0 ok; others per function below.
// Common tail "clampCost": v<1 -> One; else v<1000 -> BigNumber((int)v) (truncation); else unchanged.
import { BigNumber } from './bignum.js';

const { ZERO, ONE } = BigNumber;
const THOUSAND = new BigNumber(1000); // BigNumber static +0x48 (.ctor(1000.0) @42d5cc8; verified from rodata)

/** shared tail of every cost function (e.g. @414350c..41435d0 in WeaponPrice) */
function clampCost(v) {
  if (v.lt(ONE)) return ONE;
  if (v.lt(THOUSAND)) return new BigNumber(Math.trunc(v.toDouble())); // fcvtzs (never Inf here)
  return v;
}

// ---- helpers (Extensions.* / MathUtil.*, called by the ported functions) -------------------------------------------
/** MathUtil.GetArithmeticCumulative @433d000: sum_{i=a..b} (first + step*i); Zero if b<a. */
export function arithmeticCumulative(a, b, first, step) {
  if (b < a) return ZERO;
  return first.add(step.mul(a)).add(first.add(step.mul(b))).mul(b - a + 1).div(2);
}
/** MathUtil.GetGeometricCumulative @433d130: offset*n + first*ratio^a*(ratio^n-1)/(ratio-1), n=b-a+1; Zero if b<a. */
export function geometricCumulative(a, b, offset, first, ratio) {
  if (b < a) return ZERO;
  const n = b - a + 1;
  return offset.mul(n).add(first.mul(powMemo(ratio, a).mul(powMemo(ratio, n).sub(1)).div(ratio.sub(1))));
}
// pure-function memo of BigNumber.pow (perf: soul/research cost binary searches repeat the same powers; results identical)
const POW_MEMO = new Map();
function powMemo(r, p) {
  if (!(Number.isInteger(p) && p >= 0 && p < 100000)) return r.pow(p);
  let mm = POW_MEMO.get(r.m);
  if (mm === undefined) { if (POW_MEMO.size > 5000) POW_MEMO.clear(); mm = new Map(); POW_MEMO.set(r.m, mm); }
  const k = r.e * 100000 + p;
  let v = mm.get(k);
  if (v === undefined) { if (mm.size > 20000) mm.clear(); v = r.pow(p); mm.set(k, v); }
  return v;
}
/** Extensions.GetCost @4142774 (Upgrade row, level). CostUpType 3: Cost*up^l; 4: Cost/up^l; else Cost + up*l. */
export function upgradeCost(m, row, level) {
  const cost = m.bn(row, 'Cost'), up = row.CostUp ?? 0, t = row.CostUpType ?? 0;
  if (t === 3) return cost.mul(new BigNumber(up).pow(level));
  if (t === 4) return cost.div(new BigNumber(up).pow(level));
  return cost.add(up * level);
}
/** Extensions.GetCumulativeCost @4142530: cost sum over levels a..b (3 geometric, 4 geometric w/ 1/up, else arithmetic). */
export function upgradeCumulativeCost(m, row, a, b) {
  const cost = m.bn(row, 'Cost'), up = new BigNumber(row.CostUp ?? 0), t = row.CostUpType ?? 0;
  if (t === 3) return geometricCumulative(a, b, ZERO, cost, up);
  if (t === 4) return geometricCumulative(a, b, ZERO, cost, up.reciprocal());
  return arithmeticCumulative(a, b, cost, up);
}
/** Extensions.GetEnhanceCost @4143a28 (Weapon row, level). */
export function weaponEnhanceCost(m, row, level) {
  let c = m.bn(row, 'EnhanceCost').mul(new BigNumber(row.EnhanceCostUp ?? 0).pow(level - 1));
  const s = m.setting('WeaponSetting'), unit = s.EnhancePriceUnit ?? 0;
  if (unit >= 1) {
    const k = Math.trunc((level - 1) / unit); // sdiv
    if (k >= 1) c = c.mul(Math.pow(s.EnhancePriceMultiplier ?? 0, k));
  }
  return c;
}
/** C.GetWeaponSpecialGrade @4134ce8: smallest i with SpecialGradeEnhances[i] >= level (len if none). */
export function weaponSpecialGrade(m, level) {
  const a = m.setting('WeaponSetting').SpecialGradeEnhances ?? [];
  let i = 0;
  while (i < a.length && a[i] < level) i++;
  return i;
}
// Extensions.Get{SoulDmg,SoulCost}{Upgrade,Enhance}Cost @4145ab8/@4145bb8/@4146294/@4146394 (single level) and the
// GetCumulative* variants @41458a8/@41459b0/@4146084/@414618c: Weapon row, geometric with Zero offset, ratio = double field.
const rb = (row, up) => (row._rb ??= {})[up] ??= new BigNumber(row[up] ?? 0);   // perf: ratio BigNumber per row/field
const soulSingle = (m, row, f, up, level) => m.bn(row, f).mul(powMemo(rb(row, up), level));
const soulCum = (m, row, f, up, a, b) => geometricCumulative(a, b, ZERO, m.bn(row, f), rb(row, up));
const SOUL = {
  up: { 1: 'SoulDmgUpgradeCost', 2: 'SoulCostUpgradeCost', ratio: 'SoulUpgradeCostUp' },
  en: { 1: 'SoulDmgEnhanceCost', 2: 'SoulCostEnhanceCost', ratio: 'SoulEnhanceCostUp' },
};

/** Binary search shared by ResearchCost/SoulUpgradeCost/SoulEnhanceCost (e.g. @41430a8..4143148). Returns {n, cost}.
 *  Largest mid in [0..hi] with cost(mid) <= budget; cost = last successful (unclamped), n = mid (0 if none). */
function maxAffordable(hi, budget, cost, guess) {
  let lo = 0, n = 0, out = ZERO;
  if (hi < 0) return { n, cost: out };
  if (guess !== undefined) {   // perf: verified analytic guess (same answer as the search for monotone costs); falls through if wrong
    const k = Math.max(0, Math.min(hi, guess)), ck = k > 0 ? cost(k) : ZERO;
    if ((k === 0 || ck.le(budget)) && (k === hi || cost(k + 1).gt(budget))) return { n: k, cost: ck };
  }
  for (;;) {
    const mid = (lo + hi) >> 1;
    const c = cost(mid);
    if (c.le(budget)) {
      n = mid; out = c; lo = mid + 1;
      if (!(mid < hi)) break;
    } else {
      hi = mid - 1;
      if (!(lo < mid)) break;
    }
  }
  return { n, cost: out };
}

const lg = (x) => Math.log10(x.m) + 3 * x.e;
/** analytic estimate of the largest k with soulCum(level..level+k-1) <= budget (undefined when not applicable) */
function soulGuess(m, row, f, up, level, budget) {
  const r = row[up] ?? 0, first = m.bn(row, f);
  if (!(r > 1) || budget.le(ZERO) || first.le(ZERO)) return undefined;
  const lx = lg(budget) + Math.log10(r - 1) - lg(first) - level * Math.log10(r);
  const l1 = lx > 15 ? lx : Math.log10(1 + Math.pow(10, lx));
  const k = Math.floor(l1 / Math.log10(r));
  return Number.isFinite(k) ? k : undefined;
}

// ---- ported functions ---------------------------------------------------------------------------------------------
/**
 * Expression.WeaponPrice @41432f4 (weaponId, status, out price) -> int.
 * Price = BN(row.Price) [* status.get(0x47) * status.getWeaponEnhanceCostDown(weaponId)], then clampCost.
 * codes: 0 ok, 0x67 weapon not found (value Zero).
 */
export function WeaponPrice(m, weaponId, status) {
  const row = m.tryGetWeapon(weaponId);
  if (!row) return { code: 0x67, value: ZERO };
  let v = m.bn(row, 'Price');
  if (status) v = v.mul(status.get(0x47, ONE)).mul(status.getWeaponEnhanceCostDown(weaponId));
  return { code: 0, value: clampCost(v) };
}

/**
 * Expression.WeaponEnhanceCost @41435e8 (weaponId, level, status, budget BN, count, out total, out n) -> int.
 * Buys enhance levels level..end, end = SpecialGradeEnhances[grade(level)] (0 past the last grade; replaced by status.getInt(0x20,0)
 * when status && cap+1<=level), further capped by level+count-1 if count>=1. Per-level cost = weaponEnhanceCost
 * [* get(0x47) * costDown(weaponId)] then clampCost.
 * count<=0 -> budget mode: stop before the level that would push total+cost over budget, but the FIRST level is always bought.
 * If end<level nothing is bought (value Zero, count 0). codes: 0 ok, 0x67 weapon not found.
 */
export function WeaponEnhanceCost(m, weaponId, level, status, budget, count) {
  const row = m.tryGetWeapon(weaponId);
  if (!row) return { code: 0x67, value: ZERO, count: 0 };
  const grades = m.setting('WeaponSetting').SpecialGradeEnhances ?? [];
  const g = weaponSpecialGrade(m, level);
  let cap = g < grades.length ? grades[g] : 0;
  if (status && cap + 1 <= level) cap = status.getInt(0x20, 0);
  const end = count < 1 ? cap : Math.min(cap, level + count - 1);
  let total = ZERO, n = 0;
  for (let l = level; l <= end; l++) {
    let c = weaponEnhanceCost(m, row, l);
    if (status) c = c.mul(status.get(0x47, ONE)).mul(status.getWeaponEnhanceCostDown(weaponId));
    c = clampCost(c);
    if (count <= 0 && n >= 1 && budget.lt(total.add(c))) break;
    total = total.add(c); n++;
  }
  return { code: 0, value: total, count: n };
}

/**
 * Expression.WeaponDmg @4143ca8 (weaponId, level, opt:int, status, out dmg) -> int.
 * dmg = BN(row.Power) [* status.getWeaponTotalBonus(weaponId, level, row, opt)]. Clamp ONLY when dmg > 0:
 * dmg<1 -> One, dmg<1000 -> truncated int. codes: 0 ok, 0x67 not found (value Zero).
 * `opt` is a Nullable<int> in the binary (callers pass 0); its meaning lives inside GetWeaponTotalBonus (not decoded here).
 */
export function WeaponDmg(m, weaponId, level, opt, status) {
  const row = m.tryGetWeapon(weaponId);
  if (!row) return { code: 0x67, value: ZERO };
  let v = m.bn(row, 'Power');
  if (status) v = v.mul(status.getWeaponTotalBonus(weaponId, level, row, opt));
  return { code: 0, value: v.gt(ZERO) ? clampCost(v) : v };
}

/**
 * Expression.WeaponPower @4143fe8 (weaponId, level, status, out power) -> int.
 * power = BN(row.Power) [* status.getWeaponTotalBonus(weaponId, level, row, null)]. NO clamp. codes: 0 ok, 0x67 not found (Zero).
 */
export function WeaponPower(m, weaponId, level, status) {
  const row = m.tryGetWeapon(weaponId);
  if (!row) return { code: 0x67, value: ZERO };
  let v = m.bn(row, 'Power');
  if (status) v = v.mul(status.getWeaponTotalBonus(weaponId, level, row, null));
  return { code: 0, value: v };
}

/**
 * Expression.ResearchCost @4142e88 (upgradeId, level, status, budget BN, count, out cost, out n) -> int.
 * mul = status ? status.get(0xc9) : One. remaining = Upgrade.MaxLevel - level.
 * count>0: n=min(count,remaining), cost = cumulative(level..level+n-1)*mul.
 * count<=0: binary search for the largest n<=remaining with cumulative*mul <= budget; if none (n==0) cost = GetCost(level)*mul, n=1.
 * Tail: clampCost. codes: 0 ok, 0x65 upgrade not found (value Zero, count 0).
 * Quirk: count>0 with remaining<=0 gives n<=0 -> cumulative Zero -> cost One (not an error).
 */
export function ResearchCost(m, upgradeId, level, status, budget, count) {
  const row = m.tryGetUpgrade(upgradeId);
  if (!row) return { code: 0x65, value: ZERO, count: 0 };
  const mul = status ? status.get(0xc9, ONE) : ONE;
  const remaining = (row.MaxLevel ?? 0) - level;
  const cum = (n) => upgradeCumulativeCost(m, row, level, level - 1 + n).mul(mul);
  let n, v;
  if (count > 0) {
    n = Math.min(count, remaining); v = cum(n);
  } else {
    ({ n, cost: v } = maxAffordable(remaining, budget, cum));
    if (n === 0) { v = upgradeCost(m, row, level).mul(mul); n = 1; }
  }
  return { code: 0, value: clampCost(v), count: n };
}

/**
 * Expression.NewWorldRankUpPower @41446e0 (rank, status, out power) -> int.
 * v = BN(NewWorldRank[rank].PowerTarget) (null/empty -> Zero) [* status.get(0xca)], then clampCost (so Zero -> One).
 * codes: 0 ok, 0x64 rank not found (value Zero).
 */
export function NewWorldRankUpPower(m, rank, status) {
  const row = m.tryGetNewWorldRank(rank);
  if (!row) return { code: 0x64, value: ZERO };
  let v = row.PowerTarget ? m.bn(row, 'PowerTarget') : ZERO;
  if (status) v = v.mul(status.get(0xca, ONE));
  return { code: 0, value: clampCost(v) };
}

/** shared body of SoulUpgradeCost / SoulEnhanceCost (they differ only by field set and max level). */
function soulCost(m, set, kind, weaponId, level, maxLevel, budget, count) {
  const row = m.tryGetWeapon(weaponId);
  if (!row) return { code: 0x67, value: ZERO, count: 0 };
  const remaining = maxLevel - level;
  const f = SOUL[set], field = f[kind], ratio = f.ratio;
  const bad = kind !== 1 && kind !== 2;
  let n, v;
  if (count > 0) {
    n = Math.min(count, remaining);
    if (bad) return { code: 0x384, value: ZERO, count: n };
    v = soulCum(m, row, field, ratio, level, level + n - 1);
  } else {
    if (bad) return { code: 0x384, value: ZERO, count: 0 };
    const v1 = soulSingle(m, row, field, ratio, level);   // perf: clearly unaffordable -> same result as the search (n = 0, single-level fallback)
    if (budget.lt(v1.mul(0.999999))) return { code: 0, value: clampCost(v1), count: 1 };
    ({ n, cost: v } = maxAffordable(remaining, budget, (k) => soulCum(m, row, field, ratio, level, level - 1 + k), soulGuess(m, row, field, ratio, level, budget)));
    if (n === 0) { v = soulSingle(m, row, field, ratio, level); n = 1; }
  }
  return { code: 0, value: clampCost(v), count: n };
}

/**
 * Expression.SoulUpgradeCost @4145428 (kind, weaponId, level, status(unused), budget BN, count, out cost, out n) -> int.
 * kind 1 = SoulDmgUpgradeCost, 2 = SoulCostUpgradeCost (Weapon row; ratio SoulUpgradeCostUp). Max level = SoulMenuSetting.MaxLevel.
 * Same count/budget/clamp logic as ResearchCost (no status multiplier). codes: 0 ok, 0x67 weapon not found, 0x384 kind not 1/2.
 */
export function SoulUpgradeCost(m, kind, weaponId, level, status, budget, count) {
  return soulCost(m, 'up', kind, weaponId, level, m.setting('SoulMenuSetting').MaxLevel ?? 0, budget, count);
}

/**
 * Expression.SoulEnhanceCost @4145cb8 (kind, weaponId, level, status, budget BN, count, out cost, out n) -> int.
 * kind 1 = SoulDmgEnhanceCost, 2 = SoulCostEnhanceCost (ratio SoulEnhanceCostUp). Max level = status.getInt(0xcb, 1);
 * with status == null remaining is 0 (so: count>0 -> n=0, cost One; count<=0 -> single-level fallback, n=1).
 * Otherwise identical to SoulUpgradeCost. codes: 0 ok, 0x67, 0x384.
 */
export function SoulEnhanceCost(m, kind, weaponId, level, status, budget, count) {
  return soulCost(m, 'en', kind, weaponId, level, status ? status.getInt(0xcb, 1) : level, budget, count);
}
