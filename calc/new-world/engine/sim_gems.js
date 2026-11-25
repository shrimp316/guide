// U6b: NewWorldBalanceSimulation gem economy & shop (B_gems_shop.md). Plain functions fn(sim, ...); sim contract: see U6B_NOTES.md.
// Gems are never a balance: only sim.S.GemBudget vs cumulative sim.gem.gemsVariable is compared.
import { addCardFrame, cardLevelMax } from './world_cards.js';
import { modifyWorldCrystal, queueNewWorldTime, isNewWorldCardUnlocked, getCardData, isCardCraftAvailable, getWorldStoneMenu } from './game_world.js';
import { tryGetBestCrystalPurchase } from './sim_world.js';

const NW = {
  CrystalProductIds: [5, 4, 3, 2, 1].map((i) => `pr_nw_world_crystal_${i}`),   // .cctor @4197338 (biggest first)
  FrameProductIds: [3, 2, 1].map((i) => `pr_nw_card_frame_${i}`),
  TimeLeapProductIds: [3, 2, 1].map((i) => `pr_nw_time_leap_${i}`),
};
const MEMBERSHIP_IDS = ['ms_ads', 'ms_booster', 'ms_mission', 'ms_power', 'ms_soul', 'ms_science', 'ms_quantum'];  // UserState.static[0]
const FRAME_TYPES = new Set([155, 156, 157]);   // Normal / Epic / Legendary CardFrame
const LONG_MAX = Number.MAX_SAFE_INTEGER;

const G = (sim) => (sim.gem ??= {
  gemsFixed: 0, gemsVariable: 0, gemsCash: 0, gemsMembership: 0, cashPrice: 0, timeLeapHours: 0,
  bySink: [0, 0, 0], daily: new Map(), spentDetail: {}, crystalIn: {},
});
const nwShop = (sim) => sim.m.findAll('Shop').filter((r) => r.GameMode === 10);
const rewardRows = (sim, id) => sim.m.findAll('Reward').filter((r) => r.RewardId === id);
const amount = (r) => (r.PaidAmount ?? 0) + (r.FreeAmount ?? 0);

/** GetRewardGems @4165f30: sum of Gem(ItemType 1) rows. */
export const getRewardGems = (sim, id) => rewardRows(sim, id).filter((r) => r.ItemType === 1).reduce((s, r) => s + amount(r), 0);
/** GetRewardAmount @416d3d4: sum of all rows (any ItemType). */
export const getRewardAmount = (sim, id) => rewardRows(sim, id).reduce((s, r) => s + amount(r), 0);

/** GetMembershipDailyGems @4168bac: DailyFreeGem(120) of the 7 NW membership ids = 90. */
export function getMembershipDailyGems(sim) {
  return sim.m.findAll('MembershipStat').filter((s) => MEMBERSHIP_IDS.includes(s.Id) && s.UpgradeType === 120)
    .reduce((t, s) => t + Math.trunc(s.Value), 0);
}

/**
 * GrantReward @4168a7c (UserData.AddRewards, real effects): 132 world crystal, 155/156/157 frames, 1 gem (not a balance),
 * 142 pass activation (done by Setup) -> no effect. Other item types: warn. Returns [{type, amount}].
 */
export function grantReward(sim, rewardId, label = '') {
  const rows = rewardRows(sim, rewardId);
  if (!rows.length) throw new Error(`reward not found: ${rewardId}`);
  const g = sim.g, before = g.worldCrystal, list = [];
  for (const r of rows) {
    const n = amount(r);
    if (r.ItemType === 132) modifyWorldCrystal(g, n);
    else if (FRAME_TYPES.has(r.ItemType)) addCardFrame(g, r.ItemType, n);
    else if (r.ItemType !== 1 && r.ItemType !== 142) sim.warn(`reward_type_${r.ItemType}`, `reward item type ${r.ItemType} (${rewardId}) has no effect in the sim`);
    list.push({ type: r.ItemType, amount: n });
  }
  const d = g.worldCrystal - before;      // AddCrystalIn @416c034
  if (d >= 1) { const ci = G(sim).crystalIn; ci[label] = (ci[label] ?? 0) + d; }
  return list;
}

/** BuyProduct @416612c */
function buyProduct(sim, productId, label) {
  const p = sim.m.tryGet('Product', productId), s = G(sim);
  if (!p) return sim.warn(`product_${productId}`, `product not found: ${productId}`);
  if (p.CostType === 3) { if (p.ItemType === 1) s.gemsFixed += p.Price; }
  else if (p.CostType === 1) { s.cashPrice += p.Price; s.gemsCash += getRewardGems(sim, p.RewardId); }
  grantReward(sim, p.RewardId, label);
}

