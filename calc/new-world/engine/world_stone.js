// U4-B: World Stone (specialization tree + upgrade menu) -- GameData.EnsureWorldStone/BuyWorldStone/
// BuyWorldStoneSpecialization, WorldStoneMenuData, Node, Upgrade, WorldStoneTreeGenerator (all from disassembly).
//
// Shared state `gd` (GameData) fields used (decompile offsets):
//   gd.master        Master (U1)                 gd.mode   (+0x410) must be 10 (NewWorld)
//   gd.eventNumber   (+0x424)                    gd.difficulty (+0x428) 0/1/2 = rank max 10/15/20
//   gd.rank          (+0x1400) NewWorld rank     gd.worldCrystal (+0x600, Number) = currency spent by BuyWorldStone
//   gd.stone = { menu: WorldStoneMenuData|null (+0x16b8), ready: bool (+0x16c0), busy: bool (+0x16c1) }
//
// Node types: 940/942 amplifier, 941 resonance, 943 special point-reward, 944 point (cost 0), others = UpgradeType bonus.
import { BigNumber } from './bignum.js';

export const T_AMP_A = 0x3ac, T_RES = 0x3ad, T_AMP_B = 0x3ae, T_SPECIAL_POINT = 0x3af, T_POINT = 0x3b0;

// ---- PRNG (LCG, uint32 state): NextUnit @3cb5a74, Next @3cb5aa8 ----
export class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  nextUnit() { this.s = (Math.imul(this.s, 0x19660d) + 0x3c6ef35f) >>> 0; return this.s / 4294967296; }
  next(n) { return Math.trunc(this.nextUnit() * n) | 0; }
}

const hexDist = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

export class Node {
  constructor(q, r) {
    this.q = q; this.r = r;            // +0x10,+0x14
    this.type = 0; this.valueType = 0; // +0x18,+0x1c
    this.isSpecial = false;            // +0x20
    this.maxLevel = 0; this.threshold = 0; // +0x24,+0x28
    this.maxFactor = 0; this.maxLevelBonus = 0; // +0x30,+0x38
    this.level = 0;                    // +0x40
    this.neighbors = [];               // +0x48 (sorted ascending node indices)
  }
  get isSpecialFlag() { return this.isSpecial; }
  get distance() { return hexDist(this.q, this.r); }            // @3caf3d0
  get isPoint() { return this.type === T_POINT; }               // @3caf3c0
  get isNormal() { return !this.isSpecial && this.type !== T_POINT; } // @3caf5c8
  get isAmplifier() { return (this.type & ~2) === T_AMP_A; }    // @3caf79c
  get pointReward() {                                           // @3cae648
    return this.type === T_SPECIAL_POINT || this.type === T_POINT ? f2i(this.maxFactor) : 0;
  }
  /** @3cb09ac */
  getFactor(level) {
    if (this.isSpecial || this.maxLevel <= level) return this.maxFactor;
    const d = this.maxLevelBonus > 0 ? this.maxLevelBonus : 1;
    return (((this.maxFactor - 1) / d) * level) / this.maxLevel + 1;
  }
  /** @3caf954 -> BigNumber. amp = GetAmplification (1 = none). */
  getValue(level, amp = 1) {
    if (this.type >= T_AMP_A && this.type <= T_POINT) return new BigNumber(this.maxFactor);
    const base = this.isSpecial || this.maxLevel <= level ? this.maxFactor : this.getFactor(level);
    let d = amp === 1 ? base : (base - 1) * amp + 1;
    if (this.valueType === 2) d = (d - 1) * 100;
    return new BigNumber(d);
  }
}
// fcvtzs w, d with +inf -> int.Min (the game's saturation quirk) ; NaN->0
function f2i(d) { return d === Infinity ? -2147483648 : Math.trunc(d) | 0; }

