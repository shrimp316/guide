// U6d: NewWorldBalanceSimulation world-content spending (mana/arc, world crystal, cards, world stone tree, clock tower, world tree).
// Plain functions taking `sim` first (sim.m, sim.g, sim.st, sim.u, sim.S, sim.now/end, sim.refreshStatus, sim.isManaIdle). Addresses = libil2cpp vaddr.
// Ledger-only calls of the game (Mark/Commit/AddCrystalIn/Out, DisableContentBudget) are not ported. Bookkeeping counters live in sim.wd.
import { BigNumber } from './bignum.js';
import * as W from './game_world.js';
import { tryGetArcLink, tryGetArcCircuit, getCardCraftFrameCount } from './master.js';
import { arcNodeUpgradeCost, getCardFrameType, getCardLevelUpCount, getCardLevelUpCost } from './expr_y.js';
import { cardLevelMax } from './world_cards.js';
import { isValid } from './timestamp.js';

const { ZERO } = BigNumber;
const MAX_ITER = 0x4e20;
const wd = (sim) => (sim.wd ??= { crystalBuys: 0, treeGrows: 0, ctCharges: 0, ctCollected: 0 });
const require0 = (code, what) => { if (code !== 0) throw new Error(`${what} failed: ${code}`); }; // sim.Require @4165310
const cards = (m) => m.findAll('Card');                       // static MasterCard list (+0x570), table order
const absLog = (a, b) => Math.abs(Math.log(a / b));

// ---------------------------------------------------------------- cards / frames
export const getFrameBalance = (sim, type) => W.getFrameBalance(sim.g, type);   // @416ec74

/** @416eb28 GetCardGain */
export function getCardGain(sim, card, level) {
  const m = sim.m, n = m.getTypeCount(card, 10);
  let gain = 0;
  for (let i = 0; i < n; i++) {
    const v0 = m.getValue(card, i, level, 10), v1 = m.getValue(card, i, level + 1, 10);
    if (v0 > 0 && v1 > 0) gain += absLog(v1, v0);
  }
  return gain;
}

/** @416e928 TryGetCardLevelUpCost -> crystal cost | null */
export function tryGetCardLevelUpCost(sim, card) {
  const { m, g } = sim;
  if ((card.Mode ?? 0) !== 10 || !W.isNewWorldCardUnlocked(m, g, card.Id)) return null;
  const cd = W.getCardData(g, card.Id), grade = card.Grade ?? 0, ult = !!card.IsUltimate;
  if (!(cd.Level > 0) || grade === 90 || (!ult && cd.Level >= cardLevelMax(m))) return null;
  const N = getCardLevelUpCount(m, 10, ult, grade, cd.Level), cost = getCardLevelUpCost(m, 10, ult, grade, cd.Level);
  return N < 1 || cost < 0 || cd.Count < N ? null : cost;
}

/** @416dfd8 CraftCards: repeatedly craft the lowest-level (tie: cheapest) affordable card with frames. */
export function craftCards(sim) {
  const { m, g } = sim;
  for (let it = 0; it < 20000; it++) {
    let bestId = 0, bestLevel = 0x7fffffff, bestCost = Infinity;
    for (const c of cards(m)) {
      if ((c.Mode ?? 0) !== 10 || !W.isCardCraftAvailable(m, g, c.Id)) continue;
      const grade = c.Grade ?? 0, cost = getCardCraftFrameCount(grade) * W.getCardCraftCountToNextLevel(m, g, c.Id);
      if (cost <= 0 || cost > W.getFrameBalance(g, getCardFrameType(10, grade))) continue;
      const lvl = W.getCardData(g, c.Id).Level;
      if (lvl < bestLevel || (lvl === bestLevel && cost < bestCost)) { bestId = c.Id; bestLevel = lvl; bestCost = cost; }
    }
    if (bestId === 0 || W.craftCardToNextLevel(m, g, bestId) !== 0) return;
  }
}

