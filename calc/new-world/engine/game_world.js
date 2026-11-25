// U4 entry point: GameData "NewWorld content" = cards/frames, world crystal, world stone tree, arc, clock tower + time rampage,
// world tree + content-time batches. Re-exports the five part modules under one convention and wires their cross-unit deps.
//   world_cards.js  cards / frames / level-up          (fn(m, g, ...))
//   world_stone.js  world stone menu + tree generator  (fn(gd, status, ...)  -> wrapped here)
//   world_arc.js    arc nodes/links/circuits           (fn(gd, status, ...)  -> wrapped here)
//   world_batch.js  content time batches + world tree  (fn(gd, status, ...)  -> wrapped here)
//   world_clock.js  clock tower / time rampage / pass  (fn(m, g, status, ...))
// Unified convention (same as U3 game_state.js): fn(m, g, status, ...args). The wrappers set g.m / g.master (parts use either).
import { BigNumber } from './bignum.js';
import * as cards from './world_cards.js';
import * as stone from './world_stone.js';
import * as arc from './world_arc.js';
import * as batch from './world_batch.js';
import * as clock from './world_clock.js';
import * as econ from './econ_gold.js';
import * as pEcon from './pioneers_econ.js';
import * as pProc from './pioneers_proc.js';
import { WeaponPower } from './expr_x.js';

export { cards, stone, arc, batch, clock };

const { ZERO } = BigNumber;
/** (gd, status, ...) -> (m, g, status, ...) */
const W = (fn) => (m, g, status, ...a) => { g.m = g.master = m; return fn(g, status, ...a); };

/** GameData.GetAllWeaponPower @3b99700: sum of WeaponPower over all brought (level > 0) weapons. */
export function getAllWeaponPower(m, g, status) {
  let sum = ZERO;
  for (const [id, level] of g.weapons) if (level > 0) sum = sum.add(WeaponPower(m, id, level, status).value);
  return sum;
}

/**
 * Add the U4 fields to the shared GameData state `g` (from U3 createEconState) and wire cross-unit deps (module-global,
 * last call wins). Returns g.
 *   g.themeId (+0x420) is aliased to g.newWorldId / g.nwWorldId (parts use different names); g.mode -> g.gameMode;
 *   g.worldTreeProcessing / g.wtProcessingPower (U3 AddPower flag) are aliased onto g.nw.processing / g.nw.power (+0x1338 / +0x12b8);
 *   g.GameMode (U5) = 10; g.nwPassLevel must be >= 1 for the NW pass/time rampage to be enabled (see U4_NOTES).
 */
export function createWorldState(m, g) {
  g.m = g.master = m;
  g.mode = g.gameMode = g.GameMode = 10;
  g.themeId ??= 90001; g.eventNumber ??= 990001; g.difficulty ??= 2;
  g.newWorldId = g.nwWorldId = g.themeId;
  g.status ??= null;
  cards.initCardState(g);
  stone.initWorldStone(g);
  arc.initArcState(g);
  batch.initNewWorldState(g);
  clock.initClockState(g);
  batch.installWorldTreeHooks(g);
  g.nwPassLevel = Math.max(1, g.nwPassLevel ?? 0);
  Object.defineProperty(g, 'worldTreeProcessing', { configurable: true, get: () => g.nw.processing, set: (v) => { g.nw.processing = v; } });
  Object.defineProperty(g, 'wtProcessingPower', { configurable: true, get: () => g.nw.power, set: (v) => { g.nw.power = v; } });
  wireDeps();
  return g;
}

/** Hook the part modules onto U3 (economy) and U5 (pioneers). */
export function wireDeps() {
  clock.setDeps({
    getAllWeaponPower: (g, status) => getAllWeaponPower(g.m, g, status),
    getClockTowerGoldArcBonus: (m, g, status) => arc.getClockTowerGoldArcBonus(g, status),
    getClockTowerPowerArcBonus: (m, g, status) => arc.getClockTowerPowerArcBonus(g, status),
    modifyGold: econ.modifyGold,
    modifyPower: econ.modifyPower,
  });
  arc.deps.modifyGold = econ.modifyGold;
  arc.deps.getPioneersBonus = (g, status, type) => pEcon.getPioneersBonus(g, type);
  // pioneers hooks are no-ops until U5's state exists (g.Pioneers), as in the game (null state -> early return)
  batch.setDeps({
    getPioneersBoundaryTicks: (g, status, ticks) => (g.Pioneers ? pProc.getPioneersBoundaryTicks(g, ticks) : ticks),
    beginPioneersProgress: (g, status, totalSec, extraSec, startTs) =>
      g.Pioneers && pProc.beginPioneersProgress(g, startTs, g.nw.batches[0].target, totalSec, extraSec),
    endPioneersProgress: (g) => g.Pioneers && pProc.endPioneersProgress(g, g.nw.contentTime),
    resumePioneersProgress: (g) => g.Pioneers && pProc.resumePioneersProgress(g),
    progressPioneers: (g, status, dt) => g.Pioneers && pProc.progressPioneers(g, dt),
    refreshPioneersExternalEffects: (g, status, snap) => g.Pioneers && pEcon.refreshPioneersExternalEffects(g, snap),
    snapshotPioneersEffects: (g, status) => new Map(status?.pioneersExternalEffects ?? []),
    isPioneersBusy: (g) => !!g.PioneersBusy,
  });
}

