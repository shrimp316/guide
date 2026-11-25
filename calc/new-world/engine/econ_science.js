// U3 part B: science / innovation / DevilOrder / WarAI / GoldenCube economy (GameData), NewWorld mode 10.
// Ported from ARM64 disassembly (tools/disasm.py); addresses in each doc comment.
//
// CONVENTIONS (game_state.js): fn(m, g, status, ...). m = Master, g = state, status = U2 UpgradeStatus or null
//   (status.get(type, def) -> BigNumber, status.getInt(type, def) -> int). Return codes are the C# ints (0 ok).
//   Rank-up cost functions return {code, cost, n}; assists return {code:0, count}.
//   Time: g.gameTime (ms) = MainManager.TryGetGameTime (the sim's WithVirtualTime sets it).
//
// EXPORTS (all take (m, g, ...) unless noted)
//   initScienceState(g)
//   science:   getScienceRank(g, status) @3b95378, getScienceMaxRank(m) @3bcbb50, setScienceRank(m, g, n) @3c1c3f0,
//              getScienceRankUpCost(m, g, status?, count) -> {code,cost,n} @3c1ce38, scienceRankUp(m, g, status?, count) -> int @3c1cefc,
//              processScience(m, g, status) @3c1be18, modifySciencePoint(g, amt) @3ba48f8,
//              sciencePointProductionInnovationLabUpgrade / WarAIUpgrade / DevilOrderUpgrade / GoldenCubeUpgrade (m, g, status) -> int
//                @3c1d060 / @3c1d5f8 / @3c1d32c / @3c1d8c4
//   innovation: getInnovationUpgradeData(g, id) @3c1e088, innovationUpgradeAssist(m, g, status, type, ratio) -> {code,count} @3c1f664
//   devil:     getDevilOrderRankUpCost(m, g, res, count) @3c20584, devilOrderRankUp(m, g, res, count) @3c206dc,
//              getDevilOrderUpgradeData(g, id) @3c20900, devilOrderUpgradeAssist(m, g, status, type, ratio) -> {code,count} @3c22014
//   warAI:     getWarAIUpgradeData(g, id) -> {id,level} @3c231c4, getWarAIRankUpCost(m, g, res, count) @3c23d34,
//              warAIRankUp(m, g, res, count) @3c23e8c, warAIUpgrade(m, g, status, id, count=1) @3c244ac,
//              warAITargetUpgrade(m, g, status, id, count=1) @3c240b0, processWarAI(m, g) @3c23240
//   goldenCube: getGoldenCubeRankUpCost(m, g, res, count) @3c26a68, goldenCubeRankUp(m, g, res, count) @3c26bc0,
//              getGoldenCubeUpgradeData(g, id) @3c25b7c, goldenCubeGoldenPowerUnlock(m, g, status, id) @3c26de4,
//              goldenCubeUpgrade(m, g, status, id, count=1) @3c27138, processGoldenCube(m, g, status) @3c248b0,
//              addGoldenCubeGoldenPowerSpeedAll(m, g, amount) -> {code, spent} @3c25bf8, getGoldenPowerLevelSum(g) (sim @4174090)
//   Expression helpers (not in expr_y): scienceRankUpCost(m, kind, res, curRank, maxAvail, budget, count) @41489f4,
//              innovationUpgradeCost @414a160, devilOrderUpgradeCost @414a954, goldenCubeGoldenPowerUpgradeCost @414c1c8
//
// STATE FIELDS ADDED (offsets = GameData; Map = JS Map)
//   scienceAcc(+0x1478 double secs) scienceLastTime(+0x1480 ts)  sciencePeak(+0x648) scienceTotal(+0x658)
//   labLevel(+0x1488) devilProdLevel(+0x148c) warAIProdLevel(+0x1490) cubeProdLevel(+0x1494)   (point production upgrade levels)
//   innovationLevels Map id->level (+0x14a0)  innovationBrickSum(+0x149c) innovationWeaponSum(+0x1498)  innovationCache(+0x14b0 -> null)
//   devilRankSci(+0x14c4) devilRankSoul(+0x14c8)  devilUpgrade Map(+0x14f0)  devilCache(+0x1500)
//   warAIRankSci(+0x1514) warAIRankPower(+0x1518)  warAIUpgrade Map id->level (+0x1568; also holds WarAILearning ids)
//   warAITarget(+0x1540) warAIAcc(+0x1548) warAILastTime(+0x1550) warAILearningCount Map(+0x1558) warAILearningBonus Map BN(+0x1560)
//   cubeRankSci(+0x1570) cubeRankGold(+0x1574)  cubeUpgrade Map id->level (+0x15b8; level>=1 = unlocked, also golden power unlock)
//   goldenPowerLevel Map(+0x15b0)  cubeProgress Map BN(+0x1598)  cubeSpeed Map BN(+0x15a0)  cubeTime Map ts(+0x15a8)
//   reads (owned by part A): g.mode(+0x410), g.maxRank, g.achievedField(+0x13d8), g.weaponUnlockIndex(+0x44c); core scienceRank(+0x1460)
//
// KEY FINDINGS
//   * RankUp for DevilOrder/WarAI/GoldenCube has TWO independent rank counters (science-bought and soul/power/gold-bought); the
//     cost curve of each starts at its own counter, max available = MaxRank - (a+b).  ScienceRankUpCost applies the cost for
//     rank n = curRank (not +1) with exponent (n-1): e.g. science rank 1 -> 1000, rank 0 -> 800.
//   * ProcessScience: status.Get(0x140, Zero) * floor(acc / (PointTime/max(1,rank))) -- default is ZERO, so science production
//     exists only through the status bonus 0x140.
//   * Assist loops (Innovation/DevilOrder): budget B = resource*ratio fixed once; pass p: c = (#accepted) - p, per-item budget
//     B/c (stop if c<1); walk the sheet list in REVERSE, buy in budget mode (count=0) when B >= cost, n >= 1 and resource >= cost;
//     the pass loop CONTINUES only while nothing was bought in the pass.
//   * ProcessGoldenCube advances at most ONE golden power level per power per call (the sim loops <=100 times).
//
// UNCERTAINTIES
//   * Overmind hyper values/levels (@3bc8114/@3bc80c0) assumed 0 (not available in NewWorld): max ranks = setting MaxRank, learning
//     time = LearningTime, SetWarAILearningTarget branch not used (mode 10 sets the target directly).
//   * Is*AssistAvailable (Innovation/DevilOrder) are report-only audits in the sim: not ported.
//   * Mission/event notifications and RecordXSpent bookkeeping are omitted.
//   * innovationCache/devilCache (+0x14b0/+0x1500) are zeroed on purchase (cache invalidation); nothing in U3 reads them.
//   * ProcessScience default of status.Get(0x140): static BigNumber+8 (Zero, matches A_core's Zero=+8/One=+0x18).
//   * Initial scienceRank is set by part A's InitProgress / ReadyGame (core field).
import { BigNumber } from './bignum.js';
import { getDataIdType } from './master.js';
import { warAILearningTargetUnlockCost, warAIUpgradeCost, goldenCubeUpgradeCost,
  goldenCubeGoldenPowerUnlockCost, sciencePointProductionInnovationLabUpgradeCost,
  sciencePointProductionWarAIUpgradeCost, sciencePointProductionDevilOrderUpgradeCost,
  sciencePointProductionGoldenCubeUpgradeCost } from './expr_y.js';
