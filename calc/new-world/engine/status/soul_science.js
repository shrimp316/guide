// U2 helper group "soul / science": UpgradeStatus.AddSoulAltars @3b02038, AddSoulUpgrades @3b0284c, AddSciencePointProductions
// @3b06c80, AddDevilOrder @3b078c4 (+AddDevilOrderCorruption @3b08980), AddWarAILearning @3b08fb0, AddGoldenPower @3b09500,
// AddInnovationLab @3b09b54. NewWorld (gameMode 10) only; includeInfo paths (RecordBonus/NoteBonus/NoteTargetBonus) are dropped.
//
// `g` = GameData state (U3 field names, see econ_gold/econ_science/econ_soul). The C# reads GameData through the interface
// IReadOnlyGameData; slot -> getter names were resolved from global-metadata.dat (IReadOnlyGameData type #650).
// Dictionary<int,struct{Id,Level}>-style GameData collections are JS Maps id -> level (order = insertion order = C# Dictionary order).
import { BigNumber } from '../bignum.js';
import { getDataIdType } from '../master.js';

const { ZERO, ONE } = BigNumber;

const safe = (arr, i) => (i >= 0 && arr && i < arr.length ? arr[i] : 0);   // M.SafeGet*List
const isNewWorldBlock = (id) => id >= 2900 && id < 3000;                    // @3a4fc74: (id - 0xb54) < 0x64 (unsigned)
const sum = (it) => { let s = 0; for (const v of it) s += v; return s; };

// ---- AddSoulAltars @3b02038 ------------------------------------------------------------------------------------------------
// reads g.soulAltarLevel (+0x162c, get_SoulAltarLevel slot 0x2a7) int; g.warAIUpgrade Map id->level (+0x1568, slot 0x27f);
// st.targets[6] (UpgradeStatus+0x80 [6], Dictionary<int,BN>, never written in the NW AddXxx set -> normally empty).
// master: SoulAltar (Level, TypeList/ValueType/ValueList, NewWorldSoulAltar flag, NewWorldTypeList/NewWorldValueType/NewWorldValueList),
//         WarAI (Id, Bonus).
// for level 1..soulAltarLevel: row -> (NW lists when gameMode==10 && row.NewWorldSoulAltar) for each effect j:
//   v = BN(value[j]); WarAI upgrade key 1000+level with level>=1 and WarAI row 1000+level: v *= (d*0.01 + 1) with d = Bonus*level;
//   targets[6][1000+level] present: v *= that; AddBonus(type[j], valueType, v).
export function addSoulAltars(st, m, g) {
  const nwMode = st.gameMode === 10;
  for (let i = 1; i <= g.soulAltarLevel; i++) {
    const row = m.tryGetSoulAltar(i);
    if (!row) continue;
    const nw = nwMode && !!row.NewWorldSoulAltar;
    const types = (nw ? row.NewWorldTypeList : row.TypeList) ?? [];
    const vt = (nw ? row.NewWorldValueType : row.ValueType) ?? 0;
    const values = nw ? row.NewWorldValueList : row.ValueList;
    for (let j = 0; j < types.length; j++) {
      let v = BigNumber.of(safe(values, j));
      const lv = g.warAIUpgrade.get(i + 1000);
      if (lv !== undefined && lv >= 1) {
        const wr = m.tryGet('WarAI', i + 1000);
        if (wr) v = v.mul((wr.Bonus ?? 0) * lv * 0.01 + 1.0);   // fmul d8,d8,lv ; fmul d0,d8,0.01 ; fadd 1.0
      }
      const t6 = st.targets[6].get(i + 1000);
      if (t6 !== undefined) v = v.mul(t6);
      st.addBonus(types[j], vt, v);
    }
  }
}

