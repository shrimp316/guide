// U6c: NewWorldBalanceSimulation power sinks / science / soul spending (browser-safe).
// Spec: work/spec_parts/C_power_science_soul.md; addresses in each doc comment. Plain functions, `sim` first (see U6C_NOTES.md).
import { BigNumber } from './bignum.js';
import { NewWorldRankUpPower, SoulEnhanceCost, SoulUpgradeCost } from './expr_x.js';
import { sciencePointProductionWarAIUpgradeCost, sciencePointProductionInnovationLabUpgradeCost,
  warAIUpgradeCost, warAILearningTargetUnlockCost, warAIMaxLevel } from './expr_y.js';
import * as S from './econ_science.js';
import { getSoulEnhanceData, getSoulUpgradeData, soulAltarAssist, soulEnhanceAssist, soulUpgradeAssist } from './econ_soul.js';
import { getPioneersConversionQuote, convertPioneers } from './pioneers_econ.js';
import { getDataIdType } from './master.js';

const { ZERO } = BigNumber;
const SCIENCE_RANK_TYPES = [0x13c, 0x13d, 0x13e]; // resolved: static int[3] ScienceRankTypes (DevilOrder, WarAI, GoldenCube)
const INNOVATION_TYPES = [0xb, 5, 2];             // resolved: static int[3] InnovationTypes (order unknown; ids from Innovation DataIdType)
const WARAI_TARGET_UPGRADE = 200, WARAI_TARGET_ALTAR = 232;
const pw = (sim) => (sim.pw ??= { purchases: 0, conversions: 0 });
const pending = (g) => (g.nw?.batches.length ?? 0) > 0; // get_IsNewWorldContentPending @3b93d40

// ---------------- power ----------------
/** TryGetPowerCost @4175130 -> BigNumber | null */
export function tryGetPowerCost(sim, type, id) {
  const { m, g, st } = sim;
  let r;
  switch (type) {
    case 0: {
      const lvl = g.warAIProdLevel;
      if (lvl >= m.setting('ScienceSetting').PointUpgradeWarAILevelMax) return null;
      const c = sciencePointProductionWarAIUpgradeCost(m, lvl, st);
      return c.gt(ZERO) ? c : null;
    }
    case 1: {
      const w = m.tryGet('WarAI', id);
      if (!w) return null;
      const lvl = S.getWarAIUpgradeData(g, id).level;
      if (warAIMaxLevel(m, w, st) <= lvl) return null;
      r = warAIUpgradeCost(m, id, lvl, st, g.power, 1);
      break;
    }
    case 2: {
      const l = m.tryGet('WarAILearning', id);
      if (!l) return null;
      const lvl = S.getWarAIUpgradeData(g, id).level;
      if (l.MaxLevel <= lvl) return null;
      r = warAILearningTargetUnlockCost(m, id, lvl, st, g.power, 1);
      break;
    }
    case 3: r = S.getWarAIRankUpCost(m, g, 0x65, 1); break;
    default: return null;
  }
  return r.code === 0 && r.n >= 1 && r.cost.gt(ZERO) ? r.cost : null;
}

/** BuyPower @4174f18 -> bool */
export function buyPower(sim, type, id) {
  const { m, g, st } = sim;
  const r = type === 0 ? S.sciencePointProductionWarAIUpgrade(m, g, st)
    : type === 1 ? S.warAIUpgrade(m, g, st, id, 1)
    : type === 2 ? S.warAITargetUpgrade(m, g, st, id, 1)
    : S.warAIRankUp(m, g, 0x65, 1);
  return r === 0;
}

/** GetWarAIUnlockedTier @4175688 */
export function getWarAIUnlockedTier(sim) {
  const { m, g } = sim;
  let tier = 1;
  for (const w of m.findAll('WarAI')) {
    if (w.TargetType !== WARAI_TARGET_UPGRADE) continue;
    const u = m.tryGetUpgrade(w.TargetId);
    if (u && u.IsTierBasic && S.getWarAIUpgradeData(g, w.Id).level >= 1) tier = Math.max(tier, u.Tier ?? 0);
  }
  return tier;
}

