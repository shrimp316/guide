// U2 — memberships / NW pass / cards / world stone / theme bonuses / golden-card conversions (UpgradeStatus.Add*).
// All ported from disassembly (decompile of these is mangled). NW configuration: gameMode 10, contentTypes 0x1b0.
//
// State contract (g = shared GameData state of U3/U4, u = UserData-like):
//   g.cards          Map<id,{Id,Level,Count}>   GameData cards dict (U4 world_cards.js)
//   g.themeId        int                        NW theme (GameData iface slot 0x95 -> struct +0xc), 90001 fire / 90002 ice / 90003 magic
//   g.researchTier   int                        GameData iface slot 0x24d (used by research-tier cards 582/583)
//   g.cubeUpgrade    Map<id,level>              GoldenCube upgrade levels (U3), GameData iface slot 0x28d
//   g.stone.menu     WorldStoneMenuData         GameData iface slot 0x2b8 (U4 world_stone.js `getWorldStoneMenu`)
//   g.storedResearchBonuses [{type,vt,value}]   GameData iface slot 0x23f (U3, ice theme)
//   g.worldTreeEfficiency?  fn(g)->BigNumber    GameData iface slot 0x235 (= U4 batch.worldTreeEfficiency) -- passed as dep
//   u.states         Map<membershipId,int>      UserData.GetStateValue (owned memberships = state >= 1)
//   u.newWorldPassEnabled bool                  UserData.IsNewWorldPassEnabled @3b1cfc0 (real clock + pass event; sim: false)
import { BigNumber } from '../bignum.js';
import { combine } from './combine.js';

const { ZERO, ONE } = BigNumber;

/** UserState static[0] @856c4e0: the ids AddMemberships accepts when contentTypes bit 6 is clear (NW). Same list the sim's Setup SetState()s. */
export const NW_MEMBERSHIP_IDS = ['ms_ads', 'ms_booster', 'ms_mission', 'ms_power', 'ms_soul', 'ms_science', 'ms_quantum'];

const statsOf = (m, id) => m.findAll('MembershipStat').filter((s) => s.Id === id);
const statBn = (s) => new BigNumber(s.Value, 0); // get_Value (double) -> BigNumber..ctor(double, 0)

/** AddMemberships @3aef9c0 (UserData). For every Membership row (sheet order): whitelist (bit 6 clear), state >= 1, then its MembershipStat rows. */
export function addMemberships(st, m, u) {
  for (const mem of m.findAll('Membership')) {
    if (!st.hasContent(6) && !NW_MEMBERSHIP_IDS.includes(mem.Id)) continue;
    if ((u.states.get(mem.Id) ?? 0) < 1) continue;
    for (const s of statsOf(m, mem.Id)) st.addBonus(s.UpgradeType, s.ValueType, statBn(s));
  }
}

/** AddNewWorldPass @3aedee4 (UserData). Sets status+0x10 = IsNewWorldPassEnabled and, if set, applies the "nw_pass" stats. */
export function addNewWorldPass(st, m, u) {
  if (st.gameMode !== 10) { st.isNewWorldPassApplied = false; return; }
  st.isNewWorldPassApplied = !!u.newWorldPassEnabled;
  if (!st.isNewWorldPassApplied) return;
  for (const s of statsOf(m, 'nw_pass')) st.addBonus(s.UpgradeType, s.ValueType, statBn(s));
}

/** UpgradeStatus.GetNewWorldPassMultiplier @3aedab4: product of the nw_pass stats of `type` (AddUpgradeValue aggregation), else One. */
export function getNewWorldPassMultiplier(m, type) {
  let cur;
  for (const s of statsOf(m, 'nw_pass')) if (s.UpgradeType === type) cur = combine(cur, s.ValueType, statBn(s));
  return cur !== undefined && cur.gt(ZERO) ? cur : ONE;
}

/** The sim's RefreshStatus @416547c tail: nw_pass stats injected directly when the game did not apply them (status+0x10 false). */
export function injectNewWorldPass(st, m) {
  if (st.isNewWorldPassApplied) return;
  for (const s of statsOf(m, 'nw_pass')) st.addBonus(s.UpgradeType, s.ValueType, statBn(s));
}

// ---- M.GetType @3a504d4 / M.GetValueType @3a505a8 (U1's master.js has getTypeCount/getValue) ----
function cardType(row, i, mode) {
  return mode === 10 && (row.NewWorldTypeList?.length ?? 0) > 0 ? row.NewWorldTypeList[i] : row.TypeList[i];
}
function cardValueType(row, mode) {
  return mode === 10 && (row.NewWorldTypeList?.length ?? 0) > 0 ? (row.NewWorldValueType ?? 0) : (row.ValueType ?? 0);
}

