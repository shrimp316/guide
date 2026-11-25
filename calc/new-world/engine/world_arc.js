// U4 / arc: GameData Ark ("arc") nodes, links, circuits + production bonuses. Ported from ARM64 disassembly
// (libil2cpp; decompile of these methods is stub/mangled). See U4_ARC_NOTES.md.
//
// Conventions: fn(gd, status, ...args). gd = shared GameData state (plain object), gd.m = Master (master.js).
// C# int error codes kept (0 ok). Timestamps = ms Number, BigNumbers immutable.
//
// gd fields used (GameData offsets):
//   gd.arc = initArcState(gd):
//     nodes        Map<id, {level, p, q}>   +0x10e0  unlocked nodes. level int (+0), p BigNumber "Inv"/invested speed (+8),
//                                           q BigNumber progress toward remaining levels (+0x18). insertion order == .NET order.
//     links        int bitmask              +0x10e8  bit i = arc link i (0..16) installed
//     linkUpgrades Map<id, level>           +0x10f0  ArkLinkUpgrade levels (id 98101..98103)
//     lastProgress Timestamp ms             +0x10f8  last time ProgressArc ran up to
//     deviceBonus  BigNumber                +0x1100  set by refreshArcDeviceBonus
//     busy         bool                     +0x1110  re-entrancy guard (set during mutations)
//   gd.mana (+0x5c8) BigNumber, gd.manaTotal (+0x5d8) BigNumber, gd.gold (+0x4e8) BigNumber (U3 core state)
//   gd.gameMode (+0x410; default 10), gd.locked13a8 (+0x13a8 bool, default false; meaning unknown, blocks all mutations)
//   gd.newWorldId (+0x420) NewWorld theme id (90001 fire / 90002 ice / 90003 magic)
import { BigNumber } from './bignum.js';
import { tryGetArcLink, tryGetArcCircuit, getDataIdType } from './master.js';
import { arcLinkUpgradeCost, arcNodeUpgradeCost } from './expr_y.js';

const { ZERO, ONE } = BigNumber;

/** Overridable externals. getPioneersBonus = GameData.GetPioneersBonus @3bf90a8 (U5); modifyGold = GameData.ModifyGold @3b9a2a8 (U3). */
export const deps = {
  getPioneersBonus: (gd, status, type) => ONE, // DEFAULT IS A PLACEHOLDER (=1): wire U5's getPioneersBonus
  modifyGold: (gd, bn) => { gd.gold = gd.gold.add(bn); },
};

export function initArcState(gd) {
  gd.arc ??= { nodes: new Map(), links: 0, linkUpgrades: new Map(), lastProgress: 0, deviceBonus: ONE, busy: false };
  gd.mana ??= ZERO; gd.manaTotal ??= ZERO; gd.gold ??= ZERO;
  return gd.arc;
}

const mode = (gd) => gd.gameMode ?? 10;
const blocked = (gd) => gd.arc.busy || mode(gd) !== 10 || !!gd.locked13a8;

/** GameData.ModifyMana @3ba4108: mana += v; if v>0 manaTotal(+0x5d8) += v. (event callbacks / +0xa94 verification flag ignored) */
export function modifyMana(gd, v) {
  v = BigNumber.of(v);
  gd.mana = gd.mana.add(v);
  if (v.gt(ZERO)) gd.manaTotal = gd.manaTotal.add(v);
}

// ---- state accessors -------------------------------------------------------------------------------------------
/** @3bed9b0 GetArcNodeData: missing -> {0, Zero, Zero} */
export function getArcNodeData(gd, status, id) {
  return gd.arc.nodes.get(id) ?? { level: 0, p: ZERO, q: ZERO };
}
/** @3bede1c: Dictionary.GetValueOrDefault(id, 0) */
export const getArcLinkUpgradeLevel = (gd, status, id) => gd.arc.linkUpgrades.get(id) ?? 0;
/** @3bee00c */
export const isArcLinkInstalled = (gd, status, i) => (i >= 0 && i < 0x11 ? (gd.arc.links >>> i) & 1 : 0);

