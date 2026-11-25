// Expression::* cost formulas (+ C:: card helpers), ported from libil2cpp ARM64 (addresses in each doc comment).
// First arg is always the Master `m`. Rows are raw sheet rows (m.bn(row, field) parses BigNumber strings).
//
// ASSUMED external API (owned by other units), `status` = UpgradeStatus:
//   status.getInt(type /*int UpgradeType*/, def /*int*/) -> int      UpgradeStatus.Get @3b15cfc (int overload:
//                                                                    dict lookup, BigNumber.ToInt, else def).
//   `status` may be null/undefined (game checks `status != null`; null -> 0).
// Nothing else is assumed: SciencePoint*/WarAI/GoldenCube/Arc costs read only Master data (ScienceSetting, WarAI,
// WarAILearning, GoldenCube, GoldenCubePower, ArkSetting) and `status` is otherwise unused by the binary.
import { BigNumber } from './bignum.js';
import { getDataIdType } from './master.js';

const { ZERO, ONE } = BigNumber;
const K1000 = new BigNumber(1000); // BigNumber static +0x48 (cctor 42d5cc8: literal 1000.0)

// ---- Science point production (BigNumber return == the `out cost` it also writes) -------------------------------
/** @4148d54 (level, status, out cost). cost = BN(PointUpgradeCost[double]) * BN(PointUpgradeCostUp[double]).Pow(level). status unused. */
export function sciencePointProductionInnovationLabUpgradeCost(m, level, status) {
  const s = m.setting('ScienceSetting');
  return new BigNumber(s.PointUpgradeCost).mul(new BigNumber(s.PointUpgradeCostUp).pow(level));
}

// Devil/WarAI/GoldenCube: Cost[string] * BN(Math.Pow(CostUp, level)).Pow(Math.Pow(CostUpPow, level))
function sciencePointProduction(m, name, level) {
  const s = m.setting('ScienceSetting');
  return m.bn(s, `PointUpgrade${name}Cost`).mul(
    new BigNumber(Math.pow(s[`PointUpgrade${name}CostUp`], level)).pow(Math.pow(s[`PointUpgrade${name}CostUpPow`], level)));
}
/** @4148ef4 (level, status, out cost). status unused. */
export const sciencePointProductionDevilOrderUpgradeCost = (m, level, status) => sciencePointProduction(m, 'DevilOrder', level);
/** @4149160 (level, status, out cost). status unused. */
export const sciencePointProductionWarAIUpgradeCost = (m, level, status) => sciencePointProduction(m, 'WarAI', level);
/** @41493cc (level, status, out cost). status unused. */
export const sciencePointProductionGoldenCubeUpgradeCost = (m, level, status) => sciencePointProduction(m, 'GoldenCube', level);

// ---- Arc (Ark) -------------------------------------------------------------------------------------------------
/** @4149edc (MasterArkLinkUpgrade row, level). Parse(CommonCost) * BN(CommonCostUp).Pow(Math.Max(0, level)). */
export function arcLinkUpgradeCost(m, row, level) {
  return m.bn(row, 'CommonCost').mul(new BigNumber(row.CommonCostUp).pow(Math.max(0, level)));
}

/**
 * @4149be4 (MasterArk row, level, count): total cost of `count` levels starting at `level`; count<=0 -> Zero.
 * first = Cost * BN(CostUp).Pow(Math.Max(0, level - ArkSetting.UnlockLevel)); count==1 -> first;
 * CostUp==1 -> first*count; else first * (BN(CostUp).Pow(count) - One) / (CostUp - 1)  (geometric sum).
 */
export function arcNodeUpgradeCost(m, row, level, count) {
  if (count <= 0) return ZERO;
  const up = row.CostUp;
  const first = m.bn(row, 'Cost').mul(new BigNumber(up).pow(Math.max(0, level - m.setting('ArkSetting').UnlockLevel)));
  if (count === 1) return first;
  if (up === 1) return first.mul(count);
  return first.mul(new BigNumber(up).pow(count).sub(ONE)).div(up + -1);
}