// ---------------------------------------------------------------- world stone menu / crystal purchase
/** @416e750 GetMenuGain(menu, upgrade) */
export function getMenuGain(sim, menu, upg) {
  let gain = 0;
  const raw = upg.valueType === 3 || upg.valueType === 4;   // (type-5) u> 0xfffffffd
  for (let i = 0; i < upg.effects.length; i++) {
    let v0 = upg.getValue(i, upg.level).toDouble(), v1 = upg.getValue(i, upg.level + 1).toDouble();
    if (!raw) { v0 = v0 * 0.01 + 1; v1 = v1 * 0.01 + 1; }
    if (v0 > 0 && v1 > 0) gain += absLog(v1, v0);
  }
  const iv = menu.pointInterval, nxt = upg.level + 1;
  if (iv >= 1 && nxt % iv === 0) gain += sim.S.SpecializationPointGain * menu.getStagePoint(nxt / iv);
  return gain;
}

/**
 * @416c8e4 TryGetBestCrystalPurchase(excl:Set<id>) -> {kind:'menu'|'card', id, cost, gain(raw), ratio(gain/cost)} | null.
 * Max gain/cost; menu upgrades first, ties keep the first found.
 */
export function tryGetBestCrystalPurchase(sim, excl) {
  const { m, g } = sim;
  let best = 0, out = null;
  const menu = W.getWorldStoneMenu(g);
  if (menu) for (const u of menu.upgradeList) {
    if (g.rank < u.unlockRank || u.level >= menu.maxLevel || excl?.has(u.id)) continue;
    const t = u.tryGetCost(u.level, 1, menu.pointInterval);
    if (!t.ok || !(t.cost > 0)) continue;
    const gain = getMenuGain(sim, menu, u), r = gain / t.cost;
    if (r > best) { best = r; out = { kind: 'menu', id: u.id, cost: t.cost, gain, ratio: r }; }
  }
  for (const c of cards(m)) {
    if (excl?.has(c.Id)) continue;
    const cost = tryGetCardLevelUpCost(sim, c);
    if (cost === null || !(cost > 0)) continue;
    const gain = getCardGain(sim, c, W.getCardData(g, c.Id).Level), r = gain / cost;
    if (r > best) { best = r; out = { kind: 'card', id: c.Id, cost, gain, ratio: r }; }
  }
  return out;
}

/** @41699ec SpendWorldCrystal */
export function spendWorldCrystal(sim) {
  const { m, g, st } = sim, excl = new Set();
  for (let k = 0; k < MAX_ITER; k++) {
    craftCards(sim);
    const b = tryGetBestCrystalPurchase(sim, excl);
    if (!b || g.worldCrystal < b.cost) break;
    const code = b.kind === 'menu' ? W.buyWorldStone(m, g, st, b.id, 1) : W.levelUpCard(m, g, b.id);
    if (code !== 0) { excl.add(b.id); continue; }
    wd(sim).crystalBuys++;
  }
  sim.refreshStatus(); spendSpecializationPoints(sim); sim.refreshStatus();
}

// ---------------------------------------------------------------- world stone specialization tree
/** @416ee68 IsHexAdjacent: axial distance 1 */
export function isHexAdjacent(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr) === 2;
}
/** @416f3bc GetAmplifiedFactor */
export const getAmplifiedFactor = (node, level, amp) => 1 + (node.getFactor(level) - 1) * amp;
/** @416ecd4 GetNodeGain(menu, i) */
export function getNodeGain(menu, i) {
  const n = menu.nodeList[i];
  if (n.maxLevel < 1 || n.maxFactor <= 0) return 0;
  const amp = menu.getAmplification(i), f0 = getAmplifiedFactor(n, n.level, amp), f1 = getAmplifiedFactor(n, n.level + 1, amp);
  return f0 > 0 && f1 > 0 ? absLog(f1, f0) : 0;
}
/** @416ef0c GetSpecialValue(menu, i): value of completing special node i */
export function getSpecialValue(sim, menu, i) {
  const nodes = menu.nodeList, n = nodes[i];
  const lnf = (x) => (x > 0 ? Math.abs(Math.log(x)) : 0);
  let base = 0;
  if (n.type === 0x3af) base = sim.S.SpecializationPointGain * n.pointReward;
  else if (n.type === 0x3ad) base = lnf(n.maxFactor) * (menu.activeSpecialCount + 1);
  else if (n.isAmplifier) {
    for (const nj of nodes) {
      if (!nj.isNormal || nj.maxLevel < 1 || !isHexAdjacent(n, nj)) continue;
      const a = menu.getAmplification(nodes.indexOf(nj));
      const fOld = getAmplifiedFactor(nj, nj.maxLevel, a), fNew = getAmplifiedFactor(nj, nj.maxLevel, a * n.maxFactor);
      if (fOld > 0 && fNew > 0) base += absLog(fNew, fOld);
    }
  } else base = lnf(n.maxFactor);
  nodes.forEach((o, k) => { if (k !== i && o.type === 0x3ad && o.maxFactor > 0 && menu.isUnlocked(k)) base += lnf(o.maxFactor); });
  return base;
}

