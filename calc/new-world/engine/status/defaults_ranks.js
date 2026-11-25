// U2 group: AddDefaults / AddRanks / AddResearches / AddRankProductions / AddEnhance / AddCommonUpgrades / AddPrestigeBonusPoint /
// AddTemporaryBuffs / AddReferenceValues / AddSingularityEnhances / AddSingularDimension.   NewWorld (gameMode 10, contentTypes 0x1b0,
// temporaryTypes 0). Addresses = libil2cpp UpgradeStatus.*. `g` = GameData state; IReadOnlyGameData interface slots resolved via
// global-metadata: 0x24e get_Rank, 0x95 get_GameSetting, 0x255 get_RankSpecialBonuses, 0x257 get_Researches, 0x27f get_WarAIUpgrades,
// 0x26b GetScienceRank, 0x18c GetQuantumRank, 0xcd get_PrestigeBonusPoint, 0x295..0x29a singularity. `st` = UpgradeStatus (../upgrade_status.js).
import { BigNumber } from '../bignum.js';

const { ZERO, ONE } = BigNumber;

/**
 * AddDefaults @3af542c: SetDefault(type, value) (@3af68a4/@3af6914) = this.upgrades[type] = value (direct dictionary set, no AddBonus rules).
 * Masters: DefaultValues, WeaponSetting, SoulMenuSetting, ScienceSetting, MeditationSetting, OracleSetting, RagnarokSetting singletons
 * (Root+0x10/+0x60/+0x70/+0x1b0/+0x210/+0x390/+0x3d0). 0x38e (ManaProduction) = One only when gameMode == 10 (inserted right after 0x2).
 * Info-only tail (NoteBonus 0x213/0x2c6, includeInfo) skipped. Reads no g/u.
 */
export function addDefaults(st, m) {
  const dv = m.setting('DefaultValues'), ws = m.setting('WeaponSetting'), sm = m.setting('SoulMenuSetting'), sc = m.setting('ScienceSetting');
  const md = m.setting('MeditationSetting'), oc = m.setting('OracleSetting'), rg = m.setting('RagnarokSetting');
  const set = (list) => { for (const [t, v] of list) st.upgrades.set(t, v); };
  set([
    [0x1, ONE], [0x2, ONE],
  ]);
  if (st.gameMode === 10) st.upgrades.set(0x38e, ONE);
  set([
    [0xa, BigNumber.of(dv.BulletRegen ?? 0)], [0xb, BigNumber.of(dv.BulletMax ?? 0)], [0x14, ONE],
    [0x15, BigNumber.of(dv.WeaponSpd ?? 0)], [0x16, ONE], [0x17, ZERO], [0x18, ZERO], [0x1e, ONE], [0x1f, ONE],
    [0x20, BigNumber.of(ws.EnhanceMaxDefault ?? 0)], [0x28, ONE], [0x29, ONE], [0x2a, ONE], [0x32, ZERO],
    [0x33, BigNumber.of((dv.CriDmg ?? 0) * 0.01)], [0x34, ZERO], [0x35, BigNumber.of((dv.SuperCriDmg ?? 0) * 0.01)],
    [0x3c, ZERO], [0x46, BigNumber.of(ws.EnhanceDmgBonus ?? 0)], [0x47, ONE], [0x64, ZERO],
    [0x65, BigNumber.of(dv.TapBuffBonus ?? 0)], [0x66, BigNumber.of(dv.TapBuffMax ?? 0)], [0x67, ZERO], [0x6e, ONE],
    [0x6f, ONE], [0x70, ONE], [0x71, ZERO], [0xc8, ONE], [0xc9, ONE], [0xca, ONE],
    [0xcb, BigNumber.of(sm.MultiplierLevelMax ?? 0)], [0xcc, ONE], [0x12c, ONE], [0x136, ONE],
    [0x137, BigNumber.of(dv.MiningTimeLimit ?? 0)], [0x14a, ONE], [0x140, BigNumber.of(sc.Point ?? 0)], [0x141, ZERO],
    [0x154, ONE], [0x157, ONE], [0x159, ONE], [0x155, ONE], [0x156, BigNumber.of(md.SkillLevelMax ?? 0)],
    [0x15b, ZERO], [0x14b, ZERO], [0x143, ONE], [0x15a, ZERO], [0x15c, ZERO], [0x14c, ZERO], [0x15e, ONE],
    [0x15f, ONE], [0x160, ZERO], [0x167, ONE], [0x161, ONE], [0x162, ONE], [0x163, ONE], [0x164, ONE], [0x165, ONE],
    [0x166, ONE], [0x186, ONE], [0x187, ONE], [0x188, ZERO], [0x189, ONE], [0x18a, ONE], [0x208, ONE], [0x209, ZERO],
    [0x20a, ONE], [0x20b, ONE], [0x20c, BigNumber.of(oc.MiracleCrystalCreationTime ?? 0)],
    [0x20d, BigNumber.of(oc.MiracleChance ?? 0)], [0x20e, BigNumber.of(oc.MiracleValue ?? 0)], [0x20f, ONE],
    [0x210, ONE], [0x211, BigNumber.of(oc.MaxDestinyRank ?? 0)], [0x212, ONE],
    [0x21c, BigNumber.of(rg.RuneIncinerationSpeed ?? 0)], [0x21d, BigNumber.of(rg.RuneIncinerationCapacity ?? 0)],
    [0x21e, ONE], [0x226, ONE], [0x227, ONE], [0x228, ZERO], [0x229, ONE], [0x22a, ONE], [0x22b, ONE], [0x22c, ONE],
    [0x22d, ZERO], [0x22e, ZERO], [0x22f, ZERO], [0x240, ONE], [0x168, ZERO], [0x169, ONE], [0x16a, ONE],
    [0x16b, ZERO], [0x16c, ONE], [0x172, ONE], [0x173, ONE], [0x190, ZERO], [0x191, ZERO], [0x192, ZERO],
    [0x193, ZERO], [0x1f4, ONE], [0x1fe, ONE], [0x258, ONE], [0x259, ZERO], [0x2bc, ONE], [0x2bd, ONE], [0x2c1, ONE],
    [0x2c2, ZERO], [0x2c7, ONE], [0x2c8, ONE], [0x2c9, ONE], [0x2ca, ONE], [0x320, ONE], [0x7d0, ONE], [0x7d1, ONE],
    [0x7d2, ONE], [0x7d3, ONE], [0x7d4, ONE],
  ]);
}