import { modifyGold, modifyPower } from './econ_gold.js';
import { modifySoul } from './econ_soul.js';

const { ZERO, ONE } = BigNumber;
const K1000 = new BigNumber(1000);
const MAX_PROCESS_SECONDS = 604800; // double @15e5680 (7 days)

export function initScienceState(g) {
  const d = (k, v) => { if (g[k] === undefined) g[k] = v; };
  d('scienceAcc', 0); d('scienceLastTime', 0); d('sciencePeak', ZERO); d('scienceTotal', ZERO);
  d('labLevel', 0); d('devilProdLevel', 0); d('warAIProdLevel', 0); d('cubeProdLevel', 0);
  d('innovationLevels', new Map()); d('innovationBrickSum', 0); d('innovationWeaponSum', 0); d('innovationCache', null);
  d('devilRankSci', 0); d('devilRankSoul', 0); d('devilUpgrade', new Map()); d('devilCache', null);
  d('warAIRankSci', 0); d('warAIRankPower', 0); d('warAIUpgrade', new Map());
  d('warAITarget', 0); d('warAIAcc', 0); d('warAILastTime', 0); d('warAILearningCount', new Map()); d('warAILearningBonus', new Map());
  d('cubeRankSci', 0); d('cubeRankGold', 0); d('cubeUpgrade', new Map());
  d('goldenPowerLevel', new Map()); d('cubeProgress', new Map()); d('cubeSpeed', new Map()); d('cubeTime', new Map());
  d('mode', 10); d('maxRank', 0); d('achievedField', 0); d('weaponUnlockIndex', 0);
  return g;
}

const bmax = (a, b) => (a.gt(b) ? a : b);
const statusInt = (status, t) => (status ? status.getInt(t, 0) : 0);
const data = (map, id) => ({ id, level: map.get(id) ?? 0 });