/** IsWarAIUpgradeOpen @4175978 */
export function isWarAIUpgradeOpen(sim, w, tier) {
  const { m, g } = sim;
  if (w.TargetType === WARAI_TARGET_UPGRADE) {
    const u = m.tryGetUpgrade(w.TargetId);
    return !!u && (u.Tier ?? 0) <= (u.IsTierBasic ? 1 : 0) + tier;
  }
  if (w.TargetType === WARAI_TARGET_ALTAR) {
    const a = m.tryGetSoulAltar(w.TargetId);
    return !!a && a.Level <= g.soulAltarLevelMax; // compares running max (+0x1630), see U3 note 9
  }
  return false;
}

/** IsWarAITierBasic @4174fc0 */
export function isWarAITierBasic(sim, id) {
  const w = sim.m.tryGet('WarAI', id);
  return !!w && w.TargetType === WARAI_TARGET_UPGRADE && !!sim.m.tryGetUpgrade(w.TargetId)?.IsTierBasic;
}

/** BuildPowerPurchases @4174bac (+AddPowerPurchase @4175590) -> [{type,id,cost}] */
export function buildPowerPurchases(sim) {
  const list = [];
  const add = (type, id) => { const cost = tryGetPowerCost(sim, type, id); if (cost) list.push({ type, id, cost }); };
  add(0, 0); add(3, 0);
  const tier = getWarAIUnlockedTier(sim);
  for (const w of sim.m.findAll('WarAI')) if (isWarAIUpgradeOpen(sim, w, tier)) add(1, w.Id);
  for (const l of sim.m.findAll('WarAILearning')) add(2, l.Id);
  return list;
}

/** SpendPowerSinks @41743b8: cheapest first (ties: earlier), stop at cap / reserve / 20000 buys */
export function spendPowerSinks(sim, reserve, useCap, cap) {
  if (!sim.isUnlocked(0x70)) return;
  const { g } = sim;
  let list = buildPowerPurchases(sim);
  for (let n = 0; n < 20000; n++) {
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (idx < 0 || list[i].cost.lt(list[idx].cost)) idx = i;
    if (idx < 0) break;
    const { type, id, cost } = list[idx];
    if (useCap && cost.gt(cap)) break;
    if (g.power.sub(cost).lt(reserve)) break;
    if (buyPower(sim, type, id)) {
      pw(sim).purchases++;
      if (type === 1 && isWarAITierBasic(sim, id)) list = buildPowerPurchases(sim);
      else {
        const nc = tryGetPowerCost(sim, type, id);
        if (nc) list[idx] = { type, id, cost: nc }; else list.splice(idx, 1);
      }
    } else list.splice(idx, 1);
  }
  sim.refreshStatus();
}

/** ConvertSurplusPower @4174888 (Pioneers conversions; max 50 per conversion) */
export function convertSurplusPower(sim, reserve) {
  const { g } = sim;
  if (!g.Pioneers || pending(g)) return;
  for (const conv of g.m.findAll('PioneersConversion')) {
    for (let k = 50; k > 0; k--) {
      const q = getPioneersConversionQuote(g, conv.Id, 1);
      if (!q.Allowed) break;
      if (g.power.sub(q.Cost).lt(reserve)) break;
      if (convertPioneers(g, conv.Id, 1) !== 0) break;
      pw(sim).conversions++;
    }
  }
}

/** SpendPower(this, false) @416a5c8: below rankMax only sinks priced <= nextRankCost * PowerSpendRatio */
export function spendPower(sim, flag = false) {
  const { m, g, st, S: set } = sim;
  if (!flag && g.maxRank < sim.rankMax) {
    const r = NewWorldRankUpPower(m, g.maxRank + 1, st);
    if (r.code !== 0) return r.code;
    return spendPowerSinks(sim, ZERO, true, r.value.mul(set.PowerSpendRatio));
  }
  return spendPowerSinks(sim, ZERO, false, ZERO);
}

/** SpendSurplusPower @416b9ec: spend everything above `reserve`, then Pioneers conversions */
export function spendSurplusPower(sim, reserve) {
  spendPowerSinks(sim, reserve, false, ZERO);
  convertSurplusPower(sim, reserve);
}