/** @416e394 SpendSpecializationPoints */
export function spendSpecializationPoints(sim) {
  const { m, g, st } = sim, menu = W.getWorldStoneMenu(g);
  if (!menu) return;
  const nodes = menu.nodeList;
  for (let guard = 0; guard <= 0x4e1e; guard++) {
    let best = -1, bestRatio = -Number.MAX_VALUE;
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i], cost = menu.getLevelCost(nd);
      if (nd.isSpecial || nd.level >= nd.maxLevel || !menu.isUnlocked(i) || cost > menu.availablePoints) continue;
      if (nd.isPoint) { best = i; break; }
      let gain = getNodeGain(menu, i);
      nodes.forEach((nj, j) => {
        if (!nj.isSpecial || !isHexAdjacent(nd, nj)) return;
        const rem = menu.getRemainingLevel(j);
        if (rem > 0) gain += getSpecialValue(sim, menu, j) / rem;
      });
      const r = gain / cost;
      if (r > bestRatio) { bestRatio = r; best = i; }
    }
    if (best < 0 || W.buyWorldStoneSpecialization(m, g, st, best) !== 0) break;
  }
}

// ---------------------------------------------------------------- mana / arc
/** @41720ec TryGetCheapestLockedArcNode -> {id, cost:BigNumber} | null */
export function tryGetCheapestLockedArcNode(sim) {
  const { m, g } = sim;
  let id = 0, cost = ZERO;
  for (const cfg of m.findAll('Ark')) {
    if (g.arc.nodes.has(cfg.Id)) continue;
    const c = m.bn(cfg, 'UnlockCost');
    if (id !== 0 && !c.lt(cost)) continue;
    id = cfg.Id; cost = c;
  }
  return id !== 0 ? { id, cost } : null;
}

/** @4173380 CanInstallArcLink */
export function canInstallArcLink(sim, i) {
  const { g, st } = sim, l = tryGetArcLink(i);
  return !W.isArcLinkInstalled(sim.m, g, st, i) && !!l && g.arc.nodes.has(l[0]) && g.arc.nodes.has(l[1]);
}

/** @4172440 InstallArcLinks: circuits in priority order (their link masks) first, then any installable link. */
export function installArcLinks(sim) {
  const { m, g, st } = sim;
  const first = (mask) => { for (let i = 0; i <= 16; i++) if (((mask >>> i) & 1) && canInstallArcLink(sim, i)) return i; return -1; };
  for (;;) {
    if (W.getArcAvailableLinks(m, g, st) < 1) return;
    let chosen = -1;
    for (const e of m.findAll('ArkCircuit')) { // GUESS: priority list (+0xa18) = ArkCircuit sheet order (asm calls M.TryGetArcCircuit(id) per entry)
      const c = tryGetArcCircuit(e.Id);
      if (c && (chosen = first(c[1])) >= 0) break;
    }
    if (chosen < 0) for (let i = 0; i <= 16 && chosen < 0; i++) if (canInstallArcLink(sim, i)) chosen = i;
    if (chosen < 0 || W.installArcLink(m, g, st, chosen) !== 0) return;
  }
}