/** BuyStartProducts @4165be4 */
export function buyStartProducts(sim) {
  const p = sim.m.tryGet('Product', 'pr_nw_nw_pass'), s = G(sim);
  if (p) { s.cashPrice += p.Price; s.gemsCash += getRewardGems(sim, p.RewardId); }   // pass itself comes from Setup entitlement
  if (!sim.S.IncludeLimitedPackages) return;
  for (const r of nwShop(sim)) if (r.ShopId === 'nw_special' && !r.SaleCondition) buyProduct(sim, r.ProductId, '한정 패키지');
}

/** BuyRankProducts @416bd90 */
export function buyRankProducts(sim, rank) {
  const v = String(rank);
  for (const r of nwShop(sim)) if (r.ShopId === 'nw_special' && r.SaleCondition === 6 && r.SaleConditionValue === v) buyProduct(sim, r.ProductId, '랭크 패키지');
}

/** Daily-reward part of RefreshDaily @41667b8 (caller then does ActivateTimeRampage + spendGems(sim, true)). */
export function dailyRewards(sim) {
  const s = G(sim), S = sim.S;
  s.daily.clear();
  if (S.nwPass !== false) grantReward(sim, 'rw_newworld_pass', '신대륙 패스 일일');
  if (S.IncludeAds) { const p = sim.m.tryGet('Product', 'pr_nw_world_crystal_ads'); if (p) grantReward(sim, p.RewardId, '광고'); }
  if (S.IncludeMembershipGems) s.gemsMembership += getMembershipDailyGems(sim);
}

/** GetDailyGemAllowance @416c120 */
export function getDailyGemAllowance(sim) {
  const days = Math.max(1, Math.ceil(sim.S.SeasonDays));
  const d = Math.min(Math.max(sim.dayIndex + 1, 1), days);
  return Math.trunc((sim.S.GemBudget * d) / days);
}
/** GetGemAllowance @416c0dc */
export function getGemAllowance(sim) {
  if (sim.S.GemBudget < 1) return 0;
  return sim.S.Policy.IsFrontLoaded ? sim.S.GemBudget : getDailyGemAllowance(sim);
}

/** GetDailyLimit @416dd20 */
export function getDailyLimit(sim, id) {
  for (const r of nwShop(sim)) if (r.ProductId === id && r.SaleMaxCount >= 1) return r.SaleMaxCount;
  return 0x7fffffff;
}

/** HasFrameSink @416db38 */
export const hasFrameSink = (sim) => sim.m.findAll('Card').some((c) => c.Mode === 10 && isCardCraftAvailable(sim.m, sim.g, c.Id));

/** HasCrystalSink @416d5c4 (field meanings of the stone-menu part are inferred, see notes) */
export function hasCrystalSink(sim) {
  const { m, g } = sim, h = getWorldStoneMenu(g);
  if (h && g.stone.ready && h.upgradeList.some((u) => g.rank >= u.unlockRank && u.level < h.maxLevel)) return true;
  const max = cardLevelMax(m);
  return m.findAll('Card').some((c) => c.Mode === 10 && isNewWorldCardUnlocked(m, g, c.Id) && max > getCardData(g, c.Id).Level);
}

/** GetCrystalReserveGems @416cf48 */
export function getCrystalReserveGems(sim) {
  const { g } = sim, h = getWorldStoneMenu(g);
  if (!h || !g.stone.ready) return LONG_MAX;
  let need = -g.worldCrystal;
  for (const u of h.upgradeList) {
    const rem = h.maxLevel - u.level;
    if (rem > 0) { const r = u.tryGetCost(u.level, rem, h.pointInterval); if (r.ok) need += r.cost; }
  }
  if (need <= 0) return 0;
  const p = sim.m.tryGet('Product', NW.CrystalProductIds[0]);
  return Math.ceil((need * p.Price) / getRewardAmount(sim, p.RewardId));
}

/** TryPickGemProduct @416c3d0 -> product id | null. sink: 0 crystal, 1 frame, 2 time leap */
export function tryPickGemProduct(sim, sink, budget) {
  if (sink === 1 && !hasFrameSink(sim)) return null;
  if (sink === 0 && !hasCrystalSink(sim)) return null;
  const ids = sink === 1 ? NW.FrameProductIds : sink === 0 ? NW.CrystalProductIds : NW.TimeLeapProductIds;
  const s = G(sim);
  for (const id of ids) {
    const p = sim.m.tryGet('Product', id);
    if (p && p.Price <= budget && (s.daily.get(id) ?? 0) < getDailyLimit(sim, id)) return id;
  }
  return null;
}