// ---- ModifySciencePoint @3ba48f8 -----------------------------------------------------------------------------------
export function modifySciencePoint(g, amt) {
  amt = BigNumber.of(amt);
  g.science = g.science.add(amt);
  g.sciencePeak = bmax(g.sciencePeak ?? ZERO, g.science);
  g.scienceTotal = bmax(g.scienceTotal ?? ZERO, g.sciencePeak);
  if (amt.gt(ZERO)) g.scienceTotal = g.scienceTotal.add(amt);
}

// ---- Expression helpers --------------------------------------------------------------------------------------------
/** Shared per-level cost loop (same as expr_y.costLoop): clamp c<1 ->1, c<1000 -> trunc; count<=0 = budget mode, first level always taken. */
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

/** Expression.HyperRankCostSurge @41477dc (rank, maxRank): rank<max -> One. */
function hyperRankCostSurge(m, rank, maxRank) {
  const d = rank - maxRank;
  if (d < 0) return ONE;
  const s = m.setting('OvermindDepthsSetting');
  return new BigNumber(s.HyperRankCostSurge).mul(new BigNumber(s.HyperRankCostSurgeUp).pow(d));
}

const RANK_KINDS = { 0x13b: 'ScienceSetting', 0x13c: 'DevilOrderSetting', 0x13d: 'WarAISetting', 0x13e: 'GoldenCubeSetting' };
// kind -> [{resource id -> prefix of RankExp<Prefix>[,Up,UpPow] fields}]
const RANK_RES = { 0x13c: { 0x66: 'Soul' }, 0x13d: { 0x65: 'Power' }, 0x13e: { 0x64: 'Gold' } };

/** Expression.{Science,DevilOrder,WarAI,GoldenCube}RankExpTarget @414794c/@4147b9c/@4148064/@414852c: cost of rank `n`. */
function rankExpTarget(m, kind, res, n) {
  const s = m.setting(RANK_KINDS[kind]);
  const surge = () => hyperRankCostSurge(m, n, s.MaxRank);
  if (kind === 0x13b) return new BigNumber(s.RankExp * Math.pow(s.RankExpUp, n - 1)).mul(surge());
  if (res === 0x69) return m.bn(s, 'RankExpSciencePoint').mul(Math.pow(s.RankExpSciencePointUp, n - 1)).mul(surge());
  const p = RANK_RES[kind][res];
  if (!p) return ZERO;
  const e = n - 1;
  return m.bn(s, `RankExp${p}`).mul(new BigNumber(Math.pow(s[`RankExp${p}Up`], e)).pow(Math.pow(s[`RankExp${p}UpPow`], e))).mul(surge());
}

/**
 * Expression.ScienceRankUpCost @41489f4 (kind, res, curRank, maxAvail, budget BN, count) -> {code, cost, n}.
 * 0x384 bad kind/resource, 0x132 maxAvail<1. count>=1: exactly min(count,maxAvail) ranks; count<=0: budget mode (first rank always).
 */
export function scienceRankUpCost(m, kind, res, curRank, maxAvail, budget, count) {
  const okRes = kind === 0x13b ? res === 0x69
    : kind === 0x13c ? res === 0x66 || res === 0x69
    : kind === 0x13d ? res === 0x65 || res === 0x69
    : kind === 0x13e ? res === 0x69 || res === 0x64 : false;
  if (!okRes) return { code: 0x384, cost: ZERO, n: 0 };
  if (maxAvail < 1) return { code: 0x132, cost: ZERO, n: 0 };
  const iters = count > 0 ? Math.min(count, maxAvail) : maxAvail;
  let cost = ZERO, n = 0, rank = curRank;
  for (let i = 0; i < iters; i++) {
    const c = rankExpTarget(m, kind, res, rank);
    if (count < 1 && n >= 1 && budget.lt(cost.add(c))) break;
    cost = cost.add(c); n++; rank++;
  }
  return { code: 0, cost, n };
}

// ---- Science rank ---------------------------------------------------------------------------------------------------
/** GameData.GetScienceRank @3b95378 */
export const getScienceRank = (g, status) => g.scienceRank + statusInt(status, 0x141);
/** GameData.GetScienceMaxRank @3bcbb50 (+ overmind hyper value, assumed 0) */
export const getScienceMaxRank = (m) => m.setting('ScienceSetting').MaxRank;
/** GameData.SetScienceRank @3c1c3f0 */
export function setScienceRank(m, g, n) { g.scienceRank = Math.min(n, getScienceMaxRank(m)); }