/** Expression.ArcLinkUpgradeValue @414a018 (row, level): type 902 -> Value * ValueUp^level ; else Value + ValueUp*level. */
export function arcLinkUpgradeValue(row, level) {
  const v = new BigNumber(row.Value ?? 0), up = new BigNumber(row.ValueUp ?? 0);
  return row.UpgradeType === 0x386 ? v.mul(up.pow(level)) : v.add(up.mul(level));
}
/** @3bedbbc GetArcLinkUpgradeValue(type): first ArkLinkUpgrade row with UpgradeType==type -> value at its current level; else Zero. */
export function getArcLinkUpgradeValue(gd, status, type) {
  for (const row of gd.m.findAll('ArkLinkUpgrade')) {
    if (row.UpgradeType === type) return arcLinkUpgradeValue(row, getArcLinkUpgradeLevel(gd, status, row.Id));
  }
  return ZERO;
}
/** @3bede78: min(17, ToInt(value(901))) */
export const getArcTotalLinks = (gd, status) => Math.min(0x11, getArcLinkUpgradeValue(gd, status, 0x385).toInt());
/** @3bedf30: max(0, total - installedCount (bits 0..16)) */
export function getArcAvailableLinks(gd, status) {
  let c = 0;
  for (let i = 0; i < 0x11; i++) c += (gd.arc.links >>> i) & 1;
  return Math.max(0, getArcTotalLinks(gd, status) - c);
}
/** @3beda30 GetArcNodeMaxLevel: base.MaxLevel + max(0, ToInt(value(900))) (clamped to int32); 0 when the node has no base row. */
export function getArcNodeMaxLevel(gd, status, id) {
  const base = gd.m.tryGet('Ark', id);
  if (!base) return 0;
  return Math.min(0x7fffffff, Math.max(0, getArcLinkUpgradeValue(gd, status, 0x384).toInt()) + base.MaxLevel);
}

// ---- actions ----------------------------------------------------------------------------------------------------
/** @3bef52c UnlockArcNode(id): node id 97xxx; pays Parse(UnlockCost) mana; new node level = ArkSetting.UnlockLevel. */
export function unlockArcNode(gd, status, id) {
  if (blocked(gd)) return 900;
  if (getDataIdType(id) !== 0x61) return 900;
  if (gd.arc.nodes.has(id)) return 0x132;
  const base = gd.m.tryGet('Ark', id);
  if (!base) return 0x65;
  const cost = BigNumber.parse(base.UnlockCost);
  if (cost.le(ZERO)) return 900;
  const lvl = gd.m.setting('ArkSetting').UnlockLevel ?? 0;
  if (lvl < 1) return 900;
  if (gd.mana.lt(cost)) return 0x25;
  gd.arc.busy = true;
  gd.arc.nodes.set(id, { level: lvl, p: ZERO, q: ZERO }); gd.arc._pc = null;
  modifyMana(gd, cost.neg());
  gd.arc.busy = false;
  return 0;
}

/** @3bf01d4 InstallArcLink(i): both end nodes must be unlocked; needs an available link slot. */
export function installArcLink(gd, status, i) {
  if (blocked(gd)) return 900;
  const l = tryGetArcLink(i);
  if (!l) return 900;
  if (isArcLinkInstalled(gd, status, i)) return 0x132;
  if (!gd.arc.nodes.has(l[0]) || !gd.arc.nodes.has(l[1])) return 0x23f;
  if (getArcAvailableLinks(gd, status) < 1) return 0x240;
  gd.arc.links = (gd.arc.links | (1 << i)) >>> 0; gd.arc._pc = null;
  return 0;
}

/** @3bf03c8 UpgradeArcLink(id): costs gold ArcLinkUpgradeCost(row, level) (returns 1 if gold is short). */
export function upgradeArcLink(gd, status, id) {
  if (blocked(gd)) return 900;
  const row = gd.m.tryGet('ArkLinkUpgrade', id);
  if (!row) return 0x65;
  const lvl = getArcLinkUpgradeLevel(gd, status, id);
  if (row.MaxLevel <= lvl) return 0x132;
  const cost = arcLinkUpgradeCost(gd.m, row, lvl);
  if (cost.le(ZERO)) return 900;
  if (gd.gold.lt(cost)) return 1;
  gd.arc.busy = true;
  gd.arc.linkUpgrades.set(id, lvl + 1); gd.arc._pc = null;
  deps.modifyGold(gd, cost.neg());
  gd.arc.busy = false;
  return 0;
}

/** @3bef964 AddArcNodeSpeed(id, pct 1..100): moves mana*pct% into node.p (the node's "speed"/investment). */
export function addArcNodeSpeed(gd, status, id, pct) {
  if (gd.arc.busy || mode(gd) !== 10) return 900;
  if (!(pct >= 1 && pct <= 100)) return 900;
  if (gd.locked13a8) return 900;
  const nd = gd.arc.nodes.get(id);
  if (!nd) return 0x12f;
  if (getArcNodeMaxLevel(gd, status, id) <= nd.level) return 0x132;
  const amount = gd.mana.mul(pct * 0.01);
  if (amount.le(ZERO)) return 0x25;
  gd.arc.busy = true;
  gd.arc.nodes.set(id, { level: nd.level, p: nd.p.add(amount), q: nd.q });
  modifyMana(gd, amount.neg());
  gd.arc.busy = false;
  return 0;
}

