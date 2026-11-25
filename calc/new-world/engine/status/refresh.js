// UpgradeStatus.Refresh @3b149f4 -> RefreshShared @3b14b44 -> RefreshTemporary part (NewWorld configuration).
// Step order = the disassembled call order. Steps that are no-ops in NW are listed as comments (see U2_NOTES.md for the proof).
import { BigNumber } from '../bignum.js';
import { worldTreeEfficiency } from '../world_batch.js';
import * as D from './defaults_ranks.js';
import * as C from './cards_stone.js';
import * as S from './soul_science.js';
import * as A from './arc_pioneers.js';
import { refreshSpecial3WeaponCount } from './weapon_bonus.js';

const { ONE } = BigNumber;

/**
 * Refresh(this) @3b149f4. st = UpgradeStatus, m = Master, g = GameData state, u = UserData-like ({states: Map, newWorldPassEnabled}).
 * The golden-card source status (st.goldenSource, +0x90) is a second UpgradeStatus (+0x98 = true: golden cards skipped) refreshed first
 * when HasGoldenCardSourceConversions; its values are the bases of the 950..955 conversions applied at the very end.
 */
export function refresh(st, m, g, u) {
  st.hasGoldenSourceConversions = false;
  if (!st.isGoldenSource) {
    st.hasGoldenSourceConversions = C.hasGoldenCardSourceConversions(st, m, g);
    if (st.hasGoldenSourceConversions) refresh(st.getGoldenCardSource(), m, g, u);
  }
  refreshShared(st, m, g, u);
  refreshTemporary(st, m, g);
}

/** RefreshShared @3b14b44 */
function refreshShared(st, m, g, u) {
  st.upgrades.clear();                                  // @3b14c04
  for (const t of st.targets) t.clear();                // @3b14c30
  D.addDefaults(st, m);
  // AddTruthUpgrades, AddDimensionTechs, AddAshForge, AddCosmicLabExecutionUpgrades: no-ops in NW (see notes)
  D.addSingularityEnhances(st, m, g);
  D.addCommonUpgrades(st);                              // PrismPass / Common / Epic: contentTypes bit 6 clear in NW
  C.addMemberships(st, m, u);
  // AddDivineBeasts, AddChallengeWall, AddChallengeDive: no-ops in NW
  D.addRanks(st, m, g);
  D.addResearches(st, m, g);
  C.addWorldStoneCardBonuses(st, m, g);
  C.addCards(st, m, g);
  D.addPrestigeBonusPoint(st, g);
  S.addSoulAltars(st, m, g);
  S.addSoulUpgrades(st, m, g);
  S.addSciencePointProductions(st, m, g);
  S.addDevilOrder(st, m, g);
  S.addWarAILearning(st, m, g);
  S.addGoldenPower(st, m, g);
  // AddTruthGarden .. AddRagnarok: no-ops in NW
  D.addSingularDimension(st, m, g);
  D.addRankProductions(st, m, g);
  C.addModeContents(st, m, g);
  A.addArc(st, m, g, u);
  A.addPioneers(st, m, g, u);
  S.addInnovationLab(st, m, g);
  C.addNewWorldThemeBonuses(st, m, g);
  C.addNewWorldPass(st, m, u);
}

/** RefreshTemporary part of Refresh @3b14e6c (AddTemporaryBuffs .. AddWorldTreeCardConversion) */
function refreshTemporary(st, m, g) {
  D.addTemporaryBuffs(st);
  D.addReferenceValues(st);
  refreshSpecial3WeaponCount(st, g);                    // interface call at @3b150a4
  A.completePioneersEffects(st, m, g);
  if (st.hasGoldenSourceConversions) C.addGoldenCardSourceConversions(st);
  C.addWorldTreeCardConversion(st, m, g, worldTreeEfficiency);
}

/** The sim's RefreshStatus @416547c: Refresh, then (unless the game already applied it) the nw_pass stats are injected when the pass is owned. */
export function simRefreshStatus(st, m, g, u, { nwPass = true } = {}) {
  refresh(st, m, g, u);
  if (nwPass) C.injectNewWorldPass(st, m);
}

/** Default values for the GameData fields U2 reads that no other unit owns (all zero/empty in the NW sim, as in the game). */
export function initStatusState(g) {
  g.rankSpecialBonuses ??= [];        // +0x1430 List<{rank,type,valueType,value}> (get_RankSpecialBonuses, slot 0x255)
  g.quantumRank ??= 0;                // +0xdc8
  g.prestigeBonusPoint ??= 0;         // +0x668
  g.singularityEnhanced ??= new Set();// +0x15e8
  g.singularityDepths ??= new Map();  // +0x15d8
  g.special3WeaponCount ??= 0;        // +0x450
  g.warAIUpgrade ??= new Map();       // +0x1568
  g.cubeUpgrade ??= new Map();        // +0x15b8
  g.storedResearchBonuses ??= [];     // +0x13b0
  return g;
}