// ---------------- science ----------------
/** TryGetNextInnovationRank @4173ca8 -> int | null */
export function tryGetNextInnovationRank(sim) {
  const cur = S.getScienceRank(sim.g, sim.st);
  let next = 0x7fffffff;
  for (const r of sim.m.findAll('Innovation'))
    if (getDataIdType(r.Id) === 0xb && (r.Rank ?? 0) > cur && r.Rank < next) next = r.Rank;
  return next === 0x7fffffff ? null : next;
}

/** BuyNextInnovationRank @4173518: buy all ranks up to the next innovation unlock rank or none */
export function buyNextInnovationRank(sim) {
  const { m, g, st } = sim;
  const target = tryGetNextInnovationRank(sim);
  if (target === null) return;
  const delta = target - S.getScienceRank(g, st);
  if (delta < 1) return;
  const r = S.getScienceRankUpCost(m, g, st, delta);
  if (r.n < delta) return;
  if (r.cost.le(g.science)) S.scienceRankUp(m, g, st, delta);
}

/** InvestSciencePointProduction @4173634: lab upgrade vs +1 science rank by log-gain per cost */
export function investSciencePointProduction(sim, budget) {
  const { m, g, st, S: set } = sim;
  const ms = m.setting('ScienceSetting');
  const d8 = Math.log(ms.PointUpgrade); // GUESS: sub_80c7710 = ln
  const T = ms.PointTime;
  for (let n = 0; n < 20000; n++) {
    let labCost = ZERO, canLab = false;
    if (g.labLevel < ms.PointUpgradeLevelMax) {
      labCost = sciencePointProductionInnovationLabUpgradeCost(m, g.labLevel, st);
      canLab = labCost.gt(ZERO) && labCost.le(budget);
    }
    const rank = S.getScienceRank(g, st);
    const d10 = set.IncludeInnovationLabProduction ? Math.log((T + rank + 1) / (T + rank)) : 0;
    let rCost = ZERO, canRank = false;
    if (d10 > 0) {
      const r = S.getScienceRankUpCost(m, g, st, 1);
      if (r.code === 0 && r.n >= 1) { rCost = r.cost; canRank = rCost.gt(ZERO) && rCost.le(budget); }
    }
    if (!canLab && !canRank) return;
    const useLab = canLab && canRank ? labCost.mul(d10).le(rCost.mul(d8)) : canLab;
    const code = useLab ? S.sciencePointProductionInnovationLabUpgrade(m, g, st) : S.scienceRankUp(m, g, st, 1);
    if (code !== 0) return;
    budget = budget.sub(useLab ? labCost : rCost);
  }
}

/** TryGetScienceRankCost @4173f0c -> BigNumber | null */
export function tryGetScienceRankCost(sim, kind) {
  const { m, g } = sim;
  const r = kind === 0x13c ? S.getDevilOrderRankUpCost(m, g, 0x69, 1)
    : kind === 0x13d ? S.getWarAIRankUpCost(m, g, 0x69, 1) : S.getGoldenCubeRankUpCost(m, g, 0x69, 1);
  return r.code === 0 && r.n >= 1 && r.cost.gt(ZERO) ? r.cost : null;
}

/** BuyScienceRank @4174020 (result code ignored) */
export function buyScienceRank(sim, kind) {
  const { m, g } = sim;
  if (kind === 0x13c) S.devilOrderRankUp(m, g, 0x69, 1);
  else if (kind === 0x13d) S.warAIRankUp(m, g, 0x69, 1);
  else S.goldenCubeRankUp(m, g, 0x69, 1);
}

/** BuyScienceRanks @4173a88: cheapest of the 3 rank kinds until budget runs out (budget -= predicted cost) */
export function buyScienceRanks(sim, budget) {
  for (let n = 0; n < 20000; n++) {
    let best = null, bestKind = 0x13c;
    for (const k of SCIENCE_RANK_TYPES) {
      const c = tryGetScienceRankCost(sim, k);
      if (c && (!best || c.lt(best))) { best = c; bestKind = k; }
    }
    if (!best || best.gt(budget)) break;
    buyScienceRank(sim, bestKind);
    budget = budget.sub(best);
  }
}

