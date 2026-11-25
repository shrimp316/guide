// U6a (gold part): NewWorldBalanceSimulation field income, weapons, fields, gold spending (A_core.md 2.5-2.6).
// Plain functions fn(sim, ...). Addresses = libil2cpp vaddr. Mark/Commit ledgers are not ported (no effect on results).
import { BigNumber } from './bignum.js';
import * as E from './game_econ.js';
import * as W from './game_world.js';
import { WeaponPower, WeaponDmg, WeaponPrice, WeaponEnhanceCost, ResearchCost } from './expr_x.js';
import { arcLinkUpgradeCost, goldenCubeUpgradeCost, goldenCubeGoldenPowerUnlockCost, sciencePointProductionGoldenCubeUpgradeCost } from './expr_y.js';
import { getDataIdType } from './master.js';
import { addSeconds } from './timestamp.js';

const { ZERO, ONE } = BigNumber;
const cons = (sim, k) => sim.constraints.get(k) ?? -1;

// ---------------------------------------------------------------- weapons
/** GetDefaultWeaponId @417f23c */
export const getDefaultWeaponId = (sim) => (sim.st.getInt(0x18, 0) > 0 ? 5099 : 5001);
/** GetWeaponPower @417de40 */
function getWeaponPower(sim, id) {
  const lv = sim.g.weapons.get(id) ?? 0;
  return lv > 0 ? WeaponPower(sim.m, id, lv, sim.st).value : ZERO;
}
const equippedIds = (sim) => sim.g.equipped.filter((id) => id > 0 && sim.m.tryGetWeapon(id) && !sim.m.tryGetWeapon(id).IsDefault);

/** GetEquippedWeaponPower @417e6c4 */
export function getEquippedWeaponPower(sim) {
  let sum = ZERO;
  for (const id of equippedIds(sim)) sum = sum.add(getWeaponPower(sim, id));
  const d = getDefaultWeaponId(sim);
  return sum.add(WeaponPower(sim.m, d, Math.max(1, sim.g.weapons.get(d) ?? 0), sim.st).value);
}

/** AddWeaponHits @417f270 -> adds to acc {p, hits} */
function addWeaponHits(sim, id, forceMin1, acc) {
  let lv = sim.g.weapons.get(id) ?? 0;
  if (!forceMin1) { if (lv <= 0) return; } else lv = Math.max(1, lv);
  const p = WeaponPower(sim.m, id, lv, sim.st), d = WeaponDmg(sim.m, id, lv, 0, sim.st);
  if (p.code === 0 && d.code === 0 && !d.value.le(ZERO)) { acc.p = acc.p.add(p.value); acc.hits = acc.hits.add(p.value.div(d.value)); }
}

/** GetCriticalExpectation @417f4c8 */
function criticalExpectation(sim) {
  const st = sim.st;
  let r = ONE;
  const c1 = st.get(0x32, ZERO);
  if (c1.gt(ZERO)) r = r.mul(ONE.add(st.get(0x33, ONE).sub(ONE).mul(0.01).mul(c1)));
  const c2 = st.get(0x34, ZERO);
  if (c2.gt(ZERO)) r = r.mul(ONE.add(st.get(0x35, ONE).sub(ONE).mul(0.01).mul(c2)));
  return r;
}

/** GetEquippedHitDamage @417ecdc */
export function getEquippedHitDamage(sim) {
  const acc = { p: ZERO, hits: ZERO };
  for (const id of equippedIds(sim)) addWeaponHits(sim, id, false, acc);
  addWeaponHits(sim, getDefaultWeaponId(sim), true, acc);
  return acc.hits.gt(ZERO) ? acc.p.div(acc.hits).mul(criticalExpectation(sim)) : ZERO;
}

/** EquipWeapons @416ac9c */
export function equipWeapons(sim) {
  const { m, g } = sim, lim = cons(sim, 0x1e), list = [];
  for (const w of m.findAll('Weapon')) {
    if (!w.IsDefault && (w.UnlockIndex ?? 0) + 1 <= lim && (g.weapons.get(w.Id) ?? 0) > 0) list.push({ id: w.Id, p: getWeaponPower(sim, w.Id) });
  }
  if (!list.length) return;
  list.sort((a, b) => b.p.cmp(a.p));            // stable, power descending
  for (let slot = 0; slot < 5; slot++) {
    const want = slot < list.length ? list[slot].id : 0;
    if (slot < g.equipped.length && g.equipped[slot] !== want) E.setWeapon(m, g, slot, want);
  }
}

// ---------------------------------------------------------------- field model
/** GetBoardBricks @417e5b0 */
function getBoardBricks(sim, field) {
  const row = sim.m.tryGetField(field);
  if (!row) return 2;
  const size = sim.g.singularityEnhanced.has(row.Block) ? row.SingularityEnhancedBoardSize : row.BoardSize;
  return (size >> 1) * size;
}

