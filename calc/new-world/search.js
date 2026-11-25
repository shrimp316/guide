// Minimum-gem search. Pure: evalFn(budget) -> Promise<sim result>. Assumes reached is monotone in budget.
const r100 = (x) => Math.max(100, Math.round(x / 100) * 100);

export async function searchMinGems(evalFn, { N = 4, cap = 320000, onAttempt, onPhase } = {}) {
  const attempts = [];
  const batch = (budgets, phase, lo, hi) => {
    onPhase?.(phase, budgets, { lo, hi });
    return Promise.all(budgets.map(async (budget) => {
      const a = { budget, r: await evalFn(budget) };
      attempts.push(a); onAttempt?.(a); return a;
    }));
  };
  const [a0] = await batch([0], 'base', 0, null);
  if (a0.r.reached) return { status: 'free', best: a0, attempts };

  let hi = null, lo = 0;
  const ladder = []; for (let b = 5000; b < cap; b *= 2) ladder.push(b); ladder.push(cap);
  for (let i = 0; i < ladder.length && !hi; i += N) {
    const rs = await batch(ladder.slice(i, i + N), 'exp', lo, null);
    hi = rs.filter((a) => a.r.reached).sort((x, y) => x.budget - y.budget)[0] ?? null;
    if (!hi) lo = Math.max(lo, ...rs.map((a) => a.budget));
  }
  if (!hi) return { status: 'unreachable', cap, maxRank: Math.max(...attempts.map((a) => a.r.finalRank)), attempts };
  const lower = () => Math.max(0, ...attempts.filter((a) => !a.r.reached && a.budget < hi.budget).map((a) => a.budget));
  lo = lower();
  while (hi.budget - lo > Math.max(1000, 0.05 * hi.budget)) {
    const pts = [...new Set(Array.from({ length: N }, (_, k) => r100(lo + ((hi.budget - lo) * (k + 1)) / (N + 1))))].filter((p) => p > lo && p < hi.budget);
    if (!pts.length) break;
    const rs = await batch(pts, 'bis', lo, hi.budget);
    hi = [hi, ...rs.filter((a) => a.r.reached)].sort((x, y) => x.budget - y.budget)[0];
    lo = lower();
  }
  return { status: 'found', best: hi, lo, attempts };
}