/**
 * AddCards @3b0041c. For each owned card (dictionary order): skip golden (Grade 90) when status is the golden source (+0x98);
 * in NW a golden card only counts if GameId == current theme. For each effect i: value = M.GetValue(card,i,level) (double -> BN),
 * x Bonus^cubeLevel (GoldenCube row with the card id, level>0), x status[0x390 grade5 / 0x391 grade6] when != One and valueType != 1,
 * and types 0x246/0x247 become (value^researchTier) divided into 0x47 / 0xc9.
 */
export function addCards(st, m, g) {
  const s390 = st.get(0x390, ONE), s391 = st.get(0x391, ONE); // world stone card multipliers (AddWorldStoneCardBonuses ran before)
  const mode = st.gameMode;
  for (const cd of g.cards.values()) {
    if (!(cd.Level > 0)) continue;                                       // CardData.IsHave @3c43d7c
    const card = m.tryGetCard(cd.Id);
    if (!card) continue;
    const grade = card.Grade ?? 0;
    if (st.isGoldenSource && grade === 90) continue;                     // +0x98
    if (mode === 10 && grade === 90 && card.GameId !== g.themeId) continue;
    const n = m.getTypeCount(card, mode);
    for (let i = 0; i < n; i++) {
      let type = cardType(card, i, mode);
      let vt = cardValueType(card, mode);
      let v = new BigNumber(m.getValue(card, i, cd.Level, mode), 0);
      const cubeLevel = g.cubeUpgrade?.get(cd.Id) ?? 0;                  // GetGoldenCubeUpgradeData(id) (+0x28d slot)
      if (cubeLevel > 0) {
        const cube = m.tryGet('GoldenCube', cd.Id);                      // Root.TryGetGoldenCube @3a2f2d0
        if (cube) v = v.mul(Math.pow(cube.Bonus, cubeLevel));
      }
      const mul = grade === 5 ? s390 : grade === 6 ? s391 : ONE;
      if (mul.ne(ONE) && vt !== 1) v = v.mul(mul);
      if ((type & ~1) === 0x246) {
        v = v.pow(g.researchTier);
        type = type === 0x246 ? 0x47 : 0xc9;
        vt = 4;
      }
      st.addBonus(type, vt, v);
    }
  }
}

// ---- world stone ----
const menuOf = (g) => g.stone?.menu ?? null;
/** IsWorldStoneApplied @3af3638 */
const isWorldStoneApplied = (st) => st.gameMode === 10 && st.hasContent(5);

/** AddWorldStoneNodes @3af37d0: nodes whose raw type is 0x390/0x391 iff `cardBonus`; effect = menu.tryGetEffect(i). */
function addWorldStoneNodes(st, menu, cardBonus) {
  menu.nodeList.forEach((node, i) => {
    if (((node.type & ~1) === 0x390) !== cardBonus) return;
    const e = menu.tryGetEffect(i);
    if (e) st.addBonus(e.type, e.valueType, e.value);
  });
}

/** AddWorldStoneCardBonuses @3af3700 -> AddWorldStoneNodes(menu, true). */
export function addWorldStoneCardBonuses(st, m, g) {
  if (!isWorldStoneApplied(st)) return;
  const menu = menuOf(g);
  if (menu) addWorldStoneNodes(st, menu, true); // game: null menu -> NRE; the sim always ensures the menu first
}

/**
 * AddModeContents @3af3bec. In NW only the world-stone part is reachable: AddWorldStone @3af4f94 (bought upgrades with level>=1:
 * Upgrade.GetValue per effect, then the non-card nodes). Its second part (bit 4: ModeScience/ModeDimension level dictionaries and
 * ModeContentScienceSetting.PointUpgradeScience^count -> 0x140) iterates GameData mode-content collections that the NW sim never fills
 * (ids 11001.. are other-mode content) -> no effect (count < 1 branch @3af45d0).
 */
export function addModeContents(st, m, g) {
  if (!isWorldStoneApplied(st)) return;
  const menu = menuOf(g);
  if (!menu) return;
  for (const u of menu.upgradeList) {
    if (u.level < 1) continue;
    u.types.forEach((t, j) => st.addBonus(t, u.valueType, u.getValue(j, u.level)));
  }
  addWorldStoneNodes(st, menu, false);
}