// ---- AddSoulUpgrades @3b0284c ----------------------------------------------------------------------------------------------
// reads g.weapons Map (+0x458; iterated by Values -> struct.Id, i.e. keys in insertion order), g.soulUpgrade Map id->{a,b} (+0x1638,
// GetSoulUpgradeData slot 0x2ab), g.soulEnhance Map id->{a,b} (+0x1640, GetSoulEnhanceData slot 0x2ac); missing id -> {a:0,b:0}.
// master: SoulMenuSetting {DmgBonus int, DmgBonusMultiplier double, EnhanceCostDown int, EnhanceCostDownMultiplier double},
//         Weapon (Id, IsDefault, UnlockIndex, IsLastSoulUpgrade).
// per weapon id: U = upgrade data, E = enhance data, row = Weapon[id] (isLast = row.IsLastSoulUpgrade):
//   U.a >= 1: v = BN(U.a) * DmgBonus * DmgBonusMultiplier^E.a ; target kind 0 (weapon dmg) *= v.toMultiplier()
//   U.b >  0: c = BN(U.b + 1.0) * EnhanceCostDown * EnhanceCostDownMultiplier^E.b ; target kind 1 (enhance cost down) *= One / c
//   if isLast: the same factor is also applied to every later (UnlockIndex > row.UnlockIndex) non-default weapon.
export function addSoulUpgrades(st, m, g) {
  const s = m.setting('SoulMenuSetting');
  const dat = (map, id) => map.get(id) ?? { a: 0, b: 0 };
  for (const id of g.weapons.keys()) {
    const U = dat(g.soulUpgrade, id), E = dat(g.soulEnhance, id);
    const row = m.tryGetWeapon(id);
    const isLast = row ? !!row.IsLastSoulUpgrade : false;
    const spread = (kind, bonus) => {
      st.multiplyTargetBonus(kind, id, bonus);
      if (!isLast) return;
      for (const w of m.findAll('Weapon'))
        if ((w.UnlockIndex ?? 0) > (row.UnlockIndex ?? 0) && !w.IsDefault) st.multiplyTargetBonus(kind, w.Id, bonus);
    };
    if (U.a >= 1) {
      let v = BigNumber.of(U.a).mul(s.DmgBonus);
      v = v.mul(Math.pow(s.DmgBonusMultiplier, E.a));
      spread(0, v.toMultiplier());
    }
    if (U.b > 0) {
      let c = BigNumber.of(U.b + 1.0).mul(s.EnhanceCostDown);
      c = c.mul(Math.pow(s.EnhanceCostDownMultiplier, E.b));
      spread(1, ONE.div(c));
    }
  }
}

// ---- AddSciencePointProductions @3b06c80 -----------------------------------------------------------------------------------
// reads g.labLevel (+0x1488, slot 0x263), g.devilProdLevel (+0x148c, 0x264), g.warAIProdLevel (+0x1490, 0x265), g.cubeProdLevel
// (+0x1494, 0x266) ints; master ScienceSetting {PointUpgrade, PointUpgradeDevilOrder, PointUpgradeWarAI, PointUpgradeGoldenCube}.
// each level >= 1: AddBonus(0x140 /*SciencePoint*/, multiply, BN(pow(PointUpgradeX, level))), in the order lab, devil, warAI, cube.
export function addSciencePointProductions(st, m, g) {
  const s = m.setting('ScienceSetting');
  for (const [level, key] of [[g.labLevel, 'PointUpgrade'], [g.devilProdLevel, 'PointUpgradeDevilOrder'],
    [g.warAIProdLevel, 'PointUpgradeWarAI'], [g.cubeProdLevel, 'PointUpgradeGoldenCube']])
    if (level >= 1) st.addBonus(0x140, 3, BigNumber.of(Math.pow(s[key], level)));
}

// ---- DevilOrder helpers (Expression) ---------------------------------------------------------------------------------------
// DevilOrderRankBonus @414adf0: BN(pow(DevilOrderSetting.RankBonus, max(rank,0)))
const devilOrderRankBonus = (m, rank) => BigNumber.of(Math.pow(m.setting('DevilOrderSetting').RankBonus, Math.max(rank, 0)));
// DevilOrderBrickUpgradeBonus @414b078: Reciprocal(RankBonus(rank) * BN(pow(BrickUpgradeValue, level)))
const devilOrderBrickUpgradeBonus = (m, rank, level) =>
  devilOrderRankBonus(m, rank).mul(BigNumber.of(Math.pow(m.setting('DevilOrderSetting').BrickUpgradeValue, level))).reciprocal();
// DevilOrderRankUpgradeBonus @414aefc: RankBonus(rank) * BN(pow(RankUpgradeValue, level))
const devilOrderRankUpgradeBonus = (m, rank, level) =>
  devilOrderRankBonus(m, rank).mul(BigNumber.of(Math.pow(m.setting('DevilOrderSetting').RankUpgradeValue, level)));
// DevilOrderBrickUpgradeLevel @4139074: sum of GetDevilOrderUpgradeData(k).level for k = start..id; start = 2900 (0xb54) for NW blocks
// (the non-NW start is a static int never reached: every IsNewWorld DevilOrder brick row id is in 2901..2950).
const devilOrderBrickUpgradeLevel = (g, id) => { let s = 0; for (let k = 2900; k <= id; k++) s += g.devilUpgrade.get(k) ?? 0; return s; };
// DevilOrderNewWorldRankUpgradeLevel @4138f88: sum of level of ids 90001..90000+n
const devilOrderNewWorldRankUpgradeLevel = (g, n) => { let s = 0; for (let k = 1; k <= n; k++) s += g.devilUpgrade.get(90000 + k) ?? 0; return s; };