/** BuyGemProduct @416c640 */
export function buyGemProduct(sim, sink, productId) {
  const p = sim.m.get('Product', productId), s = G(sim);
  s.gemsVariable += p.Price; s.bySink[sink] += p.Price;
  s.spentDetail[productId] = (s.spentDetail[productId] ?? 0) + p.Price;
  s.daily.set(productId, (s.daily.get(productId) ?? 0) + 1);
  if (sink === 2) {
    const hours = getRewardAmount(sim, p.RewardId);
    sim.maintainClockTower();
    const r = queueNewWorldTime(sim.m, sim.g, sim.st, hours * 3600, sim.now, sim.end);
    if (r.code !== 0) throw new Error(`time leap failed: ${r.code}`);
    sim.processPendingContent ? sim.processPendingContent() : sim.processContent(sim.now);   // ProcessPendingContent @416799c
    sim.maintainClockTower();
    s.timeLeapHours += Math.trunc(hours);
  } else grantReward(sim, p.RewardId, sink === 0 ? '보석 세계석 구매' : '보석 프레임 구매');   // AddNewWorldCardFramePurchase: counter only, not ported
}

/** SpendGemsByValue @416c1f0 */
function spendGemsByValue(sim, allowTimeLeap) {
  const s = G(sim);
  for (let n = 1000; n > 0; n--) {
    const allow = getGemAllowance(sim);
    if (allow <= s.gemsVariable) return;
    if (!(sim.now < sim.end)) return;
    sim.spendWorldCrystal();
    const remaining = allow - s.gemsVariable;
    const best = tryGetBestCrystalPurchase(sim, new Set());
    let prod;
    if (best) {
      if (best.cost <= sim.g.worldCrystal) return;
      if (!(prod = tryPickGemProduct(sim, 0, remaining))) return;
      buyGemProduct(sim, 0, prod); continue;
    }
    const cap = Math.min(allow, getDailyGemAllowance(sim)) - s.gemsVariable;
    if (cap >= 1 && (prod = tryPickGemProduct(sim, 1, cap))) { buyGemProduct(sim, 1, prod); continue; }
    const reserve = getCrystalReserveGems(sim);
    if (!allowTimeLeap) return;
    const r2 = remaining - reserve;
    if (r2 < 1) return;
    if (!(prod = tryPickGemProduct(sim, 2, r2))) return;
    buyGemProduct(sim, 2, prod);
  }
}

/** SpendGems @41690bc (allowTimeLeap only from the daily refresh) */
export function spendGems(sim, allowTimeLeap) {
  const pol = sim.S.Policy, s = G(sim);
  if (pol.IsValueOrdered) return spendGemsByValue(sim, allowTimeLeap);
  const allow = getGemAllowance(sim);
  if (allow <= s.gemsVariable) return;
  const w = [pol.CrystalWeight, pol.FrameWeight, pol.TimeLeapWeight], wsum = w[0] + w[1] + w[2];
  if (wsum <= 0 || sim.now >= sim.end) return;
  for (let n = 0; n < 1000; n++) {
    const remaining = allow - s.gemsVariable;      // allow is not recomputed inside the loop
    let best = -Number.MAX_VALUE, bestProd = null, bestSink = 0;
    for (let sink = 0; sink < 3; sink++) {
      if ((sink === 2 && !allowTimeLeap) || w[sink] <= 0) continue;
      const prod = tryPickGemProduct(sim, sink, remaining);
      if (!prod) continue;
      const deficit = (w[sink] * allow) / wsum - s.bySink[sink];
      if (deficit > best) { best = deficit; bestProd = prod; bestSink = sink; }
    }
    if (!bestProd) break;
    buyGemProduct(sim, bestSink, bestProd);
  }
}

/** CreateGemPolicy @417fb00: kind (number, 2/4 = front-loaded) or an overrides object. Value-ordered by default. */
export function createGemPolicy(o = {}) {
  const base = { Name: '', IsValueOrdered: true, IsFrontLoaded: false, CrystalWeight: 1, FrameWeight: 1, TimeLeapWeight: 1 };
  if (typeof o === 'number') {
    base.IsFrontLoaded = o === 2 || o === 4;
    base.Name = base.IsFrontLoaded ? '가치 순서, 첫날 몰아 씀' : '가치 순서, 날마다 나눠 씀';
    return base;
  }
  return { ...base, ...o };
}