// ---- WarAI / GoldenCube (per-level cost loops) -------------------------------------------------------------------
// Shared by WarAILearningTargetUnlockCost @414b4a4, WarAIUpgradeCost @414b918, GoldenCubeUpgradeCost @414c660 (identical loops).
// Buys levels level..last (last = count<1 ? max-1 : min(max-1, level+count-1)), summing per-level costs, each clamped:
// c<1 -> 1; 1<=c<1000 -> BN(trunc(c)). If count<=0 (budget mode) the loop stops before the level that would make
// sum > budget, but always takes the first level. Returns {code:0, cost, n}; budget unused when count>0.
function costLoop(costAt, max, level, budget, count) {
  let cost = ZERO, n = 0;
  const last = count < 1 ? max - 1 : Math.min(max - 1, level + count - 1);
  for (let lv = level; lv <= last; lv++) {
    let c = costAt(lv);
    if (c.lt(ONE)) c = ONE;
    else if (c.lt(K1000)) c = new BigNumber(Math.trunc(c.toDouble()));
    if (count <= 0 && n >= 1 && budget.lt(cost.add(c))) break;
    cost = cost.add(c); n++;
  }
  return { code: 0, cost, n };
}
const notFound = (code) => ({ code, cost: ZERO, n: 0 });

/** Extensions.GetWarAITargetUpgradeCost @414b7b8: Parse(Cost) * (BN(CostUp).Pow(level)).Pow(Math.Pow(CostUpPow, level)) (note: not BN(CostUp^level)). */
const warAITargetUpgradeCost = (m, r, lv) => m.bn(r, 'Cost').mul(new BigNumber(r.CostUp).pow(lv).pow(Math.pow(r.CostUpPow, lv)));
/** Extensions.GetWarAIUpgradeCost @414bc54 and GetGoldenCubeUpgradeCost @414c99c: Parse(Cost) * BN(CostUp).Pow(level). */
const perLevelCost = (m, r, lv) => m.bn(r, 'Cost').mul(new BigNumber(r.CostUp).pow(lv));

/**
 * @414b4a4 (id, level, status, budget BN, count, out cost, out n) -> {code, cost, n}. WarAILearning row by Id, max = row.MaxLevel.
 * code: 0 ok (also when zero levels fit), 0x79 (121) row not found (cost=Zero, n=0). status unused.
 */
export function warAILearningTargetUnlockCost(m, id, level, status, budget, count) {
  const r = m.tryGet('WarAILearning', id);
  return r ? costLoop((lv) => warAITargetUpgradeCost(m, r, lv), r.MaxLevel ?? 0, level, budget, count) : notFound(0x79);
}

/** @4149914 (MasterWarAI row, status) -> int: row.MaxLevel + status.getInt(row.TargetType == 0xe8 ? 0x23b : 0x23a, 0); status null -> +0. */
export function warAIMaxLevel(m, row, status) {
  return (row.MaxLevel ?? 0) + (status ? status.getInt(row.TargetType === 0xe8 ? 0x23b : 0x23a, 0) : 0);
}

/** @414b918 (id, level, status, budget BN, count, out cost, out n) -> {code, cost, n}. code 0 ok, 0x79 WarAI row not found. max = WarAIMaxLevel(row, status). */
export function warAIUpgradeCost(m, id, level, status, budget, count) {
  const r = m.tryGet('WarAI', id);
  return r ? costLoop((lv) => perLevelCost(m, r, lv), warAIMaxLevel(m, r, status), level, budget, count) : notFound(0x79);
}

/** @41499dc Expression.GoldenCubeMaxLevel (MasterGoldenCube row, status) -> int: MaxLevel + status.getInt(GetDataIdType(Id)==9 ? 0x23e : 0x23f, 0). Callee of GoldenCubeUpgradeCost. */
export function goldenCubeMaxLevel(m, row, status) {
  return (row.MaxLevel ?? 0) + (status ? status.getInt(getDataIdType(row.Id) === 9 ? 0x23e : 0x23f, 0) : 0);
}

/** @414c660 (id, level, status, budget BN, count, out cost, out n) -> {code, cost, n}. GoldenCube row by Id; code 0 ok, 0x7c (124) row not found. */
export function goldenCubeUpgradeCost(m, id, level, status, budget, count) {
  const r = m.tryGet('GoldenCube', id);
  return r ? costLoop((lv) => perLevelCost(m, r, lv), goldenCubeMaxLevel(m, r, status), level, budget, count) : notFound(0x7c);
}

