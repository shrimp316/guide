// Shared result cache on the artifact `db` capability (collection "results", doc id = SHA-256 of normalised input).
// Never blocks: no db / timeout / any error -> behaves as a cache miss. Cached data is untrusted -> re-validated field by field.
import { ENGINE_VERSION } from './engine.js';

const dbP = (() => { try { return window.claude?.use ? Promise.resolve(window.claude.use('db')).catch(() => null) : Promise.resolve(null); } catch { return Promise.resolve(null); } })();
const wait = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const MS = ['ms_ads', 'ms_booster', 'ms_mission', 'ms_power', 'ms_soul', 'ms_science', 'ms_quantum'];
const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

export async function makeKey(o) {
  if (!globalThis.crypto?.subtle) return null;
  const norm = {
    v: ENGINE_VERSION, t: o.themeId, d: o.difficulty,
    g: o.goldenCardLevels ? Object.entries(o.goldenCardLevels).map(([k, v]) => [+k, +v]).sort((a, b) => a[0] - b[0]) : null,
    m: MS.map((id) => (o.memberships?.[id] ?? true ? 1 : 0)).join(''),
    p: o.nwPassDays ? [...o.nwPassDays].sort((a, b) => a - b) : (o.memberships?.nw_pass ?? true ? 1 : 0),
    gb: +o.gemBudget || 0, h: o.onlineHoursPerDay ?? 6, sd: o.seasonDays ?? 6, ads: !!o.includeAds, ltd: o.includeLimitedPackages !== false,
    seed: o.seed ?? 93487, en: o.eventNumber ?? 990001,
  };
  const json = JSON.stringify(norm);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)));
  return { id: [...h].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join(''), json, canSet: false };
}

function clean(r) {
  if (!r || typeof r.reached !== 'boolean' || !num(r.elapsedHours, 0, 24 * 60) || !Number.isInteger(r.finalRank) || r.finalRank < 0 || r.finalRank > 40) return null;
  if (!Array.isArray(r.rankTimeline) || r.rankTimeline.length > 45 || !num(r.gemsSpent, 0, 1e9) || !num(r.passGems ?? 0, 0, 1e9)) return null;
  const rankTimeline = [];
  for (const p of r.rankTimeline) { if (!p || !Number.isInteger(p.rank) || p.rank < 0 || p.rank > 40 || !num(p.hours, 0, 24 * 60)) return null; rankTimeline.push({ rank: p.rank, hours: p.hours }); }
  const gemSpentDetail = {};
  const ent = r.gemSpentDetail && typeof r.gemSpentDetail === 'object' ? Object.entries(r.gemSpentDetail) : [];
  if (ent.length > 60) return null;
  for (const [k, v] of ent) { if (!/^[\w.-]{1,64}$/.test(k) || !num(v, 0, 1e9)) return null; gemSpentDetail[k] = v; }
  return { reached: r.reached, elapsedHours: r.elapsedHours, finalRank: r.finalRank, rankTimeline, gemsSpent: r.gemsSpent, gemSpentDetail, passGems: r.passGems ?? 0, warnings: [] };
}

export async function cacheGet(key) {
  if (!key) return null;
  try {
    const db = await wait(dbP, 1000); if (!db) return null;
    const snap = await wait(db.doc('results/' + key.id).get(), 1000); if (!snap) return null;
    if (!snap.exists) { key.canSet = true; return null; }
    const d = snap.data();
    if (!d || d.v !== ENGINE_VERSION || JSON.stringify(d.input) !== key.json) return null;
    return clean(d.result);
  } catch { return null; }
}

export function cacheSet(key, r) {
  if (!key?.canSet) return;
  dbP.then((db) => db?.doc('results/' + key.id).set({
    v: ENGINE_VERSION, input: JSON.parse(key.json), at: Date.now(),
    result: { reached: r.reached, elapsedHours: r.elapsedHours, finalRank: r.finalRank, rankTimeline: r.rankTimeline.map((p) => ({ rank: p.rank, hours: p.hours })), gemsSpent: r.gemsSpent, gemSpentDetail: r.gemSpentDetail || {}, passGems: r.passGems || 0 },
  })).catch(() => {});
}

// run() = () => Promise<result>. Returns {r, cached}.
export async function cachedRun(opts, run, fresh = false) {
  const key = fresh ? null : await makeKey(opts).catch(() => null);
  const hit = await cacheGet(key);
  if (hit) return { r: hit, cached: true };
  const r = await run();
  cacheSet(key, r);
  return { r, cached: false };
}
