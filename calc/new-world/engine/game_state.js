// Shared GameData/UserData state for the economy core (U3). Plain JS object `g` mirroring GameData fields
// (decompiled offsets in comments). Other units (U4 world, U5 pioneers) add THEIR OWN fields to the same object
// from their own init function; never rename a field defined here.
//
// Conventions for all game_econ_* modules:
//   fn(m, g, status, ...args)   m = Master (calc/engine/master.js), g = this state, status = UpgradeStatus (U2 interface:
//                               status.get(type, def=ONE)->BigNumber, status.getInt(type, def), ...).
//   C# `int` return codes are kept (0 = ok) and `out` values are returned in an object {code, ...}  (like expr_x/expr_y).
//   Timestamp = JS Number ms (timestamp.js). "MainManager.TryGetGameTime" = g.gameTime (the sim's WithVirtualTime sets it).
//   BigNumber fields are immutable BigNumber instances; always assign a new one.
import { BigNumber } from './bignum.js';

const { ZERO } = BigNumber;

/** Core fields every part may read/write. Part modules extend with their own init (see initXxxState in each file). */
export function createCoreState() {
  return {
    gameTime: 0,                 // MainManager.TryGetGameTime (set by the sim)
    // resources (BigNumber)
    gold: ZERO,                  // +0x4e8
    goldPeak: ZERO,              // +0x4f8
    goldTotal: ZERO,             // +0x508
    goldTotal2: ZERO,            // +0x518
    goldTotal3: ZERO,            // +0x528
    power: ZERO,                 // +0x538
    soul: ZERO,                  // +0x588
    science: ZERO,               // +0x638
    // ranks / progress
    rank: 0,                     // +0x1400 NewWorld power rank
    maxRank: 0,                  // +0x1404
    field: 1,                    // +0x13d0 current field
    unlockedFields: 1,           // +0x13d4 unlocked field count
    researchTier: 0,             // +0x13fc
    scienceRank: 0,              // +0x1460 (status 0x141 adds)
  };
}
