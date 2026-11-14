const clean = (a: ArrayLike<number>): number[] => {
  const o: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) o.push(a[i]);
  return o.sort((x, y) => x - y);
};
/** Linear-interpolated percentile, p in 0..100. NaN for empty input. */
export function percentile(a: ArrayLike<number>, p: number): number {
  const s = clean(a);
  if (!s.length) return NaN;
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a: ArrayLike<number>): number => percentile(a, 50);
/** Raw median absolute deviation (not scaled). */
export function mad(a: ArrayLike<number>): number {
  const m = median(a);
  if (Number.isNaN(m)) return NaN;
  return median(clean(a).map((v) => Math.abs(v - m)));
}
/** Robust z = (x - median) / (1.4826 * MAD). MAD = 0 guard: 0 if x equals median, else +-clip. Result clipped to +-clip. */
export function robustZ(x: number, med: number, madv: number, clip = 3): number {
  if (!Number.isFinite(x) || !Number.isFinite(med)) return NaN;
  if (!(madv > 0)) return x === med ? 0 : x > med ? clip : -clip;
  const z = (x - med) / (1.4826 * madv);
  return Math.max(-clip, Math.min(clip, z));
}
/** Percent of history at or below x (mid-rank for ties), 0..100. */
export function rankPercentile(x: number, hist: ArrayLike<number>): number {
  const h = clean(hist);
  if (!h.length || !Number.isFinite(x)) return NaN;
  let less = 0, eq = 0;
  for (const v of h) { if (v < x) less++; else if (v === x) eq++; }
  return ((less + 0.5 * eq) / h.length) * 100;
}