/** GameData.GetScienceRankUpCost @3c1ce38 (count) -> {code,cost,n} */
export function getScienceRankUpCost(m, g, status, count) {
  return scienceRankUpCost(m, 0x13b, 0x69, g.scienceRank, getScienceMaxRank(m) - g.scienceRank, g.science, count);
}
/** GameData.ScienceRankUp @3c1cefc -> int (0x36 not enough science) */
export function scienceRankUp(m, g, status, count) {
  const r = getScienceRankUpCost(m, g, status, count);
  if (r.code !== 0) return r.code;
  if (g.science.lt(r.cost)) return 0x36;
  modifySciencePoint(g, r.cost.neg());
  setScienceRank(m, g, r.n + g.scienceRank);
  return 0;
}

// ---- Science point production upgrades ------------------------------------------------------------------------------
function prodUpgrade(m, g, status, levelKey, maxField, costFn, balKey, noMoney, pay) {
  const lvl = g[levelKey];
  if (lvl >= m.setting('ScienceSetting')[maxField]) return 0x132;
  const cost = costFn(m, lvl, status);
  if (g[balKey].lt(cost)) return noMoney;
  pay(g, cost.neg());
  g[levelKey] = lvl + 1;
  return 0;
}
/** @3c1d060 InnovationLab (pays science, level +0x1488) */
export const sciencePointProductionInnovationLabUpgrade = (m, g, status) =>
  prodUpgrade(m, g, status, 'labLevel', 'PointUpgradeLevelMax', sciencePointProductionInnovationLabUpgradeCost, 'science', 0x36, modifySciencePoint);
/** @3c1d5f8 WarAI (pays power 0x34, level +0x1490) */
export const sciencePointProductionWarAIUpgrade = (m, g, status) =>
  prodUpgrade(m, g, status, 'warAIProdLevel', 'PointUpgradeWarAILevelMax', sciencePointProductionWarAIUpgradeCost, 'power', 0x34, modifyPower);
/** @3c1d32c DevilOrder (pays soul 4, level +0x148c) */
export const sciencePointProductionDevilOrderUpgrade = (m, g, status) =>
  prodUpgrade(m, g, status, 'devilProdLevel', 'PointUpgradeDevilOrderLevelMax', sciencePointProductionDevilOrderUpgradeCost, 'soul', 4, modifySoul);
/** @3c1d8c4 GoldenCube (pays gold 1, level +0x1494) */
export const sciencePointProductionGoldenCubeUpgrade = (m, g, status) =>
  prodUpgrade(m, g, status, 'cubeProdLevel', 'PointUpgradeGoldenCubeLevelMax', sciencePointProductionGoldenCubeUpgradeCost, 'gold', 1, modifyGold);

/** TryGetProcessSeconds @3b5e83c (Timestamp this, now) -> {ok, last, secs}; invalid `last` is initialised to now. */
function tryGetProcessSeconds(last, now) {
  if (!(last > 0)) return { ok: false, last: now, secs: 0 };
  const dt = (now - last) / 1000;
  if (!(dt > 0)) return { ok: false, last, secs: 0 };
  return { ok: true, last, secs: Math.min(dt, MAX_PROCESS_SECONDS) };
}

/** GameData.ProcessScience @3c1be18 (status) -> int */
export function processScience(m, g, status) {
  const t = g.gameTime;
  if (!(g.scienceLastTime > 0)) g.scienceLastTime = t;
  if (t <= g.scienceLastTime) return 0;
  const dt = Math.min((t - g.scienceLastTime) / 1000, MAX_PROCESS_SECONDS);
  g.scienceLastTime = t;
  g.scienceAcc += dt;
  const rank = getScienceRank(g, status);
  const D = m.setting('ScienceSetting').PointTime / (rank > 1 ? rank : 1); // SciencePointProductionDuration @4148c80
  if (g.scienceAcc < D) return 0;
  const n = Math.floor(g.scienceAcc / D);
  const gain = (status ? status.get(0x140, ZERO) : ZERO).mul(n);
  g.scienceAcc -= D * n;
  modifySciencePoint(g, gain);
  return 0;
}

// ---- Innovation -----------------------------------------------------------------------------------------------------
/** GameData.GetInnovationUpgradeData @3c1e088 */
export const getInnovationUpgradeData = (g, id) => data(g.innovationLevels, id);

const isNewWorldBlock = (id) => id >= 2900 && id < 3000; // @3a4fc74: (id-0xb54) <u 100