export class Upgrade {
  constructor(o) {
    this.id = o.id; this.name = o.name; this.sort = o.sort; this.unlockRank = o.unlockRank; // +0x10,+0x18,+0x20,+0x24
    this.types = o.types; this.valueType = o.valueType; this.valueUp = o.valueUp;           // +0x28,+0x30,+0x38
    this.cost = o.cost; this.costUp = o.costUp; this.level = o.level ?? 0;                   // +0x40,+0x48,+0x50
  }
  get effects() { return this.types; }
  /** @3cb051c : valueUp[i]*level (+1 when ValueType is 3/4) as BigNumber. */
  getValue(i, level) {
    return new BigNumber(this.valueUp[i], 0).mul(level).add(this.valueType === 3 || this.valueType === 4 ? 1 : 0);
  }
  /** @3cb0608 : cost of `count` levels starting at `level`; stage = floor(lv/interval). */
  tryGetCost(level, count, interval) {
    if (!(level >= 0 && count > 0 && interval > 0 && level + count >= 0)) return { ok: false, cost: 0 };
    let total = 0;
    for (let k = 0; k < count; k++) {
      total += this.cost + this.costUp * Math.trunc((level + k) / interval);
      if (!Number.isSafeInteger(total)) return { ok: false, cost: 0 }; // game: OverflowException -> false
    }
    return { ok: total >= 0, cost: total };
  }
}

export class WorldStoneMenuData {
  constructor(rules) {
    this.eventNumber = 0; this.seed = 0;              // +0x10,+0x14
    this.generatorVersion = rules.generatorVersion;   // +0x18
    this.difficulty = rules.difficulty;               // +0x28
    this.rankMax = rules.rankMax;                     // +0x2c
    this.maxLevel = rules.maxLevel;                   // +0x30
    this.pointInterval = rules.pointInterval;         // +0x34
    this.radius = rules.radius;                       // +0x38
    this.specialCount = rules.specialCount;           // +0x3c
    this.pointCount = rules.pointCount;               // +0x40
    this.specialSpacing = rules.specialSpacing;       // +0x44
    this.pointSpacing = rules.pointSpacing;           // +0x48
    this.activationThreshold = rules.activationThreshold; // +0x4c
    this.costBase = rules.costBase;                   // +0x50
    this.costPerDistance = rules.costPerDistance;     // +0x54
    this.costBaseDistance = rules.costBaseDistance;   // +0x58
    this.stagePoints = rules.stagePoints.slice();     // +0x60
    this.upgrades = rules.upgrades.map((u) => new Upgrade({ ...u, level: 0 })); // +0x68
    this.bonuses = rules.bonuses;                     // +0x70
    this.nodes = [];                                  // +0x78
  }
  get upgradeList() { return this.upgrades; }
  get nodeList() { return this.nodes; }
  get maxLevelCount() { return this.maxLevel; }