/** Expression.NewWorldRankBonus @41449d8: NewWorldRank.GoldBonus applies to type 1/0x1e (difficulty 0, type 1 squared) or 1/2 (difficulty 1). */
function newWorldRankBonus(row, difficulty, type) {
  if (!row.GoldBonus) return ONE;
  const gb = BigNumber.parse(row.GoldBonus);
  if (difficulty === 1) return type === 1 || type === 2 ? gb : ONE;
  if (difficulty !== 0) return ONE;
  if (type === 0x1e) return gb;
  return type === 1 ? gb.mul(gb) : ONE;
}
// Expression.NewWorldRankBonusTypes (static int[3] @415b8e4; data = unique rodata match 1,30,2 @15e8ad8: Gold, AllWeaponDmg, Power)
const NW_RANK_BONUS_TYPES = [1, 0x1e, 2];

/**
 * AddRanks @3afeb28 (this, GameData). mode 10: NewWorldRankMap[g.rank] (Root+0x978) -> for each type in NW_RANK_BONUS_TYPES
 * v = NewWorldRankBonus(row, GameSetting.NewWorld.Difficulty, type); if v != One AddBonus(type, 3, v). Other modes: RankMap[g.rank]
 * (Root+0x508) -> AddBonus(1 Gold, 3, GoldBonus). Then RankSpecialBonuses (g+0x1430, List<{rank,type,valueType,value}>): if count >= 1,
 * s = Get(0x258 RankSpecialBonusUp, One); each entry with type != 0: AddBonus(type, valueType, BN(value) * s).
 * g: rank int (+0x1400), difficulty int (+0x428 = GameSetting+0x14), rankSpecialBonuses array (+0x1430).
 */
export function addRanks(st, m, g) {
  if (st.gameMode === 10) {
    const row = m.tryGet('NewWorldRank', g.rank);
    if (row) for (const t of NW_RANK_BONUS_TYPES) { const v = newWorldRankBonus(row, g.difficulty, t); if (v.ne(ONE)) st.addBonus(t, 3, v); }
  } else {
    const row = m.tryGet('Rank', g.rank);
    if (row) st.addBonus(1, 3, m.bn(row, 'GoldBonus'));
  }
  if (g.rankSpecialBonuses.length >= 1) {
    const s = st.get(0x258, ONE);
    for (const e of g.rankSpecialBonuses) if (e.type !== 0) st.addBonus(e.type, e.valueType, BigNumber.of(e.value).mul(s));
  }
}