/** GetFieldBlockAverage @417dfa4 (newWorld = true in every caller) -> {hp, gold} */
export function getFieldBlockAverage(sim, field) {
  const { m, st } = sim, gs = m.setting('GameSetting');
  const range = gs.BlockFieldLevelRange, period = Math.max(gs.HighBlockChancePeriod, 1);
  const hpMul = st.get(200, ONE), goldMul = st.get(1, ONE);
  let sumW = 0, sumHW = 0;
  for (let i = 0; i < range; i++) { sumW += m.safeGetBlockChanceWeights(i); sumHW += m.safeGetHighBlockChanceWeights(i); }
  let avgHp = ZERO, avgGold = ZERO, total = 0;
  for (let f = Math.max(field - range + 1, 1); f <= field; f++) {
    const blk = m.tryGetNewWorldBlockByField(f);
    if (!blk) continue;
    const idx = (f - field - 1) + Math.min(range, field);
    const w = sumW > 0 ? m.safeGetBlockChanceWeights(idx) / sumW : 0;
    const wh = sumHW > 0 ? m.safeGetHighBlockChanceWeights(idx) / sumHW : w;
    const p = (w * (period - 1) + wh) / period;
    if (p > 0) {
      let hp = m.bn(blk, 'Hp').mul(hpMul).mul(st.getBlockHpBonus(blk.Id));
      if (hp.lt(ONE)) hp = ONE;
      avgHp = avgHp.add(hp.mul(p));
      avgGold = avgGold.add(m.bn(blk, 'Reward').mul(goldMul).mul(st.getBlockGoldBonus(blk.Id)).mul(p));
      total += p;
    }
  }
  if (total > 0) { avgHp = avgHp.div(total); avgGold = avgGold.div(total); }
  return { hp: avgHp, gold: avgGold };
}

/** GetFieldRates @4167dc8 -> {A blocks/s, B effective damage/s, C gold/s} */
export function getFieldRates(sim, field, dps, hit) {
  const r = { A: ZERO, B: ZERO, C: ZERO };
  const { hp, gold } = getFieldBlockAverage(sim, field);
  if (dps.le(ZERO) || hp.le(ZERO)) return r;
  const S = sim.S;
  const supply = new BigNumber(getBoardBricks(sim, field) / Math.max(S.FieldBoardCycleSeconds, 0.01));
  const dpsHp = dps.div(hp);
  r.A = dpsHp.lt(supply) ? dpsHp : supply;
  const over = hit.mul(S.FieldOverkillHitsPerKill);
  const need = hp.gt(over) ? hp : over;
  const ax = r.A.mul(need);
  r.B = dps.lt(ax) ? dps : ax;
  r.C = r.A.mul(gold);
  return r;
}

const fieldDps = (sim) => getEquippedWeaponPower(sim).mul(sim.S.FieldDpsFactor);

/** AddFieldIncome @4167430 */
export function addFieldIncome(sim, from, to) {
  const dt = (to - from) / 1000;
  if (dt <= 0) return;
  const { m, g, st } = sim;
  const extra = W.getTimeRampageExtraSeconds(m, g, from, to);
  const { B, C } = getFieldRates(sim, g.field, fieldDps(sim), getEquippedHitDamage(sim));
  if (B.le(ZERO)) { sim.warn('field_income', 'B<=0'); return; }
  const eff = dt + extra;
  E.modifyGold(g, C.mul(eff));
  const p = B.mul(st.get(2, ONE)).mul(eff);
  g.worldTreeProcessing = true;                 // AddPower @4168140 (reflection flag around ModifyPower)
  try { E.modifyPower(g, p); } finally { g.worldTreeProcessing = false; }
}

/** SelectField @416b3e8 */
export function selectField(sim) {
  const { m, g } = sim;
  const dps = fieldDps(sim), hit = getEquippedHitDamage(sim);
  const maxF = Math.min(g.unlockedFields, cons(sim, 0x16));
  const rates = [];
  let bestC = ZERO;
  for (let f = 1; f <= maxF; f++) { rates[f] = getFieldRates(sim, f, dps, hit); if (rates[f].C.gt(bestC)) bestC = rates[f].C; }
  let best = g.field, bestB = ZERO;
  const thr = bestC.mul(0.9);
  for (let f = 1; f <= maxF; f++) if (rates[f].C.ge(thr) && rates[f].B.ge(bestB)) { bestB = rates[f].B; best = f; }
  if (best !== g.field) E.setField(m, g, best);
  if (!dps.le(ZERO)) {
    for (let f = maxF; f > 0; f--) {
      const { hp } = getFieldBlockAverage(sim, f);
      if (hp.mul(getBoardBricks(sim, f)).div(dps).toDouble() <= 60) { E.setClearedField(m, g, sim.st, f); return; }
    }
  }
}