  /** @3caf30c */
  getStagePoint(n) {
    if (n < 1) return 0;
    if (this.generatorVersion < 4 || !this.stagePoints.length) return 1;
    return this.stagePoints[Math.min(n, this.stagePoints.length) - 1];
  }
  /** @3cae598 : points earned by an upgrade at `level`. */
  getEarnedPoints(level) {
    if (this.pointInterval < 1) return 0;
    const stages = Math.trunc(level / this.pointInterval);
    let s = 0;
    for (let i = 1; i <= stages; i++) s += this.getStagePoint(i);
    return s;
  }
  /** @3cae3fc */
  get earnedPoints() {
    let s = 0;
    for (const u of this.upgrades) s += this.getEarnedPoints(u.level);
    this.nodes.forEach((n, i) => {
      if (n.type !== T_SPECIAL_POINT && n.type !== T_POINT) return;
      if (n.maxFactor === Infinity || f2i(n.maxFactor) < 1) return;
      if (n.isSpecial ? this.isUnlocked(i) : n.level > 0) s += n.pointReward;
    });
    return s | 0;
  }
  /** @3cae748 */
  get spentPoints() {
    let s = 0;
    for (const n of this.nodes) s += n.level * this.getLevelCost(n);
    return s | 0;
  }
  /** @3cae928 */
  get availablePoints() { return this.earnedPoints - this.spentPoints; }
  /** @3cae954 : points when every upgrade is maxed and every point node taken. */
  get totalPoints() {
    let s = this.upgrades.length * this.getEarnedPoints(this.maxLevel);
    for (const n of this.nodes) s += n.pointReward;
    return s | 0;
  }
  /** @3caea54 */
  get activeSpecialCount() {
    let c = 0;
    this.nodes.forEach((n, i) => { if (n.isSpecial && this.isUnlocked(i)) c++; });
    return c;
  }
  /** @3cae828 */
  getLevelCost(node) {
    if (node.type === T_POINT) return 0;
    if (this.generatorVersion < 4) return 1;
    return this.costBase + this.costPerDistance * Math.max(0, node.distance - this.costBaseDistance);
  }
  /** @3caf520 : sum of levels of non-special non-point neighbors. */
  getAdjacentLevel(i) {
    let s = 0;
    for (const j of this.nodes[i].neighbors) { const n = this.nodes[j]; if (!n.isSpecial && n.type !== T_POINT) s += n.level; }
    return s;
  }
  /** @3caf5e8 */
  getRemainingLevel(i) { return Math.max(0, this.nodes[i].threshold - this.getAdjacentLevel(i)); }
  /** @3cae680 */
  isUnlocked(i) {
    const n = this.nodes[i];
    if (n.isSpecial) return this.getRemainingLevel(i) === 0;
    if (n.q === 0 && n.r === 0) return true;
    for (const j of n.neighbors) { const m = this.nodes[j]; if (!m.isSpecial && m.level > 0) return true; }
    return false;
  }
  /** @3caf690 : product of factors of unlocked amplifier neighbors (1 if node special/point). */
  getAmplification(i) {
    const n = this.nodes[i];
    let a = 1;
    if (n.isSpecial || n.type === T_POINT) return a;
    for (const j of n.neighbors) { const m = this.nodes[j]; if (m.isAmplifier && this.isUnlocked(j)) a *= m.maxFactor; }
    return a;
  }
  /** @3caf7b0 */
  getResonance(node) { return new BigNumber(node.maxFactor, 0).pow(this.activeSpecialCount); }
  /** @3caf854 : -> {type, valueType, value:BigNumber} or null (no effect). */
  tryGetEffect(i) {
    const n = this.nodes[i];
    if (!(n.isSpecial ? this.isUnlocked(i) : n.level >= 1)) return null;
    if (n.type === T_RES) return { type: 2, valueType: 3, value: this.getResonance(n) };
    if (n.type >= T_AMP_A && n.type <= T_POINT) return null;
    return { type: n.type, valueType: n.valueType, value: n.getValue(n.level, this.getAmplification(i)) };
  }
  /** @3caeaec */
  findUpgrade(id) { return this.upgrades.find((u) => u.id === id) ?? null; }
  /** @3caf45c : levels purchasable now (never crosses a stage boundary). */
  getUpgradeCount(upg, count) {
    if (!upg || count <= 0) return 0;
    const lv = upg.level, rem = this.maxLevel - lv, iv = this.pointInterval;
    if (rem !== 0 && lv <= this.maxLevel && iv > 0) return Math.min(count, Math.min(rem, iv + Math.trunc(lv / iv) * iv - lv));
    return 0;
  }
}

// ---- WorldStoneTreeGenerator.ReadRules @3cb0aa8 ----
export function readRules(master, difficulty) {
  const s = master.setting('WorldStoneSetting');
  const d = difficulty;
  if (!(d >= 0 && d < s.SpecializationRadiusList.length && d < s.SpecializationSpecialCountList.length &&
        d < s.SpecializationPointCountList.length)) return null;
  const rankMax = [10, 15, 20][d]; // M.GetNewWorldRankMax(diff): EventRewardEasy/Normal/Hard column rows (U1 stub; derived from data)
  const upgrades = [];
  for (const u of master.findAll('WorldStoneUpgrade')) {
    if (u.UnlockRank > rankMax) continue;
    upgrades.push({ id: u.Id, name: u.Name, sort: u.Sort, unlockRank: u.UnlockRank, types: u.TypeList.slice(),
      valueType: u.ValueType, valueUp: u.ValueUpList.slice(), cost: u.Cost, costUp: u.CostUp });
  }
  const bonuses = master.findAll('WorldStoneSpecializationBonus').map((b) => ({
    type: b.Type, valueType: b.ValueType ?? 0, normalWeight: b.NormalWeight ?? 0, specialWeight: b.SpecialWeight ?? 0,
    normalValue: b.NormalValue ?? 0, normalValuePerDistance: b.NormalValuePerDistance ?? 0,
    normalMaxLevelBonus: b.NormalMaxLevelBonus ?? 0, specialValue: b.SpecialValue ?? 0,
    specialValuePerDistance: b.SpecialValuePerDistance ?? 0 }));
  return {
    generatorVersion: 5, difficulty: d, rankMax, maxLevel: s.UpgradeMaxLevel, pointInterval: s.SpecializationPointInterval,
    radius: s.SpecializationRadiusList[d], specialCount: s.SpecializationSpecialCountList[d],
    pointCount: s.SpecializationPointCountList[d], specialSpacing: s.SpecializationSpecialSpacing ?? 0,
    pointSpacing: s.SpecializationPointSpacing ?? 0, activationThreshold: s.SpecializationActivationThreshold ?? 0,
    costBase: s.SpecializationCostBase ?? 0, costPerDistance: s.SpecializationCostPerDistance ?? 0,
    costBaseDistance: s.SpecializationCostBaseDistance ?? 0, stagePoints: s.SpecializationStagePointList.slice(),
    upgrades, bonuses,
  };
}