/** Expression.InnovationUpgradeCost @414a160 (id, level, status, budget, count): code 0x77 row missing. */
export function innovationUpgradeCost(m, id, level, status, budget, count) {
  const r = m.tryGet('Innovation', id);
  if (!r) return { code: 0x77, cost: ZERO, n: 0 };
  const t = getDataIdType(id);
  const max = (r.MaxLevel ?? 0) + statusInt(status, t === 2 ? 0x233 : t === 5 ? 0x232 : 0x231); // @4149638 / @41496fc
  return costLoop((lv) => m.bn(r, 'Cost').mul(new BigNumber(r.CostUp).pow(lv)), max, level, budget, count);
}

/** Generic candidate-assist loop shared by Innovation @3c1f664 and DevilOrder @3c22014. */
function assistLoop(g, status, ratio, list, accept, resKey, costFn, pay, levelsMap, cacheKey) {
  let count = 0;
  const B = g[resKey].mul(ratio);
  for (let pass = 0; ; pass++) {
    const accepted = list.filter(accept);
    const c = accepted.length - pass;
    if (c < 1) break;
    const per = B.div(c);
    let bought = 0;
    for (let i = accepted.length - 1; i >= 0; i--) {
      const id = accepted[i].Id;
      const level = levelsMap.get(id) ?? 0;
      const r = costFn(id, level, per);
      if (r.code !== 0) continue;
      if (B.ge(r.cost) && r.n >= 1 && g[resKey].ge(r.cost)) {
        pay(g, r.cost.neg());
        levelsMap.set(id, level + r.n);
        g[cacheKey] = null;
        count += r.n; bought += r.n;
      }
    }
    if (bought !== 0) break;
  }
  return count;
}

/** RefreshTotalInnovationBrickUpgradeCount @3c1ddf0 / WeaponUpgradeCount @3c1db90 */
export function refreshInnovationTotals(m, g) {
  let brick = 0, weapon = 0;
  for (const [id, level] of g.innovationLevels) {
    const t = getDataIdType(id);
    if (t === 2 && m.tryGet('Block', id) && isNewWorldBlock(id) === (g.mode === 10)) brick += level;
    else if (t === 5 && m.tryGetWeapon(id)) weapon += level;
  }
  g.innovationBrickSum = brick; g.innovationWeaponSum = weapon;
}

/**
 * GameData.InnovationUpgradeAssist @3c1f664 (type = 2 brick / 5 weapon / 0xb innovation, ratio of current science). -> {code:0, count}
 * Candidates (sheet Innovation, DataIdType==type): 0xb: Rank <= GetScienceRank; 5: weapon exists && weaponUnlockIndex >= UnlockIndex;
 * 2: Block exists && achievedField >= Block.Field && IsNewWorldBlock(id) == (mode==10).
 */
export function innovationUpgradeAssist(m, g, status, type, ratio) {
  const R = getScienceRank(g, status);
  const list = m.findAll('Innovation');
  const accept = (r) => {
    if (getDataIdType(r.Id) !== type) return false;
    if (type === 0xb) return (r.Rank ?? 0) <= R;
    if (type === 5) { const w = m.tryGetWeapon(r.Id); return !!w && g.weaponUnlockIndex >= (w.UnlockIndex ?? 0); }
    if (type === 2) { const b = m.tryGet('Block', r.Id); return !!b && g.achievedField >= (b.Field ?? 0) && isNewWorldBlock(r.Id) === (g.mode === 10); }
    return true;
  };
  const count = assistLoop(g, status, ratio, list, accept, 'science',
    (id, level, per) => innovationUpgradeCost(m, id, level, status, per, 0), modifySciencePoint, g.innovationLevels, 'innovationCache');
  if (count >= 1 && (type === 2 || type === 5)) refreshInnovationTotals(m, g);
  return { code: 0, count };
}

// ---- DevilOrder -----------------------------------------------------------------------------------------------------
/** GameData.GetDevilOrderUpgradeData @3c20900 */
export const getDevilOrderUpgradeData = (g, id) => data(g.devilUpgrade, id);

function rankCost(m, g, setting, aKey, bKey, resB, bBal, res, count, kind) {
  const max = m.setting(setting).MaxRank;
  const a = g[aKey], b = g[bKey];
  if (res === 0x69) return scienceRankUpCost(m, kind, 0x69, a, max - (a + b), g.science, count);
  if (res === resB) return scienceRankUpCost(m, kind, resB, b, max - (a + b), g[bBal], count);
  return { code: 0x384, cost: ZERO, n: 0 };
}
function rankUp(m, g, status, res, count, costFn, aKey, bKey, resB, bBal, noB, payB) {
  const r = costFn(m, g, res, count);
  if (r.code !== 0) return r.code;
  if (res === 0x69) {
    if (g.science.lt(r.cost)) return 0x36;
    modifySciencePoint(g, r.cost.neg()); g[aKey] = r.n + g[aKey];
  } else if (res === resB) {
    if (g[bBal].lt(r.cost)) return noB;
    payB(g, r.cost.neg()); g[bKey] = r.n + g[bKey];
  } else return 0x384;
  return 0;
}