// ---------------------------------------------------------------- gold purchases
/** IsGoldenCubeUpgradeVisible @417135c */
function isGoldenCubeUpgradeVisible(sim, id) {
  const { m, g } = sim, t = getDataIdType(id);
  if (t === 0xb) { const r = m.tryGet('Innovation', id); return !!r && r.Rank <= E.getScienceRank(g, sim.st); }
  if (t === 6) { const c = m.tryGetCard(id); return !!c && c.Mode === 10 && W.getCardData(g, id).Level > 0; }
  return false;
}

/** TryGetGoldCost @416f3f8 -> BigNumber | null */
export function tryGetGoldCost(sim, kind, id) {
  const { m, g, st } = sim;
  switch (kind) {
    case 0: {
      const lv = g.weapons.get(id) ?? 0;
      if (lv <= 0) return null;
      const r = WeaponEnhanceCost(m, id, lv, st, g.gold, 1);
      return r.code === 0 && r.count >= 1 && r.value.gt(ZERO) ? r.value : null;
    }
    case 1: {
      const up = m.tryGetUpgrade(id);
      if (!up) return null;
      const lv = g.research.get(id) ?? 0;
      if (lv >= up.MaxLevel) return null;
      const r = ResearchCost(m, id, lv, st, g.gold, 1);
      return r.code === 0 && r.count >= 1 && r.value.gt(ZERO) ? r.value : null;
    }
    case 2: {
      const n = g.unlockedFields + 1;
      if (n > cons(sim, 0x16) || n > m.fieldMax) return null;
      const row = m.tryGetField(n);
      return row ? m.getFieldPrice(row, 10) : null;
    }
    case 3: {
      const row = m.tryGet('ArkLinkUpgrade', id);
      if (!row) return null;
      const lv = g.arc.linkUpgrades.get(id) ?? 0;
      if (lv >= row.MaxLevel) return null;
      const c = arcLinkUpgradeCost(m, row, lv);
      return c.gt(ZERO) ? c : null;
    }
    case 4: {
      if ((g.cubeUpgrade.get(id) ?? 0) !== 0) return null;
      const r = goldenCubeGoldenPowerUnlockCost(m, id, st, g.gold);
      return r.code === 0 && r.value.gt(ZERO) ? r.value : null;
    }
    case 5: {
      const r = E.getGoldenCubeRankUpCost(m, g, 100, 1);
      return r.code === 0 && r.n >= 1 && r.cost.gt(ZERO) ? r.cost : null;
    }
    case 6: {
      const row = m.tryGet('GoldenCube', id);
      if (!row || !isGoldenCubeUpgradeVisible(sim, id)) return null;
      const lv = g.cubeUpgrade.get(id) ?? 0;
      if (lv >= row.MaxLevel) return null;
      const r = goldenCubeUpgradeCost(m, id, lv, st, g.gold, 1);
      return r.code === 0 && r.n >= 1 && r.cost.gt(ZERO) ? r.cost : null;
    }
    case 7: {
      const lv = g.cubeProdLevel;
      if (lv >= m.setting('ScienceSetting').PointUpgradeGoldenCubeLevelMax) return null;
      const c = sciencePointProductionGoldenCubeUpgradeCost(m, lv, st);
      return c.gt(ZERO) ? c : null;
    }
  }
  return null;
}

/** BuyGold @4170cac */
function buyGold(sim, kind, id) {
  const { m, g, st } = sim;
  switch (kind) {
    case 0: return E.enhanceWeapon(m, g, st, id, 1) === 0;
    case 1: return E.research(m, g, st, sim.constraints, id, 1) === 0;
    case 2: return E.unlockField(m, g, g.unlockedFields + 1) === 0;
    case 3: return W.upgradeArcLink(m, g, st, id) === 0;
    case 4: return E.goldenCubeGoldenPowerUnlock(m, g, st, id) === 0;
    case 5: return E.goldenCubeRankUp(m, g, 100, 1) === 0;
    case 6: return E.goldenCubeUpgrade(m, g, st, id, 1) === 0;
    case 7: return E.sciencePointProductionGoldenCubeUpgrade(m, g, st) === 0;
  }
  return false;
}