// ---- generator internals ----
function buildNodes(m) { // TryGenerate prologue + BuildNeighbors @3cafa18
  const R = m.radius, idx = new Map();
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -(q + R)); r <= Math.min(R, R - q); r++) { idx.set(q + ',' + r, m.nodes.length); m.nodes.push(new Node(q, r)); }
  }
  for (const n of m.nodes) {
    for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
      if (hexDist(dq, dr) !== 1) continue;
      const j = idx.get((n.q + dq) + ',' + (n.r + dr));
      if (j !== undefined) n.neighbors.push(j);
    }
    n.neighbors.sort((a, b) => a - b);
  }
}
function shuffle(list, rng) { // @3cb3578
  for (let i = list.length; i > 1; i--) {
    const j = rng.next(i), t = list[j]; list[j] = list[i - 1]; list[i - 1] = t;
  }
}
function isSpaced(m, idx, mode) { // @3cb36b8
  const a = m.nodes[idx], sp = mode ? m.pointSpacing : m.specialSpacing;
  for (let j = 0; j < m.nodes.length; j++) {
    if (j === idx) continue;
    const b = m.nodes[j];
    if (!(mode ? b.type === T_POINT : b.isSpecial)) continue;
    if (hexDist(a.q - b.q, a.r - b.r) <= sp) return false; // max(|dq|,|dr|,|dq+dr|) of the difference
  }
  return true;
}
function isConnected(m, mode) { // @3cb381c
  let count = 0, start = -1;
  const ok = mode ? (n) => !n.isSpecial && n.level !== 0 : (n) => !n.isSpecial && n.type !== T_POINT;
  m.nodes.forEach((n, i) => {
    if (ok(n)) count++;
    if (n.q === 0 && n.r === 0 && !n.isSpecial && n.type !== T_POINT) start = i;
  });
  if (start < 0) return false;
  if (mode && m.nodes[start].level === 0) return count === 0;
  const seen = new Set([start]), queue = [start];
  for (let k = 0; k < queue.length; k++) {
    for (const j of m.nodes[queue[k]].neighbors) if (ok(m.nodes[j]) && !seen.has(j)) { seen.add(j); queue.push(j); }
  }
  return seen.size === count;
}
function getMaxFactor(b, n) { // Bonus.GetMaxFactor @3cb07ec
  const dist = n.distance;
  let v = n.isSpecial ? b.specialValue + b.specialValuePerDistance * dist
    : (b.normalValue + b.normalValuePerDistance * dist) * n.maxLevel;
  if (!n.isSpecial && n.type !== T_POINT && b.normalMaxLevelBonus > 0) v *= b.normalMaxLevelBonus;
  if (b.type === T_SPECIAL_POINT || b.type === T_POINT) return Math.floor(v);
  if (b.type >= T_AMP_A && b.type <= T_POINT) return v;
  return v * (b.valueType === 2 ? 0.01 : 1) + 1;
}
function getWeight(b, n) { // @3cb5a14
  if (b.type === T_POINT) return 0;
  if (n.isSpecial) return b.specialWeight;
  if (b.type >= T_AMP_A && b.type <= T_POINT) return 0;
  return b.normalWeight;
}
const finite = Number.isFinite;
const validFactor = (type, v) => finite(v) && (type === T_SPECIAL_POINT || type === T_POINT ? v >= 1 : v > 1); // @3cb59d4
function assignBonuses(m, rng, special) { // @3cb3dbc
  for (const n of m.nodes) {
    if (n.type === T_POINT) {
      if (!special) continue;
      let b = null; for (const x of m.bonuses) if (x.type === T_POINT) b = x;
      if (!b) return false;
      const v = getMaxFactor(b, n);
      if (!validFactor(b.type, v)) return false;
      n.valueType = b.valueType; n.maxFactor = v;
      continue;
    }
    if (n.isSpecial !== special) continue;
    let total = 0;
    for (const b of m.bonuses) { if (validFactor(b.type, getMaxFactor(b, n))) total += getWeight(b, n); }
    if (!finite(total) || total <= 0) return false;
    let target = total * rng.nextUnit(), pick = null, pickV = 0, last = null, lastV = 0;
    for (const b of m.bonuses) {
      const w = getWeight(b, n), v = getMaxFactor(b, n);
      if (w > 0 && validFactor(b.type, v)) {
        target -= w;
        if (target < 0) { pick = b; pickV = v; break; }
        last = b; lastV = v;
      }
    }
    if (!pick) { if (!last) return false; pick = last; pickV = lastV; }
    n.maxFactor = pickV; n.type = pick.type; n.valueType = pick.valueType;
    n.maxLevelBonus = n.isSpecial || pick.type === T_POINT ? 0 : pick.normalMaxLevelBonus;
  }
  return true;
}
function allocateLevels(m, list) { // @3cb4104
  let sum = 0;
  for (const i of list) sum += m.getLevelCost(m.nodes[i]);
  if (sum <= 0) return false;
  const total = m.totalPoints;
  if (sum > total) return false;
  const base = Math.trunc(total / sum);
  let rem = total - base * sum;
  for (const i of list) { m.nodes[i].maxLevel = base; m.nodes[i].threshold = 0; }
  while (rem > 0) {
    let any = false;
    for (const i of list) {
      const n = m.nodes[i], c = m.getLevelCost(n);
      if (rem < c) continue;
      n.maxLevel++; rem -= c; any = true;
      if (rem === 0) return true;
    }
    if (!any) return false;
  }
  return true;
}
function isPointRewardReachable(m) { // @3cb44d0
  const N = m.nodes, A = [], B = [];
  let maxCost = 0, specialReward = 0;
  for (const n of N) {
    const c = n.isSpecial || n.type === T_POINT ? 0 : m.getLevelCost(n);
    let pn = 0; for (const j of n.neighbors) if (N[j].type === T_POINT) pn++;
    A.push(n.maxLevel * c); B.push(pn);
    maxCost = Math.max(maxCost, c);
    if (n.isSpecial) specialReward += n.pointReward;
  }
  const budget0 = maxCost + specialReward;
  for (let i = 0; i < N.length; i++) {
    const n = N[i];
    if (n.type !== T_SPECIAL_POINT && n.type !== T_POINT) continue;
    if (!finite(n.maxFactor) || f2i(n.maxFactor) < 1) continue;
    const reward = f2i(n.maxFactor);
    if (n.isSpecial) {
      const costs = [];
      for (const j of n.neighbors) {
        const o = N[j];
        if (o.isSpecial || o.type === T_POINT || o.maxLevel < 1) continue;
        for (let l = 0; l < o.maxLevel; l++) costs.push(m.getLevelCost(o));
      }
      costs.sort((a, b) => a - b);
      const k = costs.length - n.threshold + 1;
      let s = 0; for (let t = 0; t < k; t++) s += costs[t];
      if (s < budget0) return false;
    } else {
      let w = budget0 + reward;
      if (w < 1) continue;
      for (const exclusive of [true, false]) {
        for (const j of n.neighbors) {
          if ((B[j] === 1) !== exclusive) continue;
          const take = Math.min(w, A[j]); A[j] -= take; w -= take;
        }
        if (w <= 0) break;
      }
      if (w > 0) return false;
    }
  }
  return true;
}