/** GameData.GetDevilOrderRankUpCost @3c20584 (res 0x66 soul / 0x69 science) */
export const getDevilOrderRankUpCost = (m, g, res, count) => rankCost(m, g, 'DevilOrderSetting', 'devilRankSci', 'devilRankSoul', 0x66, 'soul', res, count, 0x13c);
/** GameData.DevilOrderRankUp @3c206dc (0x36 science short, 4 soul short) */
export const devilOrderRankUp = (m, g, res, count) =>
  rankUp(m, g, null, res, count, getDevilOrderRankUpCost, 'devilRankSci', 'devilRankSoul', 0x66, 'soul', 4, modifySoul);

/** Expression.DevilOrderUpgradeCost @414a954 (id, level, status, budget, count): 0x78 row missing; max @4149784 */
export function devilOrderUpgradeCost(m, id, level, status, budget, count) {
  const r = m.tryGet('DevilOrder', id);
  if (!r) return { code: 0x78, cost: ZERO, n: 0 };
  const t = getDataIdType(id);
  const max = m.setting('DevilOrderSetting').MaxUpgradeLevel + statusInt(status, t === 9 ? 0x237 : t === 2 ? 0x236 : 0x235); // @414989c
  return costLoop((lv) => m.bn(r, 'Cost').mul(new BigNumber(r.CostUp).pow(lv).pow(Math.pow(r.CostUpPow, lv))), max, level, budget, count);
}

/**
 * GameData.DevilOrderUpgradeAssist @3c22014 (type 0 / 2 / 9 / 0x5a, ratio of current soul) -> {code:0, count}. Pays soul.
 * Candidates (sheet DevilOrder, DataIdType==type): 0: Rank[id].Rank <= maxRank; 2: Block field + row.IsNewWorld == (mode==10);
 * 9: DivineBeast[id].Field <= achievedField; 0x5a: NewWorldRank[id%1000].Rank <= maxRank.
 */
export function devilOrderUpgradeAssist(m, g, status, type, ratio) {
  const list = m.findAll('DevilOrder');
  const accept = (r) => {
    if (getDataIdType(r.Id) !== type) return false;
    if (type === 0x5a) { const k = m.tryGetNewWorldRank(r.Id % 1000); return !!k && g.maxRank >= k.Rank; }
    if (type === 0) { const k = m.tryGetRank(r.Id); return !!k && g.maxRank >= k.Rank; }
    if (type === 9) { const k = m.tryGet('DivineBeast', r.Id); return !!k && g.achievedField >= (k.Field ?? 0); }
    if (type === 2) { const b = m.tryGet('Block', r.Id); return !!b && g.achievedField >= (b.Field ?? 0) && !!r.IsNewWorld === (g.mode === 10); }
    return true;
  };
  const count = assistLoop(g, status, ratio, list, accept, 'soul',
    (id, level, per) => devilOrderUpgradeCost(m, id, level, status, per, 0), modifySoul, g.devilUpgrade, 'devilCache');
  return { code: 0, count };
}

// ---- WarAI ----------------------------------------------------------------------------------------------------------
/** GameData.GetWarAIUpgradeData @3c231c4 (also WarAILearning ids) */
export const getWarAIUpgradeData = (g, id) => data(g.warAIUpgrade, id);
/** GameData.GetWarAIRankUpCost @3c23d34 (res 0x65 power / 0x69 science) */
export const getWarAIRankUpCost = (m, g, res, count) => rankCost(m, g, 'WarAISetting', 'warAIRankSci', 'warAIRankPower', 0x65, 'power', res, count, 0x13d);
/** GameData.WarAIRankUp @3c23e8c (0x36 science short, 0x34 power short) */
export const warAIRankUp = (m, g, res, count) =>
  rankUp(m, g, null, res, count, getWarAIRankUpCost, 'warAIRankSci', 'warAIRankPower', 0x65, 'power', 0x34, modifyPower);

/** GameData.WarAIUpgrade @3c244ac (pays power): 0x79 row missing, 0x34 not enough power */
export function warAIUpgrade(m, g, status, id, count = 1) {
  if (!m.tryGet('WarAI', id)) return 0x79;
  const level = getWarAIUpgradeData(g, id).level;
  const r = warAIUpgradeCost(m, id, level, status, g.power, count);
  if (r.code !== 0) return r.code;
  if (g.power.lt(r.cost)) return 0x34;
  modifyPower(g, r.cost.neg());
  g.warAIUpgrade.set(id, r.n + level);
  return 0;
}