// ---- AddDevilOrder @3b078c4 ------------------------------------------------------------------------------------------------
// reads g.devilRankSci (+0x14c4) + g.devilRankSoul (+0x14c8) (= get_DevilOrderRank slot 0x26d, @3b953ac), g.devilUpgrade Map id->level
// (+0x14f0, GetDevilOrderUpgradeData slot 0x274); master DevilOrder list (sheet order), DevilOrderSetting, Block list.
// rows with row.IsNewWorld != (gameMode==10) are skipped. id type (Id/1000): 2 = brick, 90 = NW rank (Corruption), others (0 rank,
// 9 divine beast) only exist for non-NW rows -> not reachable in mode 10 and not ported.
//  type 2: bonus = BrickUpgradeBonus(rank, BrickUpgradeLevel(id)); if bonus < One: target kind 3 (block hp) *= bonus; if row.IncludeAllUpper
//          the same for every later Block (Id > row.Id, !IsSpecial, IsNewWorldBlock == (mode==10)).
export function addDevilOrder(st, m, g) {
  const nw = st.gameMode === 10;
  const rank = g.devilRankSci + g.devilRankSoul;
  for (const row of m.findAll('DevilOrder')) {
    if (nw !== !!row.IsNewWorld) continue;
    const t = getDataIdType(row.Id);
    if (t === 90) { addDevilOrderCorruption(st, m, g, row, row.Id % 1000, true); continue; }
    if (t !== 2) continue;
    const bonus = devilOrderBrickUpgradeBonus(m, rank, devilOrderBrickUpgradeLevel(g, row.Id));
    if (!bonus.lt(ONE)) continue;
    st.multiplyTargetBonus(3, row.Id, bonus);
    if (!row.IncludeAllUpper) continue;
    for (const b of m.findAll('Block'))
      if (b.Id > row.Id && !b.IsSpecial && isNewWorldBlock(b.Id) === nw) st.multiplyTargetBonus(3, b.Id, bonus);
  }
}

// ---- AddDevilOrderCorruption @3b08980 (this, g, row, rankIdx, isNewWorld) ---------------------------------------------------
// Reachable in NW (row type 90, rankIdx = Id%1000 = 1..20, isNewWorld=true). reads g.rank (+0x1400, get_Rank slot 0x24e), g.devilRank*,
// g.devilUpgrade. Applies only if g.rank == rankIdx, or row.IncludeAllUpper && g.rank > rankIdx:
//   bonus = RankUpgradeBonus(devilRank, NewWorldRankUpgradeLevel(rankIdx)); if bonus > One: AddBonus(2, multiply, bonus).
// (the non-NW branch, isNewWorld=false -> DevilOrderRankUpgradeLevel @4138e4c, is not ported.)
export function addDevilOrderCorruption(st, m, g, row, rankIdx, isNw) {
  if (!(g.rank === rankIdx || (row.IncludeAllUpper && g.rank > rankIdx))) return;
  const bonus = devilOrderRankUpgradeBonus(m, g.devilRankSci + g.devilRankSoul, devilOrderNewWorldRankUpgradeLevel(g, rankIdx));
  if (bonus.le(ONE)) return;
  st.addBonus(2, 3, bonus);
}

// ---- AddWarAILearning @3b08fb0 ---------------------------------------------------------------------------------------------
// reads g.warAILearningBonus Map<int id, BigNumber> (+0x1560, slot 0x27e; enumerated as KeyValuePair<int,BigNumber>);
// master WarAILearning (UpgradeType). No mode gate. Each entry: AddBonus(row.UpgradeType, percent(2), value).
export function addWarAILearning(st, m, g) {
  for (const [id, v] of g.warAILearningBonus) {
    const row = m.tryGet('WarAILearning', id);
    if (row) st.addBonus(row.UpgradeType ?? 0, 2, v);
  }
}

