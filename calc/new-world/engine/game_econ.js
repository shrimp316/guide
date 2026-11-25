// U3 economy core entry point: re-exports econ_gold / econ_science / econ_soul and composes the full state.
// Conventions: see game_state.js header and U3_NOTES.md.
import { newEconState as newGoldState } from './econ_gold.js';
import { initScienceState } from './econ_science.js';
import { initSoulState } from './econ_soul.js';

export * from './game_state.js';
export * from './econ_gold.js';
export * from './econ_science.js';
export * from './econ_soul.js';

/** Full NewWorld start state for U3 (gold + science + soul fields). U4/U5 add their own fields to the same object. */
export function createEconState(m, opts = {}) {
  return initSoulState(initScienceState(newGoldState(m, opts)));
}
