// UpgradeStatus: Arc + Pioneers contributions (port of libil2cpp, NewWorld mode 10, contentTypes 0x1b0).
//   AddArc @3b03ff0, AddPioneers @3b060f4, CompletePioneersEffects @3b05dcc.
//   AddPioneersEffects @3b0573c / RefreshPioneersEffects @3b05510 already live in ../pioneers_econ.js (U5-B, checked against the disassembly):
//   re-exported here. Their only difference to the binary: AddPioneersEffects returns silently when the Pioneers state is null (cbz @3b0581c).
//
// Contract with GameData (the interface calls resolve to IReadOnlyGameData methods; slot numbers from global-metadata):
//   g.arc.nodes (Map id -> {level,..}, insertion order) = get_ArcNodes (+0x10e0); world_arc.js getArcNodeBonus/getArcCircuitLevel/getArcCircuitBonus
//   g.Pioneers (PioneersStateData|null, +0x1200); pioneers_econ.getPioneersMapBonus(g,type) @3bf8464 / getPioneersPointBonus(g) @3bf8710
//   IsNewWorldFinished @3c15ff4 = byte at GameData+0x13a8: U5-B calls it g.PioneersDisabled, U4 g.locked13a8 (same field) -> either is read.
//
// What GameData must pass back:
//   - GameData.RefreshArcDeviceBonus @3bee6fc(BigNumber v): the sim passes st.arcDeviceBonus (UpgradeStatus+0x58, read inline, set_ArcDeviceBonus
//     @3b05508 has no callers: the store is inlined at the start of AddArc). world_arc.refreshArcDeviceBonus(g, st) does `v>0 ? v : One`.
//     st.arcDeviceBonus = Get(0x387 ArkDeviceBonus, One) as left by the last AddArc (ctor/empty ctor init it to One).
//   - GameData.RefreshPioneersExternalEffects @3bf91f4(IReadOnlyDictionary<int,BN> ext, 0): the sim passes st.pioneersExternalEffects (+0x50,
//     get_PioneersExternalEffects @3b054f4 also has no callers). For each type of PIONEERS_EFFECT_TYPES (920..931) the game stores
//     ext[type] (or EffectDefault(type) if absent) into GameData+0x1288 and flags a recalculation if it changed.
//   - the ctor (@3b14708 and the empty ctor @3afe424) creates +0x50 = new Dictionary and +0x58 = One (upgrade_status.js currently has null / ZERO).
import { BigNumber } from '../bignum.js';
import { getArcNodeBonus, getArcCircuitLevel, getArcCircuitBonus } from '../world_arc.js';
import { effectDefault, PIONEERS_EFFECT_TYPES, addPioneersEffects, getPioneersMapBonus, getPioneersPointBonus } from '../pioneers_econ.js';

export { addPioneersEffects, refreshPioneersEffects } from '../pioneers_econ.js';

const { ONE } = BigNumber;
const isNewWorldFinished = (g) => !!(g.PioneersDisabled ?? g.locked13a8);

/**
 * AddArc @3b03ff0 (this, GameData). NW: runs (gameMode==10, contentTypes bit 7 set).
 * st.arcDeviceBonus = Get(0x387, One) unconditionally (stp @3b0419c). Then, only if mode==10 && bit7:
 *  1. foreach (id,node) in gd.ArcNodes (dict order): level<=0 skip; Master Ark row missing skip;
 *     AddBonus(row.UpgradeType, row.ValueType, gd.GetArcNodeBonus(id, level, st.arcDeviceBonus))  [slot 0x205 = (id, level, deviceBonus)]
 *  2. foreach ArkCircuit row (sheet order): GetArcCircuitLevel(row.Id) < 1 skip;
 *     AddBonus(row.UpgradeType, row.ValueType, gd.GetArcCircuitBonus(row.Id))
 * The link-count / link-multiplier / link-upgrade interface calls in between only feed the info records (includeInfo).
 * Reads: g.arc.nodes, g.arc.links, g.arc.linkUpgrades (via world_arc.js); Master Ark, ArkCircuit.
 */
export function addArc(st, m, g, u) {
  st.arcDeviceBonus = st.get(0x387, ONE); // UpgradeType 903 ArkDeviceBonus
  if (st.gameMode !== 10 || !st.hasContent(7)) return;
  for (const [id, node] of g.arc.nodes) {
    if (node.level <= 0) continue;
    const row = m.tryGet('Ark', id);
    if (!row) continue;
    st.addBonus(row.UpgradeType ?? 0, row.ValueType ?? 0, getArcNodeBonus(g, st, id, node.level, st.arcDeviceBonus));
  }
  for (const row of m.findAll('ArkCircuit')) {
    if (getArcCircuitLevel(g, st, row.Id) < 1) continue;
    st.addBonus(row.UpgradeType ?? 0, row.ValueType ?? 0, getArcCircuitBonus(g, st, row.Id));
  }
}

/**
 * AddPioneers @3b060f4 (this, GameData). NW: runs unless IsNewWorldFinished (gameMode==10 && contentTypes bit 8 set).
 * Order of the gates: gameMode==10, !gd.IsNewWorldFinished (slot 0x23e), contentTypes bit 8 (this+0x6d bit 0).
 * gd.GetPioneersPointBonus() is called first (result only used for the info record; kept for its cache side effect).
 * foreach PioneersConversion row (sheet order): AddBonus(row.MilestoneType, 2 (percent), gd.GetPioneersMapBonus(MilestoneType) * 100.0)
 *  -> One + mapBonus; with no points GetPioneersMapBonus is Zero, so the key is still created with One.
 * Reads: g.Pioneers points through getPioneersMapBonus; Master PioneersConversion (5 rows: types 1,2,300,320,910).
 */
export function addPioneers(st, m, g, u) {
  if (st.gameMode !== 10 || isNewWorldFinished(g) || !st.hasContent(8)) return;
  getPioneersPointBonus(g);
  for (const row of m.findAll('PioneersConversion')) {
    const t = row.MilestoneType ?? 0;
    st.addBonus(t, 2, getPioneersMapBonus(g, t).mul(100.0));
  }
}

/**
 * CompletePioneersEffects @3b05dcc (this, GameData) - called by RefreshTemporary @3b14e6c after AddReferenceValues.
 * ext(+0x50).Clear(); then, if gameMode==10 && !gd.IsNewWorldFinished && contentTypes bit 8:
 *   foreach type in [920..931]: ext[type] = st.Get(type, EffectDefault(type))      (snapshot BEFORE the pioneers research/weather effects)
 *   S = gd.Pioneers; if S != null: tail-call AddPioneersEffects(st, S, S.Timestamp(+0x38), id 0, level -1, weather 0)
 *     -> adds PioneersResearch levels (S.ResearchLevels, +0x80) and the current weather bonuses into st.
 */
export function completePioneersEffects(st, m, g) {
  const ext = (st.pioneersExternalEffects ??= new Map());
  ext.clear();
  if (st.gameMode !== 10 || isNewWorldFinished(g) || !st.hasContent(8)) return;
  for (const t of PIONEERS_EFFECT_TYPES) ext.set(t, st.get(t, effectDefault(t)));
  const S = g.Pioneers;
  if (S) addPioneersEffects(g, st, S, S.Timestamp, 0, -1, 0);
}