// ---- AddGoldenPower @3b09500 -----------------------------------------------------------------------------------------------
// GoldenCubeGoldenPowerBonus @414be60 (id, rank, level): level <= 0 or no GoldenCubePower row -> Zero, else
//   BN(pow(row.Pow, level)) * (BN(pow(GoldenCubeSetting.RankBonus, max(rank,0))) * row.Multiplier)      [GoldenCubeRankBonus @414bd54]
const goldenCubeGoldenPowerBonus = (m, id, rank, level) => {
  if (level <= 0) return ZERO;
  const row = m.tryGet('GoldenCubePower', id);
  if (!row) return ZERO;
  const p = BigNumber.of(Math.pow(row.Pow ?? 0, level));
  const rb = BigNumber.of(Math.pow(m.setting('GoldenCubeSetting').RankBonus, Math.max(rank, 0)));
  return p.mul(rb.mul(row.Multiplier ?? 0));
};
// reads g.goldenPowerLevel Map id->level (+0x15b0, slot 0x28c; enumerated as KeyValuePair<int,int>), g.cubeRankSci (+0x1570) +
// g.cubeRankGold (+0x1574) (= get_GoldenCubeRank slot 0x284). master GoldenCubePower (UpgradeType, ValueType, Pow, Multiplier).
// For each entry with level > 0 and a GoldenCubePower row: AddBonus(row.UpgradeType, row.ValueType, bonus). No mode gate.
export function addGoldenPower(st, m, g) {
  const rank = g.cubeRankSci + g.cubeRankGold;
  for (const [id, level] of g.goldenPowerLevel) {
    if (level <= 0) continue;
    const row = m.tryGet('GoldenCubePower', id);
    if (!row) continue;
    st.addBonus(row.UpgradeType ?? 0, row.ValueType ?? 0, goldenCubeGoldenPowerBonus(m, id, rank, level));
  }
}

// ---- GameData.GetUpgradeReferValue @3b943f0 (this=g, type, status) -> int  (IReadOnlyGameData slot 0x99) ---------------------------
// 44-way switch (jump table @15e90fc). Only the cases used by Innovation NW/normal refer types (1-7, 21-26, 38) are ported, plus the
// binary's default (9, 12-19 -> 1). All results are clamped to >= 1 ("cmp w,#1; csinc w0,w,wzr,gt").
// g fields: researchTier(+0x13fc) research Map id->level(+0x1440) weaponUnlockIndexAch(+0x448) weapons Map id->level(+0x458)
//   unlockedFields(+0x13d4) cards Map id->{Level}(+0x460, get_Cards slot 0x9f; CardData.Level = 2nd int) soulUpgrade/soulEnhance Map
//   id->{a,b} rank(+0x1400) devilRankSci/Soul warAIRankSci/Power(+0x1514/+0x1518) innovationLevels Map(+0x14a0)
//   cubeRankSci/Gold scienceRank(+0x1460).
function getUpgradeReferValue(st, g, type) {
  let v;
  switch (type) {
    case 1: v = g.researchTier; break;
    case 2: v = sum(g.research.values()); break;                                         // sum of research levels
    case 3: v = g.weaponUnlockIndexAch + 1; break;
    case 4: { v = 0; for (const lv of g.weapons.values()) if (lv >= 2) v += lv - 1; break; }  // sum of (weapon level - 1) for level >= 2
    case 5: v = g.unlockedFields; break;
    case 6: { v = 0; for (const c of g.cards.values()) v += c.Level; break; }            // total card levels
    case 7: { v = 0; for (const d of g.soulUpgrade.values()) v += d.a + d.b; break; }
    case 21: v = g.devilRankSci + g.devilRankSoul; break;
    case 22: v = g.rank; break;
    case 23: v = g.warAIRankSci + g.warAIRankPower; break;
    case 24: v = sum(g.innovationLevels.values()); break;
    case 25: { v = 0; for (const d of g.soulEnhance.values()) v += d.a + d.b; break; }
    case 26: v = g.cubeRankSci + g.cubeRankGold; break;
    case 38: v = g.scienceRank + st.getInt(0x141, 0); break;                             // status non-null (null would give rank-1000)
    case 9: case 12: case 13: case 14: case 15: case 16: case 17: case 18: case 19: return 1;
    default: throw new Error(`GetUpgradeReferValue type ${type} not ported`);
  }
  return v > 1 ? v : 1;
}

// ---- Innovation helpers (Expression) ---------------------------------------------------------------------------------------
// Extensions.GetValue(MasterInnovation, level) @415ccb0: BN(InnovationSetting.ValueUp).Pow(level) (row unused)
const innovationValue = (m, level) => BigNumber.of(m.setting('InnovationSetting').ValueUp).pow(level);
// InnovationWeaponUpgradeBonus @414a59c / InnovationBrickUpgradeBonus @414a778 (level, count):
//   v = BN(UpgradeBonus*level); if count >= 1: v *= (X*count*0.01 + 1.0) (X = WeaponUpgradeBonus / BrickUpgradeBonus); return ToMultiplier(v)
const innovationUpgradeBonus = (m, key, level, count) => {
  const s = m.setting('InnovationSetting');
  let v = BigNumber.of(s.UpgradeBonus * level);
  if (count >= 1) v = v.mul(s[key] * count * 0.01 + 1.0);
  return v.toMultiplier();
};