/** @414c060 (id, status, gold, out cost) -> {code, value}. GoldenCubePower row by Id; code 0 ok (value = Parse(UnlockCost)), 0x7c not found (value Zero). status/gold unused. */
export function goldenCubeGoldenPowerUnlockCost(m, id, status, gold) {
  const r = m.tryGet('GoldenCubePower', id);
  return r ? { code: 0, value: m.bn(r, 'UnlockCost') } : { code: 0x7c, value: ZERO };
}

// ---- C:: card helpers ----------------------------------------------------------------------------------------------
const FRAME_TABLE = [155, 155, 155, 155, 156, 157]; // ints at 0x15e95d0 (grades 1..6, NewWorld mode)

/** C.GetCardFrameType @4135404 (mode, grade) -> int. mode not in {0,1,10} -> 0; grade 90 -> 0x9e (158) for those modes; else only mode 10 uses the table (grade 1..6), otherwise 0. */
export function getCardFrameType(mode, grade) {
  if (mode !== 0 && mode !== 1 && mode !== 10) return 0;
  if (grade === 90) return 0x9e;
  return mode === 10 && grade >= 1 && grade <= 6 ? FRAME_TABLE[grade - 1] : 0;
}

// M.CardLevelMax (M+0x78) / M.DefinedUltimateCardLevelMax (M+0x7c): set in M._OnLoad @3a49470 by a generic
// call over the CardLevel / UltimateCardLevel lists (callee not decompiled); assumed = max Level (10 / 70 in data).
const maxLevels = new WeakMap();
function levelMax(m, sheet) {
  let o = maxLevels.get(m);
  if (!o) maxLevels.set(m, o = {});
  return o[sheet] ??= Math.max(...m.sheet(sheet).map((r) => r.Level));
}

// GetCardLevelUpCount @4134f18 and GetCardLevelUpCost @413549c share one structure (only the column differs):
// row = (isUltimate ? UltimateCardLevel : CardLevel)[min(level+1, max)]; missing row / unknown grade -> -1.
// Grades 1..3 share the "Normal" column; 4 Heroic; 5 Epic; 6 Legendary; 90 Golden only when !ultimate && mode != 10.
// cols = [normal, heroic, epic, legendary, golden|undefined].
function cardLevelValue(m, isUltimate, grade, level, cols) {
  const sheet = isUltimate ? 'UltimateCardLevel' : 'CardLevel';
  const row = m.tryGet(sheet, Math.min(level + 1, levelMax(m, sheet)));
  if (!row) return -1;
  const col = grade >= 1 && grade <= 3 ? cols[0] : grade === 4 ? cols[1] : grade === 5 ? cols[2] : grade === 6 ? cols[3] : grade === 90 ? cols[4] : undefined;
  return col ? (row[col] ?? 0) : -1;
}

/** C.GetCardLevelUpCount @4134f18 (mode, isUltimate, grade, level) -> int copies needed. Ultimate: Count*; mode 10: CountNw*; else Count* (+CountGolden). */
export function getCardLevelUpCount(m, mode, isUltimate, grade, level) {
  return cardLevelValue(m, isUltimate, grade, level, !isUltimate && mode === 10
    ? ['CountNwNormal', 'CountNwHeroic', 'CountNwEpic', 'CountNwLegendary']
    : ['CountNormal', 'CountHeroic', 'CountEpic', 'CountLegendary', isUltimate ? undefined : 'CountGolden']);
}

/**
 * C.GetCardLevelUpCost @413549c (mode, isUltimate, grade, level) -> int. Ultimate: SpellBook*; mode 10: WorldCrystal*; else SpellBook* (+SpellBookGolden).
 * Quirk: sheet column is spelled "SpellBookLegenday". Missing column reads 0 (e.g. CardLevel row 1 has none).
 */
export function getCardLevelUpCost(m, mode, isUltimate, grade, level) {
  return cardLevelValue(m, isUltimate, grade, level, !isUltimate && mode === 10
    ? ['WorldCrystalNormal', 'WorldCrystalHeroic', 'WorldCrystalEpic', 'WorldCrystalLegendary']
    : ['SpellBookNormal', 'SpellBookHeroic', 'SpellBookEpic', 'SpellBookLegenday', isUltimate ? undefined : 'SpellBookGolden']);
}