/** BuildGoldPurchases @4170520 */
function buildGoldPurchases(sim) {
  const { m, g } = sim, list = [];
  const add = (kind, id) => { const price = tryGetGoldCost(sim, kind, id); if (price) list.push({ kind, id, price }); };
  const lim = cons(sim, 0x1e);
  for (const w of m.findAll('Weapon')) if (!w.IsDefault && (w.UnlockIndex ?? 0) + 1 <= lim) add(0, w.Id);
  const tierCap = Math.min(g.researchTier, cons(sim, 10));
  for (const r of m.findAll('Upgrade')) if (getDataIdType(r.Id) === 3 && !r.IsTierBasic && (r.Tier ?? 0) <= tierCap) add(1, r.Id);
  add(2, 0);
  if (sim.isUnlocked(0x71)) for (const a of m.findAll('ArkLinkUpgrade')) add(3, a.Id);
  if (sim.isUnlocked(0x70)) {
    add(5, 0); add(7, 0);
    for (const c of m.findAll('GoldenCube')) add(6, c.Id);
  }
  return list;
}

/** TryGetNextWeaponPrice @4170ec8 */
function tryGetNextWeaponPrice(sim) {
  const { m, g, st } = sim, lim = cons(sim, 0x1e), sp = st.getInt(1000, 0);
  let price = null;
  for (const w of m.findAll('Weapon')) {
    const tier = w.SpecialTier ?? 0;
    if ((w.UnlockIndex ?? 0) + 1 <= lim && (tier < 1 || tier <= sp) && (g.weapons.get(w.Id) ?? 0) <= 0) {
      const r = WeaponPrice(m, w.Id, st);
      if (r.code === 0 && (price === null || r.value.lt(price))) price = r.value;
    }
  }
  return price;
}

/** GetGoldReserve @416fd90 */
function getGoldReserve(sim) {
  const { g } = sim, S = sim.S;
  const { C } = getFieldRates(sim, g.field, fieldDps(sim), getEquippedHitDamage(sim));
  const h1 = C.mul(S.SavingHorizonSeconds), gh1 = g.gold.add(h1);
  let best = ZERO;
  const p = tryGetGoldCost(sim, 2, 0);
  if (p && p.le(gh1)) best = p;
  const w = tryGetNextWeaponPrice(sim);
  if (w && w.le(gh1) && (best.le(ZERO) || w.lt(best))) best = w;
  if (sim.isUnlocked(0x71)) {
    const gh2 = g.gold.add(C.mul(S.ArcSavingHorizonSeconds));
    for (const a of sim.m.findAll('ArkLinkUpgrade')) {
      const c = tryGetGoldCost(sim, 3, a.Id);
      if (c && c.le(gh2) && (best.le(ZERO) || c.lt(best))) best = c;
    }
  }
  return best;
}

/** UnlockGoldenPowers @416fc14 */
export function unlockGoldenPowers(sim) {
  if (!sim.isUnlocked(0x70)) return;
  for (const id of sim.goldenPowerIds) {
    const c = tryGetGoldCost(sim, 4, id);
    if (c && c.le(sim.g.gold) && buyGold(sim, 4, id)) sim.purchases++;
  }
}

/** AccelerateGoldenPowers @41702d0 */
function accelerateGoldenPowers(sim, reserve) {
  const { m, g, S } = sim;
  if (!sim.isUnlocked(0x70) || sim.now < sim.nextGoldenPowerAt || g.gold.le(reserve)) return;
  const frac = g.gold.sub(reserve).div(g.gold).toDouble();
  const secs = S.GoldenPowerAccelerationRatio * frac;
  if (secs <= 0) return;
  let rc;
  sim.withVirtualTime(() => { rc = E.addGoldenCubeGoldenPowerSpeedAll(m, g, secs).code; });
  if (rc === 0) sim.nextGoldenPowerAt = addSeconds(sim.now, S.GoldenPowerAccelerationIntervalSeconds);
}

/** SpendGold @416a710 */
export function spendGold(sim, useReserve) {
  const { m, g } = sim;
  E.buyWeaponAssist(m, g, sim.st, sim.constraints);
  equipWeapons(sim);
  for (;;) {
    const cost = tryGetGoldCost(sim, 2, 0);
    if (!cost || !cost.le(g.gold)) break;
    if (E.unlockField(m, g, g.unlockedFields + 1) !== 0) break;
  }
  unlockGoldenPowers(sim);
  const reserve = useReserve ? getGoldReserve(sim) : ZERO;
  accelerateGoldenPowers(sim, reserve);
  let list = buildGoldPurchases(sim), tier = g.researchTier;
  for (let i = 0; i < 20000; i++) {
    let idx = -1;
    for (let j = 0; j < list.length; j++) if (idx < 0 || list[j].price.lt(list[idx].price)) idx = j;
    if (idx < 0 || list[idx].price.add(reserve).gt(g.gold)) break;
    const e = list[idx];
    if (!buyGold(sim, e.kind, e.id)) { list.splice(idx, 1); continue; }
    sim.purchases++;
    if (g.researchTier === tier) {
      const c = tryGetGoldCost(sim, e.kind, e.id);
      if (c) e.price = c; else list.splice(idx, 1);
    } else { list = buildGoldPurchases(sim); tier = g.researchTier; }
  }
}