/** Extensions.GetValue(MasterUpgrade, i, level) @415c934: ValueUpType 4 base/up^lv, 3 base*up^lv, else base + up*lv (Safe* lists give 0 out of range). */
function upgradeValue(up, i, level) {
  const base = BigNumber.of(up.ValueList?.[i] ?? 0), step = BigNumber.of(up.ValueUpList?.[i] ?? 0), t = up.ValueUpType ?? 0;
  if (t === 4) return base.div(step.pow(level));
  if (t === 3) return base.mul(step.pow(level));
  return base.add(step.mul(level));
}

/**
 * AddResearches @3aff814 (this, GameData). For each (id, level) of g.research (Dictionary<int,int> @+0x1440, insertion order) with level > 0
 * and Upgrade row (Root+0x558 UpgradeMap): for i in TypeList: v = GetValue(up,i,level);
 * warAI = g.warAIUpgrade[id] (+0x1568, level) > 0 and WarAI[id] exists -> v *= 1 + Bonus*level*0.01 (double math: (Bonus*level)*0.01 + 1);
 * if this.targets[6] (enhance multipliers, filled by AddEnhance) has id: v *= it; AddBonus(TypeList[i], row.ValueType, v).
 * g: research Map id->level, warAIUpgrade Map id->level.  Master: Upgrade, WarAI.
 */
export function addResearches(st, m, g) {
  for (const [id, level] of g.research) {
    if (level <= 0) continue;
    const up = m.tryGet('Upgrade', id);
    if (!up) continue;
    const types = up.TypeList ?? [];
    for (let i = 0; i < types.length; i++) {
      let v = upgradeValue(up, i, level);
      const wl = g.warAIUpgrade.get(id) ?? 0;
      const wa = wl > 0 ? m.tryGet('WarAI', id) : null;
      if (wa) v = v.mul(((wa.Bonus ?? 0) * wl) * 0.01 + 1);
      const e = st.targets[6].get(id);
      if (e !== undefined) v = v.mul(e);
      st.addBonus(types[i], up.ValueType ?? 0, v);
    }
  }
}

/**
 * AddRankProductions @3b04fec (this, GameData). sr = GetScienceRank(st) @3b95378 = g.scienceRank(+0x1460) + Get(0x141 ScienceRank).ToInt;
 * sr >= 1 -> AddBonus(0x157 Tachyon, 3, BN(TachyonSetting.BonusPerScienceRank)^sr). qr = GetQuantumRank(st) @3b953dc = g.quantumRank(+0xdc8)
 * + Get(0x213 QuantumRank).ToInt; qr >= 1 -> AddBonus(0x159 DFuel, 3, BN(EngineRoomSetting.BonusPerQuantumRank)^qr). No mode gate.
 */
export function addRankProductions(st, m, g) {
  const sr = g.scienceRank + st.getInt(0x141, 0);
  if (sr >= 1) st.addBonus(0x157, 3, BigNumber.of(m.setting('TachyonSetting').BonusPerScienceRank ?? 0).pow(sr));
  const qr = g.quantumRank + st.getInt(0x213, 0);
  if (qr >= 1) st.addBonus(0x159, 3, BigNumber.of(m.setting('EngineRoomSetting').BonusPerQuantumRank ?? 0).pow(qr));
}

/**
 * AddEnhance @3af76b8 (this, key, valueType, v): generic AddUpgradeValue helper (@4c93948) on this.targets[6] (Dictionary<int,BN>, this+0x80[6]):
 * missing key: vt4 1/v, vt2 One+v*0.01, else v; present c: vt1 c+v, vt2 c*(One+v*0.01), vt3 c*v, vt4 c/v, else max(c,v).
 * Called by other AddXxx (cards/world stone); consumed by AddResearches (targets[6][researchId]).
 */
