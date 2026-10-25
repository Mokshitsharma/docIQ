/**
 * Eval statistics: hit@k, MRR, and percentile-bootstrap confidence intervals
 * with a seeded PRNG so every run of `npm run eval` yields identical numbers.
 */

/** mulberry32 — small, fast, deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

/**
 * Percentile bootstrap CI of the mean of `values` (per-question outcomes,
 * e.g. 0/1 hits). Returns { value, n, ci: [lo, hi] }.
 */
export function bootstrapMean(values, { resamples = 10000, seed = 1234, alpha = 0.05 } = {}) {
  const n = values.length;
  if (n === 0) return { value: null, n: 0, ci: [null, null] };
  const rng = mulberry32(seed);
  const stats = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)];
    stats[r] = s / n;
  }
  const sorted = Array.from(stats).sort((a, b) => a - b);
  return {
    value: round(mean(values)),
    n,
    ci: [round(quantile(sorted, alpha / 2)), round(quantile(sorted, 1 - alpha / 2))],
  };
}

/**
 * Paired bootstrap CI of mean(a) - mean(b) where a[i], b[i] are outcomes of
 * two systems on the same question i (resampling questions, not systems).
 */
export function pairedBootstrapDiff(a, b, { resamples = 10000, seed = 1234, alpha = 0.05 } = {}) {
  if (a.length !== b.length) throw new Error('paired bootstrap needs equal-length arrays');
  const diffs = a.map((x, i) => x - b[i]);
  const r = bootstrapMean(diffs, { resamples, seed, alpha });
  return { diff: r.value, n: r.n, ci: r.ci };
}

/** 1-based rank of the first relevant item in `ranked` (array of booleans), or null. */
export function firstRelevantRank(relevance) {
  const i = relevance.indexOf(true);
  return i === -1 ? null : i + 1;
}

export const hitAt = (rank, k) => (rank !== null && rank <= k ? 1 : 0);
export const reciprocalRank = (rank) => (rank === null ? 0 : 1 / rank);