/**
 * @3beee44 ProgressArc(dt seconds, gd, endTimestamp) [C# arg order (double, GameData, Timestamp)]:
 * for every Ark row (sheet order) whose node exists with p>0 and level<max: q += p*dt; buy the largest n in [0,rem]
 * with ArcNodeUpgradeCost(row, level, n) <= q (binary search), q = max(0, q - cost(n)), level += n; at max level q=0.
 */
export function progressArc(gd, status, dt, end) {
  gd.arc.busy = true;
  for (const row of gd.m.findAll('Ark')) {
    const id = row.Id;
    const nd = gd.arc.nodes.get(id);
    if (!nd || nd.p.le(ZERO)) continue;
    const max = getArcNodeMaxLevel(gd, status, id);
    if (nd.level >= max) continue;
    let q = nd.q.add(nd.p.mul(dt));
    let level = nd.level;
    const rem = max - level;
    if (rem >= 1) {
      let lo = 0, hi = rem;
      while (lo < hi) {
        const mid = lo + ((hi - lo) >> 1);
        if (arcNodeUpgradeCost(gd.m, row, level, mid + 1).le(q)) lo = mid + 1; else hi = mid;
      }
      if (lo > 0) {
        q = q.sub(arcNodeUpgradeCost(gd.m, row, level, lo));
        if (ZERO.gt(q)) q = ZERO;
        level += lo;
      }
    }
    if (level >= max) q = ZERO;
    if (level !== nd.level) gd.arc._pc = null;   // perf: production-bonus cache depends on levels only
    gd.arc.nodes.set(id, { level, p: nd.p, q });
  }
  gd.arc.lastProgress = end;
  gd.arc.busy = false;
  return 0;
}

/**
 * @3bee6fc RefreshArcDeviceBonus(gd, BigNumber): sim passes status.arcDeviceBonus (UpgradeStatus +0x58/+0x60).
 * deviceBonus = v > 0 ? v : One.  `status` may be the BigNumber itself or an object with .arcDeviceBonus.
 */
export function refreshArcDeviceBonus(gd, status) {
  const v = status instanceof BigNumber ? status : status.arcDeviceBonus;
  const nv = v.gt(ZERO) ? v : ONE;
  if (!gd.arc.deviceBonus || gd.arc.deviceBonus.ne(nv)) gd.arc._pc = null;
  gd.arc.deviceBonus = nv;
}

// ---- bonuses ----------------------------------------------------------------------------------------------------
/** @3bee02c: number of installed links (0..16) having `id` as an end node. */
export function getArcNodeLinkCount(gd, status, id) {
  let c = 0;
  for (let i = 0; i < 0x11; i++) {
    if (!((gd.arc.links >>> i) & 1)) continue;
    const l = tryGetArcLink(i);
    if (l && (l[0] === id || l[1] === id)) c++;
  }
  return c;
}
/** @3bee3e4: max(One, value(902)) */
export function getArcLinkMultiplier(gd, status) {
  const v = getArcLinkUpgradeValue(gd, status, 0x386);
  return ONE.gt(v) ? ONE : v;
}
/** @3bee504 GetArcNodeBonus(id, level, deviceBonus) = BN(Pow)^level * linkMult^linkCount * deviceBonus ; Zero if node/base missing.
 *  3-arg form @3bee4b8 uses node's own level and gd.arc.deviceBonus. */
export function getArcNodeBonus(gd, status, id, level, device) {
  if (level === undefined) { level = getArcNodeData(gd, status, id).level; device = gd.arc.deviceBonus; }
  if (!gd.arc.nodes.has(id)) return ZERO;
  const base = gd.m.tryGet('Ark', id);
  if (!base) return ZERO;
  return new BigNumber(base.Pow ?? 0).pow(level)
    .mul(getArcLinkMultiplier(gd, status).pow(getArcNodeLinkCount(gd, status, id)))
    .mul(device);
}
/** @3bee0e4 GetArcCircuitLevel: min level of nodes base,+1,+3,+4 when all circuit-mask links are installed, else 0. */
export function getArcCircuitLevel(gd, status, id) {
  const c = tryGetArcCircuit(id);
  if (!c) return 0;
  const [base, mask] = c;
  if ((mask & ~gd.arc.links) !== 0) return 0;
  const L = (k) => getArcNodeData(gd, status, k).level;
  return Math.min(Math.min(L(base), L(base + 1)), Math.min(L(base + 3), L(base + 4)));
}
/** @3bee22c GetArcCircuitBonus: BN(Pow)^level (level>0); level<=0 -> One for ValueType 3/4 else Zero; unknown circuit -> Zero. */
export function getArcCircuitBonus(gd, status, id) {
  const row = gd.m.tryGet('ArkCircuit', id);
  if (!row) return ZERO;
  const lvl = getArcCircuitLevel(gd, status, id);
  if (lvl > 0) return new BigNumber(row.Pow ?? 0).pow(lvl);
  return row.ValueType === 3 || row.ValueType === 4 ? ONE : ZERO;
}
/** @3c0ff2c GetArcProductionBonus(type): product over unlocked nodes (level>=1) then circuits (level>=1) of UpgradeType==type.
 *  ValueType 2 -> *ToMultiplier(), 3 -> *bonus, 4 -> /bonus (others ignored). Start = One. */