// ---- AddInnovationLab @3b09b54 ---------------------------------------------------------------------------------------------
// reads g.innovationLevels Map id->level (+0x14a0, get_InnovationUpgrades slot 0x269; enumerated by Values = {Id, Level}),
// g.innovationWeaponSum (+0x1498, slot 0x267) and g.innovationBrickSum (+0x149c, slot 0x268) ints, g.cubeUpgrade Map id->level (+0x15b8,
// get_GoldenCubeUpgrades slot 0x28d), + everything getUpgradeReferValue reads. master: Innovation (TypeList, ValueType, ReferType,
// ReferMultiplier, NewWorldRefer, NewWorldReferType, NewWorldReferMultiplier, IncludeAllUpper), GoldenCube (Bonus), InnovationSetting,
// Weapon list, Block list. No mode gate except where noted. Per entry (id, level), by Id/1000:
//  11 (lab item): row; for each effect j: referType/mult = NewWorld* when gameMode==10 && row.NewWorldRefer else Refer*;
//      d = level < 1 ? 1 : mult * GetUpgradeReferValue(referType); d = max(d, 1);
//      v = ValueUp^level * d; if GoldenCubeUpgrades[id] > 0 and GoldenCube row: v *= pow(row.Bonus, goldenLevel);
//      AddBonus(TypeList[j], ValueType, v)
//  5 (weapon): bonus = InnovationWeaponUpgradeBonus(level, weaponSum); target kind 0 (weapon dmg) *= bonus; IncludeAllUpper -> later
//      non-default weapons (Id > row.Id) too.
//  2 (brick): only if IsNewWorldBlock(id) == (gameMode==10): bonus = InnovationBrickUpgradeBonus(level, brickSum); target kind 2 (block
//      gold) *= bonus; IncludeAllUpper -> later blocks (Id > row.Id, !IsSpecial, same NW-ness).
export function addInnovationLab(st, m, g) {
  const nwMode = st.gameMode === 10;
  for (const [id, level] of g.innovationLevels) {
    const t = getDataIdType(id);
    if (t === 11) {
      const row = m.tryGet('Innovation', id);
      if (!row) continue;
      const types = row.TypeList ?? [];
      for (let j = 0; j < types.length; j++) {
        const nw = nwMode && !!row.NewWorldRefer;
        const referType = (nw ? row.NewWorldReferType : row.ReferType) ?? 0;
        const mult = (nw ? row.NewWorldReferMultiplier : row.ReferMultiplier) ?? 0;
        let d = level < 1 ? 1.0 : mult * getUpgradeReferValue(st, g, referType);
        d = Math.max(d, 1.0);
        let v = innovationValue(m, level).mul(d);
        const gl = g.cubeUpgrade.get(row.Id);
        if (gl !== undefined && gl > 0) {
          const gc = m.tryGet('GoldenCube', row.Id);
          if (gc) v = v.mul(Math.pow(gc.Bonus ?? 0, gl));
        }
        st.addBonus(types[j], row.ValueType ?? 0, v);
      }
    } else if (t === 5) {
      const bonus = innovationUpgradeBonus(m, 'WeaponUpgradeBonus', level, g.innovationWeaponSum);
      st.multiplyTargetBonus(0, id, bonus);
      const row = m.tryGet('Innovation', id);
      if (!row || !row.IncludeAllUpper) continue;
      for (const w of m.findAll('Weapon'))
        if (w.Id > row.Id && !w.IsDefault) st.multiplyTargetBonus(0, w.Id, bonus);
    } else if (t === 2) {
      const isNw = isNewWorldBlock(id);
      if (isNw !== nwMode) continue;
      const bonus = innovationUpgradeBonus(m, 'BrickUpgradeBonus', level, g.innovationBrickSum);
      st.multiplyTargetBonus(2, id, bonus);
      const row = m.tryGet('Innovation', id);
      if (!row || !row.IncludeAllUpper) continue;
      for (const b of m.findAll('Block'))
        if (b.Id > row.Id && !b.IsSpecial && isNewWorldBlock(b.Id) === isNw) st.multiplyTargetBonus(2, b.Id, bonus);
    }
  }
}