/** GameData.WarAITargetUpgrade @3c240b0 (WarAILearning id; pays power; mode 10: target := id when none) */
export function warAITargetUpgrade(m, g, status, id, count = 1) {
  if (!m.tryGet('WarAILearning', id)) return 0x79;
  const level = getWarAIUpgradeData(g, id).level;
  const r = warAILearningTargetUnlockCost(m, id, level, status, g.power, count);
  if (r.code !== 0) return r.code;
  if (g.power.lt(r.cost)) return 0x34;
  modifyPower(g, r.cost.neg());
  g.warAIUpgrade.set(id, r.n + level);
  if (g.warAITarget === 0) g.warAITarget = id;
  return 0;
}

/** AddWarAILearningResult @3c23888 */
export function addWarAILearningResult(g, id, n, bonus) {
  g.warAILearningCount.set(id, (g.warAILearningCount.get(id) ?? 0) + n);
  g.warAILearningBonus.set(id, (g.warAILearningBonus.get(id) ?? ZERO).add(bonus));
}

/** GameData.ProcessWarAI @3c23240 (mode 10: AddWarAILearningResultAll @3c23658 over WarAILearning ids with level>=1) */
export function processWarAI(m, g) {
  const t = g.gameTime;
  if (!(g.warAILastTime > 0)) g.warAILastTime = t;
  if (t <= g.warAILastTime) return 0;
  const dt = Math.min((t - g.warAILastTime) / 1000, MAX_PROCESS_SECONDS);
  g.warAILastTime = t;
  if (g.warAITarget === 0) return 0;
  g.warAIAcc += dt;
  const s = m.setting('WarAISetting');
  const T = s.LearningTime; // @3c22f9c (hyper level assumed 0)
  if (g.warAIAcc < T) return 0;
  const n = Math.floor(g.warAIAcc / T);
  const rankBonus = new BigNumber(Math.pow(s.RankBonus, Math.max(0, g.warAIRankPower + g.warAIRankSci))); // WarAIRankBonus @414b398
  const bonus = rankBonus.mul(s.LearningBonus).mul(n);
  g.warAIAcc -= T * n;
  for (const r of m.findAll('WarAILearning')) if (getWarAIUpgradeData(g, r.Id).level >= 1) addWarAILearningResult(g, r.Id, n, bonus);
  return 0;
}

// ---- GoldenCube -----------------------------------------------------------------------------------------------------
/** GameData.GetGoldenCubeUpgradeData @3c25b7c */
export const getGoldenCubeUpgradeData = (g, id) => data(g.cubeUpgrade, id);
/** GameData.GetGoldenCubeRankUpCost @3c26a68 (res 0x64 gold / 0x69 science) */
export const getGoldenCubeRankUpCost = (m, g, res, count) => rankCost(m, g, 'GoldenCubeSetting', 'cubeRankSci', 'cubeRankGold', 0x64, 'gold', res, count, 0x13e);
/** GameData.GoldenCubeRankUp @3c26bc0 (0x36 science short, 1 gold short) */
export const goldenCubeRankUp = (m, g, res, count) =>
  rankUp(m, g, null, res, count, getGoldenCubeRankUpCost, 'cubeRankSci', 'cubeRankGold', 0x64, 'gold', 1, modifyGold);

/** GameData.GoldenCubeUpgrade @3c27138 (pays gold): 0x7c row missing, 0x3e8 bad id type (valid 0,6,9,11), 1 gold short */
export function goldenCubeUpgrade(m, g, status, id, count = 1) {
  if (!m.tryGet('GoldenCube', id)) return 0x7c;
  const t = getDataIdType(id);
  if (t !== 0 && t !== 6 && t !== 9 && t !== 0xb) return 0x3e8;
  const level = getGoldenCubeUpgradeData(g, id).level;
  const r = goldenCubeUpgradeCost(m, id, level, status, g.gold, count);
  if (r.code !== 0) return r.code;
  if (g.gold.lt(r.cost)) return 1;
  modifyGold(g, r.cost.neg());
  g.cubeUpgrade.set(id, r.n + level);
  return 0;
}

