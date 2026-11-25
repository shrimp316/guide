// U5-A: Pioneers state schema (mirrors C# PioneersStateData / TileData / JobData / CartData / StockData / HasteData / RouteData).
// Property names == C# getter names (PascalCase). Collections = JS arrays. BigNumber props = BigNumber. Timestamps = ms Number.
// Offsets (hex) in comments come from the getters in libil2cpp (work/method_classes.tsv).
//
// GameData ("g") fields the Pioneers engine needs:
//   g.Pioneers (PioneersStateData | null)  [GameData+0x1200]    g.PioneersIngots / g.PioneersManaStone (BigNumber) [+0x1208/+0x1218]
//   g.m (U1 Master)   g.status (U2 UpgradeStatus)   resource balance interface: owned by u5-B (pioneers_econ.js).
// Enum values: see the E_* objects below (finalised from EnsurePioneers/GameData disasm; see U5_A_NOTES.md).
import { BigNumber } from './bignum.js';

export const ZERO = BigNumber.ZERO, ONE = BigNumber.ONE;

export function makeStateData() {          // .ctor @3c565c0
  return {
    Number: 0,            // +0x10 event number
    Seed: 0,              // +0x14
    Difficulty: 0,        // +0x18
    Size: 0,              // +0x1c grid side length
    StartCell: 0,         // +0x20
    StartAt: 0,           // +0x28 Timestamp (ms)
    EndAt: 0,             // +0x30
    Timestamp: 0,         // +0x38 last processed time
    ContentSeconds: 0,    // +0x40 double
    Format: 1,            // +0x48 int, ctor sets 1 (no getter)
    Tiles: [],            // +0x50 List<PioneersTileData>, index == Cell
    Jobs: [],             // +0x58 List<PioneersJobData>
    Carts: [],            // +0x60 List<PioneersCartData>
    WeatherSchedule: [],  // +0x68 List<int> weather ids per slot
    X70: new Map(),       // +0x70 Dictionary<int,int> (meaning TBD)
    ConversionLevels: new Map(), // +0x78 Dictionary<int,int> conversionId -> level   (GetPioneersConversionLevel @3bf82ac)
    ResearchLevels: new Map(),   // +0x80 Dictionary<int,int> researchId -> level     (GetPioneersResearchLevel @3bf831c)
    Points: new Map(),    // +0x88 Dictionary<int,BigNumber> milestone type -> points (GetPioneersPoints @3bf838c)
    Progress: null,       // +0x90 PioneersProgressData (owned by u5-C; null until BeginPioneersProgress)
    Revision: 0,          // +0x98
    BonusRevision: 0,     // +0x9c
  };
}

export function makeTileData() {           // .ctor @3c56abc
  return {
    Cell: 0, X: 0, Y: 0,        // +0x10/+0x14/+0x18
    Terrain: 0,                 // +0x1c  E_TERRAIN
    OreId: 0,                   // +0x20  PioneersConversion id (92001..92005) or -1 mana / 0 none (see notes)
    Revealed: false,            // +0x24
    ForestType: 0,              // +0x28
    BuildingId: 0,              // +0x2c  93001 extractor, 93002 shrine, 93003 road(?), 93004 magic circle
    Level: 0,                   // +0x30
    RoadLevel: 0,               // +0x34
    MagicLevel: 0,              // +0x38
    JobId: 0,                   // +0x3c
    Stock: ZERO,                // +0x40 BigNumber
    BurnRemaining: 0,           // +0x50 double
    RouteTarget: -1,            // +0x60
    Waypoints: [],              // +0x68 List<int>
    UpgradeLevels: new Map(),   // +0x70 Dictionary<int,int> upgradeId -> level
    Packets: [],                // +0x78 List<packet> (u5-C)
    LastBurnRewards: [],        // +0x80 List
    LastBurnSequence: 0,        // +0x88
    LastBurnAmount: ZERO,       // +0x90 BigNumber
    BurnDuration: 0,            // +0x58 double (u5-B/C: duration of the running burn)
    RouteVersion: 0,            // +0x64 int (u5-C: ++ when the route target changes)
  };
}

export const makeStockData = () => ({ OwnerCell: 0, OreId: 0, Amount: ZERO, Multiplier: ZERO });       // +0x10,+0x14,+0x18,+0x28 (no ctor defaults)
export const makeJobData = () => ({
  Id: 0, Cell: 0, Action: 0, TargetLevel: 0,            // +0x10,+0x14,+0x18,+0x20
  Count: 0,                                             // +0x1c (u5-B)
  IngotPaid: ZERO, ManaStonePaid: ZERO,                 // +0x28,+0x38
  DurationSeconds: 0, RemainingSeconds: 0, Active: false, // +0x48,+0x50,+0x58 (Progress is derived)
});
export const makeHasteData = () => ({ Zone: 0, Multiplier: 0, RemainingSeconds: 0 });   // +0x10,+0x18,+0x20

export function makeCartData() {           // .ctor @3c56f00
  return {
    Id: 0, OwnerCell: 0, TargetCell: 0, Phase: 0, LegIndex: 0,   // +0x10..+0x20
    PhaseRemaining: 0, PhaseDuration: 0,                          // +0x38,+0x40
    LegProgress: 0, Ground: 0, ArrivedAt: 0, Unloaded: false, RouteVersion: -1, HasMultiplier: false, // +0x28,+0x30,+0x48,+0x50,+0x54,+0x78 (u5-B/C)
    RawLoad: ZERO,                                                // +0x58
    Multiplier: ONE,                                              // +0x68 (ctor: BigNumber.One)
    OutboundPath: [], ReturnPath: [], X90: [], HasteEffects: [],  // +0x80,+0x88,+0x90 (List<int>),+0x98 (List<haste>)
    X: 0, Y: 0,                                                   // +0xa0,+0xa8
    HasteRemaining: 0, HasteMultiplier: 1,                        // +0xb0,+0xb8 (ctor: 1.0)
  };
}

export function makeRouteData() {          // .ctor @3c5710c
  return {
    Result: 0,                      // +0x10  Allowed == (Result==0)
    get Allowed() { return this.Result === 0; },
    Outbound: [], Return: [], MagicCells: [],   // +0x18,+0x20,+0x28
    Multiplier: ONE,                // +0x30 (ctor: One)
    OutboundSeconds: 0, ReturnSeconds: 0, CycleSeconds: 0,   // +0x40,+0x48,+0x50
    InitialOutboundSeconds: 0, InitialReturnSeconds: 0,      // +0x58,+0x60
  };
}

// Enums (provisional; finalised in U5_A_NOTES.md)
// Terrain (EnsurePioneers @3bf6460, Walkable @419eebc, Zones @419f11c). Forest tiles are cleared by a type-6 job (Terrain -> 0).
export const E_TERRAIN = { GRASS: 0, ORE: 1, FOREST: 2, MAGIC: 3 };
// Facility ids (BuildingId). Ore ids: OreId = PioneersConversion.Id (92001..92005), -1 = mana ore.
export const E_FACILITY = { EXTRACTOR: 93001, SHRINE: 93002, ROAD: 93003, MAGIC_CIRCLE: 93004 };
// Job.Action / Cart.Phase numeric values are defined by u5-B (jobs: sim job types 1..14, see E_pioneers.md 1.5) and u5-C (phases).

// PioneersJobData.Progress (getter @3c56d30)
export const jobProgress = (j) => j.DurationSeconds > 0 ? Math.max(0, Math.min(1, 1 - j.RemainingSeconds / j.DurationSeconds)) : 0;
