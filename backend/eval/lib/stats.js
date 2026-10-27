/**
 * Extra statistics for the eval: exact McNemar test, power / sample-size for a
 * paired binary comparison, Clopper-Pearson bounds and bootstrap CIs of quantiles.
 * Pure functions, no dependencies, deterministic (seeded PRNG from metrics.js).
 */
import { mulberry32 } from './metrics.js';

const round = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X <= k) for X ~ Binomial(n, p). */
export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
  return Math.min(1, s);
}

/**
 * Exact (binomial) McNemar test on paired 0/1 outcomes a[i], b[i].
 * b10 = a right & b wrong, b01 = a wrong & b right. Two-sided p-value.
 */
export function mcnemarExact(a, b) {
  if (a.length !== b.length) throw new Error('mcnemar needs paired arrays');
  let b10 = 0;
  let b01 = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && !b[i]) b10++;
    else if (!a[i] && b[i]) b01++;
  }
  const d = b10 + b01;
  const p = d === 0 ? 1 : Math.min(1, 2 * binomCdf(Math.min(b10, b01), d, 0.5));
  return { n: a.length, b10, b01, discordant: d, pValue: round(p, 6) };
}

// Inverse standard normal CDF (Acklam's rational approximation, |err| < 1.2e-9).
export function qnorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -qnorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Sample size (number of paired questions) for McNemar's test to detect a
 * difference `delta` in proportions, given the expected discordance rate
 * `pDisc` = P(systems disagree). Connor (1987) normal approximation:
 *   n = (z_{1-a/2} sqrt(pDisc) + z_{1-b} sqrt(pDisc - delta^2))^2 / delta^2
 */
export function mcnemarSampleSize({ delta, pDisc, alpha = 0.05, power = 0.8 }) {
  const pd = Math.max(pDisc, delta + 1e-9); // the two systems must disagree on at least delta of items
  const za = qnorm(1 - alpha / 2);
  const zb = qnorm(power);
  return Math.ceil((za * Math.sqrt(pd) + zb * Math.sqrt(pd - delta * delta)) ** 2 / (delta * delta));
}

/** Smallest delta detectable with `n` paired items at the given discordance, alpha and power (bisection). */
export function mcnemarDetectableDelta({ n, pDisc, alpha = 0.05, power = 0.8 }) {
  let lo = 1e-4;
  let hi = Math.max(pDisc, 1e-3);
  if (mcnemarSampleSize({ delta: hi, pDisc, alpha, power }) > n) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mcnemarSampleSize({ delta: mid, pDisc, alpha, power }) <= n) hi = mid;
    else lo = mid;
  }
  return round(hi);
}

/** Clopper-Pearson exact two-sided CI for k successes in n trials. */
export function clopperPearson(k, n, alpha = 0.05) {
  if (n === 0) return [null, null];
  const solve = (target, upper) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const v = upper ? binomCdf(k, n, mid) : 1 - binomCdf(k - 1, n, mid);
      if (upper ? v > target : v < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const low = k === 0 ? 0 : solve(alpha / 2, false);
  const high = k === n ? 1 : solve(alpha / 2, true);
  return [round(low), round(high)];
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Point estimate and percentile-bootstrap CI of the q-quantile of `values`. */
export function bootstrapQuantile(values, q, { resamples = 10000, seed = 1234, alpha = 0.05 } = {}) {
  const n = values.length;
  if (!n) return { value: null, n: 0, ci: [null, null] };
  const rng = mulberry32(seed);
  const stats = new Float64Array(resamples);
  const buf = new Float64Array(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) buf[i] = values[Math.floor(rng() * n)];
    buf.sort();
    stats[r] = quantile(buf, q);
  }
  stats.sort();
  return {
    value: round(quantile([...values].sort((a, b) => a - b), q), 3),
    n,
    ci: [round(quantile(stats, alpha / 2), 3), round(quantile(stats, 1 - alpha / 2), 3)],
  };
}
