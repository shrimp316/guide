// UpgradeStatus weapon-power bonus (port of libil2cpp, NewWorld mode 10).
// GetWeaponTotalBonus @3b102c8; GetWeaponDmgBonus @3b14514 == GetTargetBonus(kind 0, weaponId) @3b15e64 (property get_WeaponDmgBonus
// @3b145d0 = the kind-0 TargetBonus dictionary, this+0x80[0]); get_Special3WeaponCount @3b14700 = this+0x88.
//
// this+0x88 (st.special3WeaponCount) is filled at the end of RefreshTemporary @3b14e6c (called from Refresh @3b149f4) by an interface
// call on GameData (slot 0x9d) = GameData.get_Special3WeaponCount @3b92d50 = int at GameData+0x450. GameData.RefreshSpecial3WeaponCount
// @3b97f80 computes it: number of entries of the weapon dictionary (GameData+0x458, value high dword = weapon level) whose
// GetWeaponSpecialGrade(level) >= 3. Contract: g.special3WeaponCount (int).
//
// Reads: st.getTargetBonus(0,weaponId) [BN], st.get(0x46), st.upgrades (TryGet = Dictionary.TryGetValue @3b14520), st.special3WeaponCount,
//   Master WeaponSetting {SpecialGradeEnhances[], SpecialGrade1Power, SpecialGrade2Dmg, SpecialGrade3Dmg} (Root+0xb8+0x158 obj at +0x60), Weapon row {IsDefault, NoSpeed[], NoDuration[]}.
import { BigNumber } from '../bignum.js';

const { ZERO, ONE } = BigNumber;

/** end of Refresh (@3b150a8..3b150b0): UpgradeStatus.special3WeaponCount = GameData.Special3WeaponCount */
export function refreshSpecial3WeaponCount(st, g) { st.special3WeaponCount = g.special3WeaponCount; }

// Weapon.NoSpeed/NoDuration are [bool] FlatBuffers vectors. data/*.json dumped them as int16 words (e.g. [257,8] = bool[1,1]), so
// element i = byte (i&1) of word i>>1. SafeGetNoSpeed @3a58cf0 / SafeGetNoDuration: i<0 or i>=len -> false, else (elem & 1).
const boolAt = (v, i) => { v = v ?? []; return i >= 0 && i < v.length && (((v[i >> 1] >> ((i & 1) * 8)) & 1) !== 0); };

/**
 * GetWeaponTotalBonus @3b102c8 (this=st, weaponId, level, weaponRow, opt: Nullable<int> as int|null, infos=null (includeInfo list; NW passes none)).
 * opt.hasValue = "evaluate for a forced tier": skips every grade-1/!opt-only multiplier below and uses 0x33 (opt>=1) / 0x35 (opt>=2) directly.
 * All real callers (Expression.WeaponDmg/WeaponPower) pass opt = null (Nullable 0).
 * Multiplier order (acc starts at One; every step is BN*BN or BN*double like the binary):
 *  1 target bonus kind 0 (if != One)        2 ToMultiplier(Get(0x46)*(level-1)) when level>1
 *  3 SpecialGrade1Power if !opt && grade>=1  4 SpecialGrade2Dmg if grade>1   5 SpecialGrade3Dmg^special3WeaponCount if count>=1
 *  6 if row.IsDefault: 0x14 (!=One); !opt: 0x15,0x16 (!=One), 0x17 -> *2; 0x18 (>0) -> *5
 *  7 0x1e (!=One); !opt: 0x1f (!=One); !opt&&!noSpeed: 0x28; !opt&&!noDuration: 0x29; !opt: 0x2a -> *(v*v)
 *  8 opt: opt>=1 -> *0x33;  !opt: 0x32>0 && has 0x33 -> *(1+(v33-1)*(v32*0.01))
 *  9 opt: opt>=2 -> *0x35;  !opt: 0x34>0 && has 0x35 -> *(1+(v35-1)*(v34*0.01))
 * 10 !opt: 0x3c>0 -> *(1+v*0.01)
 * grade = GetWeaponSpecialGrade(level) @4134ce8 (count of SpecialGradeEnhances[i] < level).
 */
export function getWeaponTotalBonus(st, m, g, weaponId, level, row, opt = null) {
  const ws = m.setting('WeaponSetting');
  const enh = ws.SpecialGradeEnhances ?? [];
  let grade = 0;
  while (grade < enh.length && enh[grade] < level) grade++;
  const noSpeed = boolAt(row.NoSpeed, grade), noDuration = boolAt(row.NoDuration, grade);
  const has = opt !== null && opt !== undefined;
  const tryGet = (t) => st.upgrades.get(t);

  const tb = st.getTargetBonus(0, weaponId);
  let acc = tb.ne(ONE) ? ONE.mul(tb) : ONE;
  if (level - 1 >= 1) acc = acc.mul(st.get(0x46, ONE).mul(level - 1).toMultiplier());
  if (!has && grade >= 1) acc = acc.mul(ws.SpecialGrade1Power ?? 0);
  if (grade > 1) acc = acc.mul(ws.SpecialGrade2Dmg ?? 0);
  if (st.special3WeaponCount >= 1) acc = acc.mul(new BigNumber(ws.SpecialGrade3Dmg ?? 0).pow(st.special3WeaponCount));

  const mulNe1 = (t) => { const v = tryGet(t); if (v !== undefined && v.ne(ONE)) acc = acc.mul(v); };
  if (row.IsDefault) {
    mulNe1(0x14);
    if (!has) {
      mulNe1(0x15); mulNe1(0x16);
      if (tryGet(0x17) !== undefined) acc = acc.mul(2.0);
    }
    const v = tryGet(0x18);
    if (v !== undefined && v.gt(ZERO)) acc = acc.mul(5.0);
  }
  mulNe1(0x1e);
  if (!has) mulNe1(0x1f);
  if (!has && !noSpeed) mulNe1(0x28);
  if (!has && !noDuration) mulNe1(0x29);
  if (!has) { const v = tryGet(0x2a); if (v !== undefined && v.ne(ONE)) acc = acc.mul(v.mul(v)); }

  for (const [a, b, n] of [[0x32, 0x33, 1], [0x34, 0x35, 2]]) {
    if (has) {
      const vb = tryGet(b);
      if (opt >= n && vb !== undefined) acc = acc.mul(vb);
    } else {
      const va = tryGet(a), vb = tryGet(b);
      if (va !== undefined && va.gt(ZERO) && vb !== undefined) acc = acc.mul(ONE.add(vb.sub(ONE).mul(va.mul(0.01))));
    }
  }
  if (!has) {
    const v = tryGet(0x3c);
    if (v !== undefined && v.gt(ZERO)) acc = acc.mul(ONE.add(v.mul(0.01)));
  }
  return acc;
}