// ---- NW theme bonuses ----
/** GameData.IsNewWorldFinished @3c15ff4 (slot 0x23e) = byte at GameData+0x13a8 (U5: g.PioneersDisabled, U4: g.locked13a8) */
const isNewWorldFinished = (g) => !!(g.PioneersDisabled ?? g.locked13a8);
/** NewWorldFireGame.GetWeaponDamageGoldBonus @3cfcc98: Get(0x1e)^BonusParam1 */
const fireDamageGold = (st, nw) => st.get(0x1e, ONE).pow(nw.BonusParam1 ?? 0);
/** NewWorldFireGame.GetWeaponEnhanceGoldBonus @3cfcd84: Get(0x46)^BonusParam2 */
const fireEnhanceGold = (st, nw) => st.get(0x46, ONE).pow(nw.BonusParam2 ?? 0);

/**
 * AddNewWorldThemeBonuses @3b066bc (mode 10). fire (theme literal @856c708): Gold x= Get(0x1e)^P1 and Gold x= Get(0x46)^P2;
 * ice (@856c710): re-apply g.storedResearchBonuses; magic: nothing here. Skipped when IsNewWorldFinished (slot 0x23e).
 */
export function addNewWorldThemeBonuses(st, m, g) {
  if (st.gameMode !== 10 || isNewWorldFinished(g)) return;
  const nw = m.tryGetNewWorld(g.themeId);
  if (!nw) return;
  if (nw.Theme === 'nw_fire') {
    st.addBonus(1, 3, fireDamageGold(st, nw));
    st.addBonus(1, 3, fireEnhanceGold(st, nw));
  } else if (nw.Theme === 'nw_ice') {
    for (const e of g.storedResearchBonuses ?? []) st.addBonus(e.type, e.vt, e.value);
  }
}

// ---- golden-card source conversions (Refresh @3b149f4 / @3b150f4) ----
/** HasGoldenCardSourceConversions @3b01200: any owned card with an effect type in 0x3b6..0x3bb (950..955). */
export function hasGoldenCardSourceConversions(st, m, g) {
  for (const cd of g.cards.values()) {
    if (!(cd.Level > 0)) continue;
    const card = m.tryGetCard(cd.Id);
    if (!card) continue;
    const n = m.getTypeCount(card, st.gameMode);
    for (let i = 0; i < n; i++) if (((cardType(card, i, st.gameMode) - 0x3b6) >>> 0) < 6) return true;
  }
  return false;
}

/** AddCardConversion @3b0183c + @3b01c5c: v = Get(src,Zero); if v>0: base = source.Get(read,One) [reciprocal if flag: base>0 ? 1/base : One]; dst x= base^v. */
function addCardConversion(st, src, read, dst, recip) {
  const v = st.get(src, ZERO);
  if (v.le(ZERO)) return;
  let base = st.goldenSource.get(read, ONE);
  if (recip) base = base.gt(ZERO) ? base.reciprocal() : ONE;
  st.addBonus(dst, 3, base.pow(v.toDouble()));
}

/** AddGoldenCardSourceConversions @3b017a4 (the golden-card-free source status provides the base values). */
export function addGoldenCardSourceConversions(st) {
  addCardConversion(st, 0x3b6, 0x33, 1, false);   // 950 CriDmgToGold:       Gold  x= source[CriDmg 0x33]^v
  addCardConversion(st, 0x3b7, 0x46, 1, false);   // 951 WeaponEnhanceBonusToGold
  addCardConversion(st, 0x3b8, 0x1e, 1, false);   // 952 AllWeaponDmgToGold
  addCardConversion(st, 0x3b9, 0xca, 2, true);    // 953 (rank power mult) -> Power x= (1/source[0xca])^v
  addCardConversion(st, 0x3ba, 0x38e, 1, false);  // 954
  addCardConversion(st, 0x3bb, 0xc8, 0x1e, true); // 955 BlockHpDownToWeaponDmg: AllWeaponDmg x= (1/source[0xc8])^v
}

/** AddWorldTreeCardConversion @3b019cc: v = Get(0x3bc,Zero) > 0: 0x140 (science) x= (worldTreeEfficiency * Get(0x38f))^v. */
export function addWorldTreeCardConversion(st, m, g, worldTreeEfficiency) {
  const v = st.get(0x3bc, ZERO);
  if (v.le(ZERO)) return;
  const base = worldTreeEfficiency(g).mul(st.get(0x38f, ONE)); // GetWorldTreeEfficiency @3b01bd0
  st.addBonus(0x140, 3, base.pow(v.toDouble()));
}