/**
 * WorldStoneTreeGenerator.TryGenerate @3cb2780. Up to 256 attempts on one continuous PRNG stream.
 * Validate @3cb4d50 is replaced by structural re-checks (counts/spacing/connectivity); see U4_STONE_NOTES.
 * @returns {{menu: WorldStoneMenuData|null, attempts: number}}
 */
export function tryGenerate(rules, eventNumber, seed) {
  const m = new WorldStoneMenuData(rules);
  m.eventNumber = eventNumber; m.seed = seed;
  buildNodes(m);
  const rng = new Rng(seed), N = m.nodes.length;
  for (let attempt = 1; attempt <= 256; attempt++) {
    const list = [];
    for (let i = 0; i < N; i++) {
      const n = m.nodes[i];
      n.isSpecial = false; n.type = 0; n.maxLevelBonus = 0; n.maxLevel = 0; n.threshold = 0; n.level = 0;
      if (!(n.q === 0 && n.r === 0)) list.push(i);
    }
    shuffle(list, rng);
    let c = 0;
    for (const i of list) {
      if (c === m.specialCount) break;
      if (!isSpaced(m, i, 0)) continue;
      m.nodes[i].isSpecial = true;
      if (!isConnected(m, 0)) m.nodes[i].isSpecial = false; else c++;
    }
    if (c !== m.specialCount) continue;
    shuffle(list, rng);
    c = 0;
    for (const i of list) {
      if (c === m.pointCount) break;
      const n = m.nodes[i];
      if (n.isSpecial || !isSpaced(m, i, 1)) continue;
      n.type = T_POINT;
      if (!isConnected(m, 0)) n.type = 0; else { n.maxLevel = 1; c++; }
    }
    if (c !== m.pointCount) continue;
    if (!assignBonuses(m, rng, true)) continue;
    const normals = [];
    for (let i = 0; i < N; i++) { const n = m.nodes[i]; if (!n.isSpecial && n.type !== T_POINT) normals.push(i); }
    shuffle(normals, rng);
    if (!allocateLevels(m, normals)) continue;
    let ok = true;
    for (const n of m.nodes) {
      if (!n.isSpecial) continue;
      let sum = 0;
      for (const j of n.neighbors) { const o = m.nodes[j]; if (!o.isSpecial && o.type !== T_POINT) sum += o.maxLevel; }
      n.threshold = n.type === T_AMP_B ? sum : m.activationThreshold;
      ok = ok && sum >= m.activationThreshold;
    }
    if (!ok) continue;
    if (!assignBonuses(m, rng, false)) continue;
    if (!isPointRewardReachable(m)) continue;
    if (normals.some((i) => m.nodes[i].maxLevel < 1)) continue; // Validate @3cb4d50: every normal node needs maxLevel >= 1
    return { menu: m, attempts: attempt };
  }
  return { menu: null, attempts: 256 };
}

