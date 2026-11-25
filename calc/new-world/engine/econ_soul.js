// U3 part C: Soul economy (GameData soul altar / soul enhance / soul upgrade assists). Ported from ARM64 disassembly.
//
// INTERFACE  (m = Master, g = state object, status = U2 UpgradeStatus {getInt(type,def)} or null)
//   initSoulState(g)                                  add soul fields to state `g` (idempotent)
//   modifySoul(g, amount)                             GameData.ModifySoul @3b88c1c
//   getSoulEnhanceData(g, weaponId) -> {id,a,b}       @3c31d88   dict g.soulEnhance (+0x1640); a = level of kind 1, b = kind 2
//   getSoulUpgradeData(g, weaponId) -> {id,a,b}       @3c30888   dict g.soulUpgrade (+0x1638)
//   isSoulAltarAssistAvailable(m, g) -> bool          @3c30158
//   soulAltarAssist(m, g) -> {code:0, count}          @3c303c4
//   isSoulEnhanceAssistAvailable(m, g, ratio, status) -> bool   @3c32378
//   soulEnhanceAssist(m, g, status, ratio) -> {code:0, count}   @3c32aac
//   isSoulUpgradeAssistAvailable(m, g, ratio, status) -> bool   @3c30e94
//   soulUpgradeAssist(m, g, status, ratio) -> {code:0, count}   @3c3137c
//   (the sim calls ratio = 1.0 for both assists / availability checks via PressSoulAssist)
//
// STATE FIELDS added (offsets = GameData):
//   soulPeak(+0x598) soulTotal(+0x5a8) soulTotal2(+0x5b8)  BigNumber, bookkeeping only
//   soulAltarLevel(+0x162c) highest altar level bought; soulAltarLevelMax(+0x1630) = max(itself, soulAltarLevel) after
//   each SoulAltarAssist (this is the value WarAI's IsWarAIUpgradeOpen compares: spec C says "+0x1630")
//   soulUpgrade Map(id -> {a,b}) (+0x1638), soulEnhance Map(id -> {a,b}) (+0x1640)
//   weaponUnlockIndex (+0x44c)  highest unlocked weapon UnlockIndex (owned by part A; only defaulted to 0 here if absent)
//
// SEMANTICS (from disassembly)
//  * assist ratio d0: budget0 = soul * ratio, computed ONCE. Weapons eligible = !IsDefault && UnlockIndex <= weaponUnlockIndex;
//    slots = 2*eligible (kind 1 and kind 2 per weapon). Pass p = 0,1,2..: slotBudget = budget0 / (slots - p) (stop when
//    slots-p < 1); walk the master Weapon list in REVERSE; for each eligible weapon and kind with level < maxLevel call
//    Soul{Enhance,Upgrade}Cost(kind, id, level, status, slotBudget, count=0 /*budget mode*/); buy when code==0,
//    slotBudget >= cost, n >= 1 and soul >= cost (ModifySoul(-cost), level += n, count += n). The pass loop ends after the
//    first pass in which anything was bought (so the per-slot budget only grows while nothing is affordable).
//    maxLevel: Enhance = status ? status.getInt(0xcb, 1) : SoulMenuSetting.MultiplierLevelMax; Upgrade = SoulMenuSetting.MaxLevel.
//  * SoulAltarAssist: for each SoulAltar row in sheet order with Level > soulAltarLevel and soul >= Cost: spend, count++,
//    soulAltarLevel = max(soulAltarLevel, Level)  (no break; later rows are tried with the updated level).
//  * Availability: any eligible weapon/kind with level < max where Cost(count=1, budget=soul*ratio) code==0, budget>=cost, n>0.
//
// UNCERTAINTIES
//  * @3c32378 IsSoulEnhanceAssistAvailable, kind-2 branch passes the kind-1 level (w25) as `level` (register reuse: w26 is
//    overwritten by the weapon id, w25 still holds levelA). Replicated as found (`bugKind2UsesLevelA`); the assist itself
//    (@3c32aac) uses the correct level b. Only affects the availability boolean when a != b.
//  * The enhance availability builds a cached weapon list (+0x1648/0x1650/0x1658) only filtered by max>levelA||max>levelB;
//    omitted (superset semantics, equal result since levels are re-checked).
//  * AddWorldTreeSoul @3ba3dc0 (called by ModifySoul) returns immediately for amount <= 0 (all U3 soul spending); for gains it
//    feeds the world tree (U4). modifySoul calls optional hook g.addWorldTreeSoul(amount) when amount > 0.
//  * Weapon master `UnlockIndex` absent in data == 0.
import { BigNumber } from './bignum.js';

const { ZERO } = BigNumber;

export function initSoulState(g) {
  g.soulPeak ??= ZERO; g.soulTotal ??= ZERO; g.soulTotal2 ??= ZERO;
  g.soulAltarLevel ??= 0; g.soulAltarLevelMax ??= 0;
  g.soulUpgrade ??= new Map(); g.soulEnhance ??= new Map();
  g.weaponUnlockIndex ??= 0;
  g.soul ??= ZERO;
  return g;
}