/** SpendScience @4169fd0 */
export function spendScience(sim) {
  if (!sim.isUnlocked(0x70)) return;
  const { m, g, st } = sim;
  for (let pass = 0; pass < 8; pass++) {
    const s0 = g.science;
    buyNextInnovationRank(sim);
    investSciencePointProduction(sim, g.science.mul(0.5));
    for (const t of INNOVATION_TYPES) S.innovationUpgradeAssist(m, g, st, t, 0.25);
    buyScienceRanks(sim, g.science.mul(0.25));
    if (g.science.ge(s0.mul(0.99))) break;
  }
  sim.refreshStatus();
}

/** ProcessScienceFoundation @41692e0 (+lambdas); WithVirtualTime offset = ms index */
export function processScienceFoundation(sim) {
  if (!sim.isUnlocked(0x70)) return;
  const { m, g, st } = sim;
  if (sim.S.IncludeInnovationLabProduction) sim.withVirtualTime(() => S.processScience(m, g, st), 0);
  sim.withVirtualTime(() => S.processWarAI(m, g), 0);
  for (let i = 0; i < 100; i++) {
    const before = S.getGoldenPowerLevelSum(g);
    sim.withVirtualTime(() => S.processGoldenCube(m, g, st), i);
    if (S.getGoldenPowerLevelSum(g) === before) break;
  }
}

// ---------------- soul ----------------
/** RepeatAssist @4171b50: at most 64 calls, stop when f() < 1 */
export function repeatAssist(f) {
  for (let i = 0; f() >= 1 && i < 63; i++);
}

/** BuyWithinBudget @4171a30 */
export function buyWithinBudget(cur, cap, buy) {
  const floor = cur().sub(cap);
  for (let i = 0; i < 20000; i++) if (!cur().gt(floor) || buy() !== 0) break;
}

/** CanBuySoulLevel @4171f80 */
export function canBuySoulLevel(sim, enhance, kind, weaponId, lv, maxLv, soul) {
  if (lv >= maxLv) return false;
  const r = (enhance ? SoulEnhanceCost : SoulUpgradeCost)(sim.m, kind, weaponId, lv, sim.st, soul, 0);
  return soul.ge(r.value) && r.count > 0;
}

/** CanBuyAnySoulLevel @4171c1c */
export function canBuyAnySoulLevel(sim, enhance) {
  const { m, g, st } = sim;
  const soul = g.soul;
  const maxLv = enhance ? st.getInt(0xcb, 1) : m.setting('SoulMenuSetting').MaxLevel;
  for (const w of m.findAll('Weapon')) {
    if (w.IsDefault || (w.UnlockIndex ?? 0) > g.weaponUnlockIndex) continue;
    const d = (enhance ? getSoulEnhanceData : getSoulUpgradeData)(g, w.Id);
    if (canBuySoulLevel(sim, enhance, 1, w.Id, d.a, maxLv, soul)) return true;
    if (canBuySoulLevel(sim, enhance, 2, w.Id, d.b, maxLv, soul)) return true;
  }
  return false;
}

/** PressSoulAssist @4171b98 -> bought count */
export function pressSoulAssist(sim, enhance) {
  if (!canBuyAnySoulLevel(sim, enhance)) return 0;
  const { m, g, st } = sim;
  const r = (enhance ? soulEnhanceAssist : soulUpgradeAssist)(m, g, st, 1.0);
  return r.code === 0 ? r.count : 0;
}

/** SpendSoul @416a220 */
export function spendSoul(sim) {
  const { m, g, st } = sim;
  if (sim.isUnlocked(0x70)) {
    buyWithinBudget(() => g.soul, g.soul.mul(0.25), () => S.sciencePointProductionDevilOrderUpgrade(m, g, st));
    let B = g.soul.mul(0.25);
    for (let n = 0; n < 20000; n++) {
      const r = S.getDevilOrderRankUpCost(m, g, 0x66, 1);
      if (r.code !== 0 || r.n < 1 || r.cost.gt(B)) break;
      S.devilOrderRankUp(m, g, 0x66, 1);
      B = B.sub(r.cost);
    }
    S.devilOrderUpgradeAssist(m, g, st, 0x5a, 0.25);
    S.devilOrderUpgradeAssist(m, g, st, 0x02, 0.25);
  }
  soulAltarAssist(m, g);
  sim.refreshStatus();
  repeatAssist(() => pressSoulAssist(sim, true));
  sim.refreshStatus();
  repeatAssist(() => pressSoulAssist(sim, false));
  sim.refreshStatus();
}