export function getArcProductionBonus(gd, status, type) {
  const cache = gd.arc._pc ??= new Map();   // perf: valid until node levels / links / link upgrades / device bonus change (see _pc = null sites)
  const hit = cache.get(type);
  if (hit !== undefined) return hit;
  const res = arcProductionBonus(gd, status, type);
  cache.set(type, res);
  return res;
}
function arcProductionBonus(gd, status, type) {
  let r = ONE;
  const apply = (vt, b) => {
    if (vt === 2) r = r.mul(b.toMultiplier());
    else if (vt === 3) r = r.mul(b);
    else if (vt === 4) r = r.div(b);
  };
  for (const [id, nd] of gd.arc.nodes) {
    if (nd.level < 1) continue;
    const base = gd.m.tryGet('Ark', id);
    if (!base || base.UpgradeType !== type) continue;
    apply(base.ValueType, getArcNodeBonus(gd, status, id));
  }
  for (const row of gd.m.findAll('ArkCircuit')) {
    if (row.UpgradeType !== type || getArcCircuitLevel(gd, status, row.Id) < 1) continue;
    apply(row.ValueType, getArcCircuitBonus(gd, status, row.Id));
  }
  return r;
}
/** @3beae78 GetNewWorldDynamicBonus(type) = ArcProductionBonus(type) * PioneersBonus(type) */
export const getNewWorldDynamicBonus = (gd, status, type) =>
  getArcProductionBonus(gd, status, type).mul(deps.getPioneersBonus(gd, status, type));

/** @3bf1728 GetClockTowerGoldArcBonus = Dyn(1)*Dyn(0x136); mode 10 + theme "nw_fire"[inferred, see notes]:
 *  *Dyn(30)^BonusParam1 * Dyn(70)^BonusParam2. */
export function getClockTowerGoldArcBonus(gd, status) {
  let r = getNewWorldDynamicBonus(gd, status, 1).mul(getNewWorldDynamicBonus(gd, status, 0x136));
  if (mode(gd) === 10) {
    const nw = gd.m.tryGetNewWorld(gd.newWorldId);
    if (nw && nw.Theme === 'nw_fire') {
      r = r.mul(getNewWorldDynamicBonus(gd, status, 0x1e).pow(nw.BonusParam1 ?? 0));
      r = r.mul(getNewWorldDynamicBonus(gd, status, 0x46).pow(nw.BonusParam2 ?? 0));
    }
  }
  return r;
}
/** @3bf1950 GetClockTowerPowerArcBonus = Dyn(2)*Dyn(30)*Dyn(0x136) */
export const getClockTowerPowerArcBonus = (gd, status) =>
  getNewWorldDynamicBonus(gd, status, 2).mul(getNewWorldDynamicBonus(gd, status, 0x1e)).mul(getNewWorldDynamicBonus(gd, status, 0x136));

/**
 * @3c120a4 IsWorldTreeArcValid: false if any arc node row (for unlocked nodes) is malformed (no base row, CostUp<1/NaN/Inf,
 * Parse(Cost)<=0) or if an unlocked node / active circuit (level>=1) of UpgradeType 300|910 has ValueType outside 2..4.
 */
export function isWorldTreeArcValid(gd, status) {
  for (const id of gd.arc.nodes.keys()) {
    const b = gd.m.tryGet('Ark', id);
    if (!b) return false;
    const up = b.CostUp ?? 0;
    if (up < 1 || !Number.isFinite(up)) return false;
    if (BigNumber.parse(b.Cost).le(ZERO)) return false;
    if ((b.UpgradeType === 300 || b.UpgradeType === 910) && !(b.ValueType >= 2 && b.ValueType <= 4)) return false;
  }
  for (const row of gd.m.findAll('ArkCircuit')) {
    if (getArcCircuitLevel(gd, status, row.Id) < 1) continue;
    if ((row.UpgradeType === 300 || row.UpgradeType === 910) && !(row.ValueType >= 2 && row.ValueType <= 4)) return false;
  }
  return true;
}