/** GameData.ModifySoul @3b88c1c */
export function modifySoul(g, amount) {
  amount = BigNumber.of(amount);
  if (amount.gt(ZERO) && g.addWorldTreeSoul) g.addWorldTreeSoul(amount);
  g.soul = g.soul.add(amount);
  g.soulPeak = g.soulPeak.gt(g.soul) ? g.soulPeak : g.soul;
  g.soulTotal = g.soulTotal.gt(g.soulPeak) ? g.soulTotal : g.soulPeak;
  if (amount.gt(ZERO)) { g.soulTotal = g.soulTotal.add(amount); g.soulTotal2 = g.soulTotal2.add(amount); }
}

const data = (map, id) => { const e = map.get(id); return e ? { id, a: e.a, b: e.b } : { id, a: 0, b: 0 }; };
export const getSoulEnhanceData = (g, id) => data(g.soulEnhance, id);
export const getSoulUpgradeData = (g, id) => data(g.soulUpgrade, id);

const eligible = (g, w) => !w.IsDefault && (w.UnlockIndex ?? 0) <= g.weaponUnlockIndex;

// ---- altar ----
export function isSoulAltarAssistAvailable(m, g) {
  for (const r of m.findAll('SoulAltar'))
    if (g.soulAltarLevel < r.Level && g.soul.ge(m.bn(r, 'Cost'))) return true;
  return false;
}

export function soulAltarAssist(m, g) {
  let count = 0;
  for (const r of m.findAll('SoulAltar')) {
    if (g.soulAltarLevel >= r.Level) continue;
    const cost = m.bn(r, 'Cost');
    if (!g.soul.ge(cost)) continue;
    modifySoul(g, cost.neg());
    count++;
    g.soulAltarLevel = Math.max(g.soulAltarLevel, r.Level);
  }
  g.soulAltarLevelMax = Math.max(g.soulAltarLevelMax, g.soulAltarLevel);
  return { code: 0, count };
}

// ---- enhance / upgrade (shared) ----
import * as X from './expr_x.js';

const KINDS = {
  en: { map: 'soulEnhance', cost: X.SoulEnhanceCost, get: getSoulEnhanceData,
        max: (m, status) => (status ? status.getInt(0xcb, 1) : m.setting('SoulMenuSetting').MultiplierLevelMax) },
  up: { map: 'soulUpgrade', cost: X.SoulUpgradeCost, get: getSoulUpgradeData,
        max: (m) => m.setting('SoulMenuSetting').MaxLevel },
};

function isAvailable(m, g, ratio, status, K, bugKind2UsesLevelA) {
  const budget = g.soul.mul(ratio), max = K.max(m, status);
  for (const w of m.findAll('Weapon')) {
    if (w.IsDefault) continue;
    if ((w.UnlockIndex ?? 0) > g.weaponUnlockIndex) continue;
    const d = K.get(g, w.Id);
    for (const kind of [1, 2]) {
      const lv = kind === 1 ? d.a : d.b;
      if (!(max > lv)) continue;
      const r = K.cost(m, kind, w.Id, kind === 2 && bugKind2UsesLevelA ? d.a : lv, status, budget, 1);
      if (r.code === 0 && budget.ge(r.value) && r.count > 0) return true;
    }
  }
  return false;
}

function assist(m, g, status, ratio, K) {
  let count = 0;
  const budget0 = g.soul.mul(ratio), max = K.max(m, status), weapons = m.findAll('Weapon');
  const slots = 2 * weapons.filter((w) => eligible(g, w)).length;
  for (let pass = 0; ; pass++) {
    const div = slots - pass;
    if (div < 1) break;
    const slot = budget0.div(div);
    let bought = 0;
    for (let i = weapons.length - 1; i >= 0; i--) {
      const w = weapons[i];
      if (!eligible(g, w)) continue;
      const d = K.get(g, w.Id);
      let { a, b } = d;
      if (max > a) {
        const r = K.cost(m, 1, w.Id, a, status, slot, 0);
        if (r.code === 0 && slot.ge(r.value) && r.count >= 1 && g.soul.ge(r.value)) {
          modifySoul(g, r.value.neg());
          a += r.count; g[K.map].set(w.Id, { a, b });
          count += r.count; bought += r.count;
        }
      }
      if (max > b) {
        const r = K.cost(m, 2, w.Id, b, status, slot, 0);
        if (r.code === 0 && slot.ge(r.value) && r.count >= 1 && g.soul.ge(r.value)) {
          modifySoul(g, r.value.neg());
          b += r.count; g[K.map].set(w.Id, { a, b });
          count += r.count; bought += r.count;
        }
      }
    }
    if (bought !== 0) break;
  }
  return { code: 0, count };
}

export const isSoulEnhanceAssistAvailable = (m, g, ratio, status) => isAvailable(m, g, ratio, status, KINDS.en, true);
export const isSoulUpgradeAssistAvailable = (m, g, ratio, status) => isAvailable(m, g, ratio, status, KINDS.up, false);
export const soulEnhanceAssist = (m, g, status, ratio) => assist(m, g, status, ratio, KINDS.en);
export const soulUpgradeAssist = (m, g, status, ratio) => assist(m, g, status, ratio, KINDS.up);
