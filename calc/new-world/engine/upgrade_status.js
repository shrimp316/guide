// U2 — UpgradeStatus (bonus aggregation). Port of Assembly-CSharp UpgradeStatus (NewWorld mode 10, contentTypes 0x1b0).
// Core container + Refresh pipeline. The individual AddXxx contributions live in ./status/*.js
// (each exports `addXxx(st, m, g, u)`), see U2_NOTES.md.
//
// Fields (decompiled offsets): +0x68 gameMode, +0x6c contentTypes (flag bits), +0x70 temporaryTypes, +0x74 includeInfo,
// +0x78 Dictionary<int,BigNumber> upgrades, +0x80 TargetBonus[7] (Dictionary<int,BigNumber> each),
// +0x10 isNewWorldPassApplied, +0x58/0x60 arcDeviceBonus (BigNumber), +0x50 pioneersExternalEffects, +0x88 special3WeaponCount.
import { BigNumber } from './bignum.js';
import { combine } from './status/combine.js';
import { refresh, simRefreshStatus } from './status/refresh.js';
import { getNewWorldPassMultiplier } from './status/cards_stone.js';
import { getWeaponTotalBonus } from './status/weapon_bonus.js';

export { combine };

const { ZERO, ONE } = BigNumber;

// TargetBonus kinds (UpgradeStatus.GetTargetBonus(kind,id) @3b15e64): 1 weapon enhance cost down, 2 block gold, 3 block hp,
// 4 divine beast hp, 5 divine beast battle stat (6 unknown/unused in NW).
export const TARGET = { WEAPON_ENHANCE_COST_DOWN: 1, BLOCK_GOLD: 2, BLOCK_HP: 3, DIVINE_HP: 4, DIVINE_BATTLE: 5 };
// ValueType (AddUpgradeValue generic helper @4c93c28)
export const VT = { ADD: 1, PERCENT: 2, MULTIPLY: 3, DIVIDE: 4 };

export class UpgradeStatus {
  /** ctor @3b14708 (gameMode, contentTypes, temporaryTypes, includeInfo). NewWorld: (10, 0x1b0, 0, false). */
  constructor(m, gameMode = 10, contentTypes = 0x1b0, temporaryTypes = 0, includeInfo = false) {
    this.m = m;
    this.gameMode = gameMode; this.contentTypes = contentTypes; this.temporaryTypes = temporaryTypes; this.includeInfo = includeInfo;
    this.upgrades = new Map();                      // +0x78
    this.targets = Array.from({ length: 7 }, () => new Map()); // +0x80
    this.isNewWorldPassApplied = false;             // +0x10 (set by AddNewWorldPass)
    this.arcDeviceBonus = ONE;                      // +0x58 (set via set_ArcDeviceBonus @3b05508 by RefreshArcDeviceBonus)
    this.pioneersExternalEffects = new Map();       // +0x50
    this.special3WeaponCount = 0;                   // +0x88
    this.isGoldenSource = false;                    // +0x98 (golden-card source status: Grade 90 cards skipped)
    this.goldenSource = null;                       // +0x90
    this.hasGoldenSourceConversions = false;        // +0x99
  }

  /** content flag test (`(contentTypes >> bit) & 1`) */
  hasContent(bit) { return ((this.contentTypes >> bit) & 1) !== 0; }

  // ---- AddUpgradeValue @3ae7cbc -> generic dictionary helper @4c93c28 ----
  /** AddBonus @3ae3598 / AddUpgradeValue @3ae7cbc. Special keys: 0x2bf also bumps 0x2be by One and is stored as 0x2bc;
   *  0x174 also applies to 0x172 and is stored as 0x173.
   *  Missing key: store v (vt 1,3 / other), One+v*0.01 (vt 2), 1/v (vt 4).  Existing key c: vt1 c+v; vt2 c*(One+v*0.01);
   *  vt3 c*v; vt4 c/v; other vt: max(c, v). */
  addBonus(type, vt, v) {
    v = BigNumber.of(v);
    for (;;) {
      if (type === 0x2bf) { this.addBonus(0x2be, 1, ONE); type = 0x2bc; continue; }
      if (type === 0x174) { this.addBonus(0x172, vt, v); type = 0x173; continue; }
      break;
    }
    this.upgrades.set(type, combine(this.upgrades.get(type), vt, v));
    return this.includeInfo;
  }

  // ---- Get overloads (@3ae5258 BN, @3b15cfc int, @3b15db0 float, @3aec630 double) ----
  /** Get(type, BigNumber def) */
  get(type, def = ONE) { const v = this.upgrades.get(type); return v === undefined ? def : v; }
  /** Get(type, int def): ToInt of the stored value */
  getInt(type, def = 0) { const v = this.upgrades.get(type); return v === undefined ? def : v.toInt(); }
  /** Get(type, float def) */
  getFloat(type, def = 0) { const v = this.upgrades.get(type); return v === undefined ? def : v.toFloat(); }
  /** Get(type, double def) (@3aec630: ToDouble) */
  getDouble(type, def = 0) { const v = this.upgrades.get(type); return v === undefined ? def : v.toDouble(); }
  has(type) { return this.upgrades.has(type); }

  // ---- TargetBonus (@3b15e64 get / @3aef814 multiply) ----
  getTargetBonus(kind, id) { const v = this.targets[kind].get(id); return v === undefined ? ONE : v; }
  multiplyTargetBonus(kind, id, v) {
    const t = this.targets[kind];
    t.set(id, (t.get(id) ?? ONE).mul(v));
    return this.includeInfo;
  }
  getWeaponEnhanceCostDown(weaponId) { return this.getTargetBonus(1, weaponId); }   // @3b15f44
  getBlockGoldBonus(blockId) { return this.getTargetBonus(2, blockId); }            // @3b15f50
  getBlockHpBonus(blockId) { return this.getTargetBonus(3, blockId); }              // @3b15f5c

  /** GetGoldenCardSource @3b01714: lazily created second status with the same mode/content flags, +0x98 = true */
  getGoldenCardSource() {
    if (!this.goldenSource) {
      const s = new UpgradeStatus(this.m, this.gameMode, this.contentTypes, this.temporaryTypes, false);
      s.isGoldenSource = true;
      this.goldenSource = s;
    }
    return this.goldenSource;
  }

  /** Refresh @3b149f4 (g = GameData state, u = UserData-like {states: Map, newWorldPassEnabled}) */
  refresh(g, u) { this.g = g; refresh(this, this.m, g, u); }
  /** the sim's RefreshStatus @416547c (pass: nw_pass owned) */
  simRefresh(g, u, nwPass = true) { this.g = g; simRefreshStatus(this, this.m, g, u, { nwPass }); }
  /** GetWeaponTotalBonus @3b102c8 (opt: Nullable<int> as int|null; needs g: pass via st.g, set by refresh) */
  getWeaponTotalBonus(weaponId, level, row, opt = null) { return getWeaponTotalBonus(this, this.m, this.g, weaponId, level, row, opt); }
  /** GetNewWorldPassMultiplier @3aedab4 */
  getNewWorldPassMultiplier(type) { return getNewWorldPassMultiplier(this.m, type); }

  /** GetWorldTreeProductionBonus @3b0544c: Get(type) * Get(0x38f) */
  getWorldTreeProductionBonus(type) { return this.get(type, ONE).mul(this.get(0x38f, ONE)); }
}