/** GameData.GoldenCubeGoldenPowerUnlock @3c26de4: pays UnlockCost, cubeUpgrade[id] = level 1 (no level==0 check). 0x7c missing, 1 gold short */
export function goldenCubeGoldenPowerUnlock(m, g, status, id) {
  if (!m.tryGet('GoldenCubePower', id)) return 0x7c;
  const r = goldenCubeGoldenPowerUnlockCost(m, id, status, g.gold);
  if (r.code !== 0) return r.code;
  if (g.gold.lt(r.value)) return 1;
  modifyGold(g, r.value.neg());
  g.cubeUpgrade.set(id, 1);
  return 0;
}

/** Expression.GoldenCubeGoldenPowerUpgradeCost @414c1c8 (id, level, status, budget, count): 0x7c row missing; max = MaxGoldenPowerLevel + status 0x23d */
export function goldenCubeGoldenPowerUpgradeCost(m, id, level, status, budget, count) {
  const r = m.tryGet('GoldenCubePower', id);
  if (!r) return { code: 0x7c, cost: ZERO, n: 0 };
  const max = m.setting('GoldenCubeSetting').MaxGoldenPowerLevel + statusInt(status, 0x23d); // @4149adc
  return costLoop((lv) => m.bn(r, 'Cost').mul(new BigNumber(r.CostUp).pow(lv).pow(Math.pow(r.CostUpPow, lv))), max, level, budget, count);
}
const goldenPowerMax = (m, status) => m.setting('GoldenCubeSetting').MaxGoldenPowerLevel; // GetGoldenCubeMaxGoldenPowerLevel @3bcbed0 (+hyper 0)

/** sim GetGoldenPowerLevelSum @4174090: sum of the golden power level dict (+0x15b0) */
export function getGoldenPowerLevelSum(g) { let s = 0; for (const v of g.goldenPowerLevel.values()) s += v; return s; }

/** GameData.ProcessGoldenCube @3c248b0 (status): one level per unlocked power per call, progress += speed * secs. */
export function processGoldenCube(m, g, status) {
  const t = g.gameTime;
  for (const p of m.findAll('GoldenCubePower')) {
    const id = p.Id;
    if ((g.cubeUpgrade.get(id) ?? 0) === 0) continue;
    const lv = g.goldenPowerLevel.get(id) ?? 0;
    if (lv >= goldenPowerMax(m, status)) continue;
    const speed = g.cubeSpeed.get(id) ?? ZERO;
    if (speed.le(ZERO)) continue;
    let progress = g.cubeProgress.get(id) ?? ZERO;
    const ts = tryGetProcessSeconds(g.cubeTime.get(id) ?? 0, t);
    if (!ts.ok) { g.cubeTime.set(id, ts.last); continue; }
    g.cubeTime.set(id, t);
    progress = progress.add(speed.mul(ts.secs));
    const c = goldenCubeGoldenPowerUpgradeCost(m, id, lv, status, g.gold, 1);
    if (progress.ge(c.cost) && c.n > 0) {
      g.goldenPowerLevel.set(id, lv + 1);
      g.cubeProgress.set(id, progress.sub(c.cost));
    } else g.cubeProgress.set(id, progress);
  }
  return 0;
}

/**
 * GameData.AddGoldenCubeGoldenPowerSpeedAll @3c25bf8 (amount = fraction of gold) -> {code, spent}.
 * Powers eligible: unlocked (cubeUpgrade level>=1) and level < max. perPower = gold*amount/count (= `spent` out value).
 * 0x9c none eligible, 1 if perPower < 1. Else ModifyGold(-gold*amount); per power: settle progress to now, speed += perPower.
 */
export function addGoldenCubeGoldenPowerSpeedAll(m, g, amount) {
  const t = g.gameTime;
  const ids = [];
  for (const p of m.findAll('GoldenCubePower')) {
    if ((g.goldenPowerLevel.get(p.Id) ?? 0) < goldenPowerMax(m) && (g.cubeUpgrade.get(p.Id) ?? 0) >= 1) ids.push(p.Id);
  }
  if (ids.length === 0) return { code: 0x9c, spent: ZERO };
  const total = g.gold.mul(amount);
  const per = total.div(ids.length);
  if (per.lt(ONE)) return { code: 1, spent: per };
  modifyGold(g, total.neg());
  for (const id of ids) {
    const speed = g.cubeSpeed.get(id) ?? ZERO;
    let progress = g.cubeProgress.get(id) ?? ZERO;
    const ts = tryGetProcessSeconds(g.cubeTime.get(id) ?? 0, t);
    if (ts.ok) progress = progress.add(speed.mul(ts.secs));
    g.cubeProgress.set(id, progress);
    g.cubeSpeed.set(id, speed.add(per));
    g.cubeTime.set(id, ts.ok ? t : ts.last);
  }
  return { code: 0, spent: per };
}