/** @41726cc InvestArcNodes(reserve): water-fill (B - reserve) mana into node speeds so all nodes finish together. */
export function investArcNodes(sim, reserve) {
  const { m, g, st } = sim, C = [];
  for (const [id, nd] of g.arc.nodes) {
    const rem = W.getArcNodeMaxLevel(m, g, st, id) - nd.level, base = m.tryGet('Ark', id);
    if (rem <= 0 || !base) continue;
    const need = arcNodeUpgradeCost(m, base, nd.level, rem).sub(nd.q);
    if (need.gt(ZERO)) C.push({ id, N: need, P: nd.p });
  }
  if (!C.length) return false;
  const B = g.mana.sub(reserve);
  if (B.le(ZERO)) return true;
  let L;
  for (let it = 0; it < 32; it++) {
    L = B.add(C.reduce((s, c) => s.add(c.P), ZERO)).div(C.reduce((s, c) => s.add(c.N), ZERO));
    const n = C.length;
    for (let i = C.length - 1; i >= 0; i--) if (C[i].N.mul(L).lt(C[i].P)) C.splice(i, 1);
    if (C.length === n || C.length === 0) break;
  }
  for (const c of C) {
    const amt = c.N.mul(L).sub(c.P);
    if (amt.le(ZERO) || g.mana.le(ZERO)) continue;
    const pct = Math.min(100, Math.floor(amt.div(g.mana).toDouble() * 100));
    if (pct >= 1) W.addArcNodeSpeed(m, g, st, c.id, pct);
  }
  return true;
}

/** @4169de4 SpendMana. Sets sim.isManaIdle (+0x190): nothing left to unlock or invest. */
export function spendMana(sim) {
  const { m, g, st } = sim;
  if (!sim.u.isUnlockedContents(0x71)) { sim.isManaIdle = false; return; }
  for (;;) {
    const c = tryGetCheapestLockedArcNode(sim);
    if (!c || !g.mana.ge(c.cost) || W.unlockArcNode(m, g, st, c.id) !== 0) break;
  }
  installArcLinks(sim);
  const c2 = tryGetCheapestLockedArcNode(sim);
  const reserve = c2 && c2.cost.le(g.mana.add(W.getWorldTreeManaPerSecond(m, g, st).mul(21600))) ? c2.cost : ZERO; // 6h of income
  const inv = investArcNodes(sim, reserve);
  sim.isManaIdle = !(c2 || inv);
}

// ---------------------------------------------------------------- clock tower / world tree
/** @4169454 MaintainClockTower */
export function maintainClockTower(sim) {
  const { m, g, st } = sim, cs = m.setting('ClockTowerSetting'), w = wd(sim);
  if (g.ct.accrued >= cs.ClockTowerTimeMin) {
    const before = g.worldCrystal;
    require0(W.collectClockTower(m, g, st).code, 'CollectClockTower');
    w.ctCollected += g.worldCrystal - before;
  }
  const base = isValid(g.ct.last) ? g.ct.last : sim.now, secs = (sim.end - base) / 1000;
  const n = Math.min(W.getClockTowerMaxChargeCount(m, g, secs), Math.trunc(g.worldCrystal / Math.max(1, cs.ClockTowerWorldCrystalPerHour)));
  if (n >= 1) { require0(W.chargeClockTower(m, g, st, secs, n), 'ChargeClockTower'); w.ctCharges += n; }
}

/** @416b814 TryGrowWorldTree */
export function tryGrowWorldTree(sim) {
  const { m, g, st } = sim;
  if (!W.canGrowWorldTree(m, g, st)) return;
  const r = Math.max(sim.S.WorldTreeGrowthRatio, m.setting('WorldTreeSetting').GrowthMinRate);
  if (W.getWorldTreeGrowthGain(m, g, st).lt(W.worldTreeEfficiency(m, g, st).mul(r))) return;
  if (W.growWorldTree(m, g, st, sim.now) === 0) { wd(sim).treeGrows++; sim.refreshStatus(); }
}