export function initWorldStone(gd) { gd.stone = { menu: null, ready: false, busy: false }; }

/**
 * GameData.EnsureWorldStone @3c344f0 (migration/Validate of an already-stored menu is skipped).
 * @returns {boolean} IsWorldStoneReady
 */
export function ensureWorldStone(gd, status, eventNumber, seed) {
  const st = gd.stone ?? (initWorldStone(gd), gd.stone);
  if (gd.mode !== 10 || gd.eventNumber !== eventNumber) return false;
  const menu = st.menu;
  if (!menu) {
    const rules = readRules(gd.master, gd.difficulty);
    if (!rules) return false;
    const { menu: g } = tryGenerate(rules, eventNumber, seed);
    if (!g) return false;
    st.menu = g; st.ready = true;
    return true;
  }
  if (menu.eventNumber !== eventNumber || menu.seed !== seed ||
      (menu.generatorVersion >= 2 && menu.difficulty !== gd.difficulty)) { st.ready = false; return false; }
  if (!st.ready) st.ready = true; // game: Validate(menu)
  return st.ready;
}

/** GameData.BuyWorldStone @3c3491c -> int code (0 ok, 0x384 invalid, 0x65 no upgrade, 0x12f locked, 0x17 no crystal). */
export function buyWorldStone(gd, status, upgradeId, count) {
  const st = gd.stone;
  if (!st || st.busy || !st.ready || gd.mode !== 10) return 0x384;
  const menu = st.menu, upg = menu.findUpgrade(upgradeId);
  if (!upg) return 0x65;
  if (gd.rank < upg.unlockRank) return 0x12f;
  const n = menu.getUpgradeCount(upg, count);
  if (n < 1) return 0x384;
  const { ok, cost } = upg.tryGetCost(upg.level, n, menu.pointInterval);
  if (!ok) return 0x384;
  if (gd.worldCrystal - cost < 0) return 0x17;
  gd.worldCrystal -= cost;
  upg.level += n;
  return 0;
}

/** GameData.BuyWorldStoneSpecialization @3c34bc4 -> 0 ok, 900 invalid, 0x132 maxed, 0x12f locked, 0x26 not enough points. */
export function buyWorldStoneSpecialization(gd, status, nodeIndex) {
  const st = gd.stone;
  if (!st || st.busy || !st.ready || nodeIndex < 0 || gd.mode !== 10) return 900;
  const menu = st.menu;
  if (nodeIndex >= menu.nodes.length) return 900;
  const n = menu.nodes[nodeIndex];
  if (n.isSpecial) return 900;
  if (n.level >= n.maxLevel) return 0x132;
  if (!menu.isUnlocked(nodeIndex)) return 0x12f;
  if (menu.availablePoints < menu.getLevelCost(n)) return 0x26;
  n.level += 1;
  return 0;
}
