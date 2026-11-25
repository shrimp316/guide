// Runs the simulation. Shared by worker.js and main-thread fallback.
import { Master } from './engine/master.js';
import { totalHours } from './engine/timestamp.js';
import { runSimulation, Sim, NW_MEMBERSHIPS, defaultSettings } from './engine/sim.js';

let master, data;
const loadData = async () => (data ??= await (await fetch(new URL('data.json', import.meta.url))).json());
export async function loadMaster() {
  if (!master) { const d = await loadData(); master = new Master({ sheets: d.sheets, enums: d.enums, text: d.text }); }
  return master;
}
export const loadInputs = async () => (await loadData()).inputs;
export const loadText = async () => (await loadData()).text;
export const loadSheets = async () => { const d = await loadData(); return { Product: d.sheets.Product, Reward: d.sheets.Reward }; };

export async function run(opts, onProgress) {
  return runSimulation({ ...opts, master: await loadMaster(), onProgress });
}

// Main-thread variant: same as runSimulation but yields to the event loop between time slices.
export async function runChunked(opts, onProgress, isCancelled) {
  const master = await loadMaster();
  const S = defaultSettings();
  const map = { themeId: 'ThemeId', difficulty: 'Difficulty', gemBudget: 'GemBudget', onlineHoursPerDay: 'OnlineHoursPerDay', seasonDays: 'SeasonDays', includeAds: 'IncludeAds', includeLimitedPackages: 'IncludeLimitedPackages' };
  for (const [k, v] of Object.entries(map)) if (opts[k] !== undefined) S[v] = opts[k];
  const memberships = Object.fromEntries([...NW_MEMBERSHIPS, 'nw_pass'].map((id) => [id, opts.memberships?.[id] ?? true]));
  S.nwPass = memberships.nw_pass;
  const sim = new Sim(master, S, { goldenCardLevels: opts.goldenCardLevels, memberships });
  sim.onProgress = onProgress;
  // run() is synchronous; re-implement its loop with yielding by wrapping step()
  sim.setup(); sim.lastProgress = -1;
  const total = () => sim.end - sim.start;
  let t0 = performance.now();
  while (!sim.isFinished) {
    sim.step();
    const f = Math.min(1, (sim.now - sim.start) / total());
    if (f >= sim.lastProgress + 0.01 || sim.isFinished) { sim.lastProgress = f; onProgress?.(f, { finalRank: sim.g.rank, elapsedHours: totalHours(sim.now - sim.start), rankTimeline: sim.rankTimeline.slice() }); }
    if (performance.now() - t0 > 30) { await new Promise((r) => setTimeout(r)); if (isCancelled?.()) throw new Error('cancelled'); t0 = performance.now(); }
  }
  const gm = sim.gem ?? {};
  return { reached: sim.g.rank >= sim.rankMax, elapsedHours: totalHours(sim.now - sim.start), finalRank: sim.g.rank, rankTimeline: sim.rankTimeline, gemsSpent: gm.gemsVariable ?? 0, gemSpentDetail: gm.spentDetail ?? {}, warnings: sim.warnings };
}

import * as SIM from './engine/sim.js';
export const ENGINE_VERSION = SIM.ENGINE_VERSION ?? '1';