// ---- cards (fn(m, g, ...)) ---------------------------------------------------------------------------------------------
export const { getCardData, setCardData, addCard, isNewWorldCardUnlocked, isCardCraftAvailable, getCardCraftCountToNextLevel,
  craftCardToNextLevel, levelUpCard, setupGoldenCards, getFrameBalance, addCardFrame, cardLevelMax } = cards;
export const modifyWorldCrystal = clock.modifyWorldCrystal;

// ---- world stone ---------------------------------------------------------------------------------------------------------
export const ensureWorldStone = W(stone.ensureWorldStone);
export const buyWorldStone = W(stone.buyWorldStone);
export const buyWorldStoneSpecialization = W(stone.buyWorldStoneSpecialization);
/** Sim-side accessor: the WorldStoneMenuData (GameData +0x16b8) and its "ready" flag (+0x16c0). */
export const getWorldStoneMenu = (g) => (g.stone && g.stone.ready ? g.stone.menu : null);

// ---- arc ---------------------------------------------------------------------------------------------------------------
export const unlockArcNode = W(arc.unlockArcNode);
export const installArcLink = W(arc.installArcLink);
export const upgradeArcLink = W(arc.upgradeArcLink);
export const addArcNodeSpeed = W(arc.addArcNodeSpeed);
export const getArcAvailableLinks = W(arc.getArcAvailableLinks);
export const isArcLinkInstalled = W(arc.isArcLinkInstalled);
export const getArcNodeMaxLevel = W(arc.getArcNodeMaxLevel);
export const refreshArcDeviceBonus = W(arc.refreshArcDeviceBonus);
export const modifyMana = (g, v) => arc.modifyMana(g, v);

// ---- clock tower / time rampage / pass ---------------------------------------------------------------------------------
export const { chargeClockTower, collectClockTower, getClockTowerMaxChargeCount, activateTimeRampage, getTimeRampageExtraSeconds,
  refreshClockTowerRates, refreshClockTowerDaily, prepareClockTowerProgress, isTimeRampageActive, setNewWorldPassEntitlement } = clock;

// ---- world tree / content time -------------------------------------------------------------------------------------------
export const syncWorldTree = W(batch.syncWorldTree);
export const processNewWorldContentForVerification = W(batch.processNewWorldContentForVerification);
export const prepareNewWorldModeContent = W(batch.prepareNewWorldModeContent);
export const refreshNewWorldModeContentRates = W(batch.refreshNewWorldModeContentRates);
export const queueNewWorldTime = W(batch.queueNewWorldTime);
export const growWorldTree = W(batch.growWorldTree);
export const canGrowWorldTree = W(batch.canGrowWorldTree);
export const getWorldTreeGrowthGain = W(batch.getWorldTreeGrowthGain);
export const worldTreeEfficiency = W(batch.worldTreeEfficiency);
/** get_WorldTreeManaPerSecond @3c112b4 (used by sim SpendMana): WorldTreeManaPerSecond(tree soul +0x12c8, efficiency, GetWorldTreeProductionBonus(0x38e, rate910 +0x1308)) @3c11134 = rate910 x dynamic bonus [x pass multiplier when the pass is enabled at game time]. */
export function getWorldTreeManaPerSecond(m, g, status) {
  g.m = g.master = m;
  let bonus = g.nw.rate910.mul(arc.getNewWorldDynamicBonus(g, status, 0x38e));
  if (clock.isNewWorldPassEnabledAt(g, g.gameTime)) bonus = bonus.mul(batch.deps.getNewWorldPassMultiplier(m, 0x38e));
  return batch.worldTreeManaPerSecond(m, g.nw.soul, batch.worldTreeEfficiency(g), bonus);
}
export const isNewWorldContentPending = (g) => batch.isNewWorldContentPending(g);