export function addEnhance(st, key, vt, v) {
  const t = st.targets[6], c = t.get(key);
  let r;
  if (c === undefined) r = vt === 4 ? v.rdiv(1) : vt === 2 ? ONE.add(v.mul(0.01)) : v;
  else if (vt === 1) r = c.add(v);
  else if (vt === 2) r = c.mul(ONE.add(v.mul(0.01)));
  else if (vt === 3) r = c.mul(v);
  else if (vt === 4) r = c.div(v);
  else r = c.gt(v) ? c : v;
  t.set(key, r);
}

/**
 * AddCommonUpgrades @3aee6b0 (this, UserData): whole body gated by `contentTypes bit 6` (tbz w8,#6 @3aee768 -> epilogue @3aeec04).
 * NW contentTypes 0x1b0 has bit 6 clear => no-op. Not ported.
 */
export function addCommonUpgrades(st) {
  if (st.hasContent(6)) throw new Error('AddCommonUpgrades (contentTypes bit 6) not ported');
}

/**
 * AddPrestigeBonusPoint @3b01ed8 (this, UserData, GameData): g.prestigeBonusPoint (long, +0x668) > 0 -> AddBonus(0x12c PrestigeBonus, 3, 2.0).
 * Else-branch (bit 6 set && UserData.IsUnlockedContents(0x46)) is dead in NW (bit 6 clear). NW sim never modifies prestigeBonusPoint => no-op.
 */
export function addPrestigeBonusPoint(st, g) {
  if (g.prestigeBonusPoint > 0) st.addBonus(0x12c, 3, BigNumber.of(2));
}

/**
 * AddTemporaryBuffs @3b0e458: all 4 blocks gated by this+0x70 (temporaryTypes) bits 0,1,2,3 (@3b0e6b8,3b0e9ac,3b0eda0,3b0f354,3b0f6c8).
 * NW temporaryTypes = 0 => no-op. Not ported.
 */
export function addTemporaryBuffs(st) {
  if (st.temporaryTypes) throw new Error('AddTemporaryBuffs not ported');
}

/**
 * AddReferenceValues @3b155f4 (end of Refresh). Reduces this.targets[k] (Dictionary<int,BN> values; empty -> One) and AddUpgradeValue(type, 3, r):
 * 0x7d0 = max(targets[2] block gold) ; 0x7d1 = min(targets[3] block hp) ; 0x7d2 = min(targets[1] weapon enhance cost down) ;
 * 0x7d3 = min(targets[4] divine hp) ; 0x7d4 = min(targets[5] divine battle).  (AddDefaults pre-set 0x7d0..0x7d4 = One, so result = One*r.)
 */
export function addReferenceValues(st) {
  const T = st.targets;
  let mx = ONE;
  for (const v of T[2].values()) mx = mx.gt(v) ? mx : v;
  st.addBonus(0x7d0, 3, mx);
  for (const [type, k] of [[0x7d1, 3], [0x7d2, 1], [0x7d3, 4], [0x7d4, 5]]) {
    let mn = ONE;
    for (const v of T[k].values()) mn = mn.lt(v) ? mn : v;
    st.addBonus(type, 3, mn);
  }
}

/**
 * AddSingularityEnhances @3b0b2e8 (this, GameData): Total{Weapon,Research,Brick,DivineBeast}EnhancedCount > 0 ->
 * AddBonus(0x1e/2/1/0x174, 3, Expression.SingularityEnhanceTotal*Bonus(n)) plus a loop over g.singularityEnhanced (+0x15e8).
 * Counts/set are filled only by GameData.SingularityEnhance @3c2a9f8 / CompleteAllSingularityEnhances, which the NW sim never calls
 * (Init @3c352d4 -> InitSingularity @3c2f1e0 creates empty collections). IsSingularityEnhanced @3ba00b4 (sim, BoardSize) is a pure read => false.
 * NW: no-op. Not ported.
 */
export function addSingularityEnhances(st, m, g) {
  if (g.singularityEnhanced.size) throw new Error('AddSingularityEnhances not ported');
}

/**
 * AddSingularDimension @3b0c57c (this, GameData): loops g.SingularityDepths (iface 0x293, +0x15d8) emitting AddBonus 0x190..0x193 etc.
 * Dictionary stays empty in NW (InitSingularity @3c2f1e0; SingularityDepthUpgrade never called by sim) => no-op. Not ported.
 */
export function addSingularDimension(st, m, g) {
  if (g.singularityDepths?.size) throw new Error('AddSingularDimension not ported');
}
