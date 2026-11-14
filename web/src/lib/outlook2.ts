import { median, percentile } from './stats';
import { daysInMonth, monthOf, tFromYM, yearOf } from './time';

export interface Sp { tFirst: number; tLast: number }
const fin = (v: number): boolean => Number.isFinite(v);
/** Latest complete year (the current month is partial). */
export const lastCompleteYear = (sp: Sp): number => yearOf(sp.tLast) - 1;
const val = (arr: ArrayLike<number>, sp: Sp, y: number, m: number): number => { const t = tFromYM(y, m); return t >= sp.tFirst && t < sp.tLast && t < arr.length && fin(arr[t]) ? arr[t] : NaN; };

/** Chance that each calendar month is above the window's P75 (Laplace-smoothed), same method as the Outlook strip. */
export function monthProbs(arr: ArrayLike<number>, sp: Sp, endYear: number, years = 10, pct = 75): { threshold: number; p: number[]; n: number[] } {
  const win: number[] = []; for (let y = endYear - years + 1; y <= endYear; y++) for (let m = 1; m <= 12; m++) { const v = val(arr, sp, y, m); if (fin(v)) win.push(v); }
  const threshold = percentile(win, pct), p: number[] = [], n: number[] = [];
  for (let m = 1; m <= 12; m++) { let k = 0, c = 0; for (let y = endYear - years + 1; y <= endYear; y++) { const v = val(arr, sp, y, m); if (!fin(v)) continue; c++; if (v > threshold) k++; } n.push(c); p.push((k + 1) / (c + 2)); }
  return { threshold, p, n };
}
/** Median of each calendar month over the `years` complete years ending at endYear. */
export function monthStats(arr: ArrayLike<number>, sp: Sp, endYear: number, years = 10): { median: number[]; p10: number[]; p90: number[] } {
  const med: number[] = [], p10: number[] = [], p90: number[] = [];
  for (let m = 1; m <= 12; m++) { const h: number[] = []; for (let y = endYear - years + 1; y <= endYear; y++) { const v = val(arr, sp, y, m); if (fin(v)) h.push(v); } med.push(median(h)); p10.push(percentile(h, 10)); p90.push(percentile(h, 90)); }
  return { median: med, p10, p90 };
}

/** Fractional month position (0..12) where the cumulative share of a 12-month curve crosses `share`; null for an empty curve. */
export function crossing(curve: number[], share: number): number | null {
  const tot = curve.reduce((a, b) => a + (fin(b) && b > 0 ? b : 0), 0); if (!(tot > 0)) return null;
  let cum = 0;
  for (let i = 0; i < 12; i++) { const v = fin(curve[i]) && curve[i] > 0 ? curve[i] : 0, next = cum + v; if (next / tot >= share && v > 0) return i + (share * tot - cum) / v; cum = next; }
  return 12;
}
export interface Timing { start: number; mid: number; end: number }
export function timingFromCurve(curve: number[]): Timing | null {
  const s = crossing(curve, 0.1), m = crossing(curve, 0.5), e = crossing(curve, 0.9);
  return s === null || m === null || e === null ? null : { start: s, mid: m, end: e };
}
/** early / mid / late of a fractional month position. */
export function monthPhrase(pos: number, abbr: string[]): string {
  const i = Math.min(11, Math.max(0, Math.floor(pos))), f = pos - i;
  return `${f < 1 / 3 ? 'early' : f < 2 / 3 ? 'mid' : 'late'} ${abbr[i]}`;
}
/** Fractional month position to day of year (non-leap month lengths, 2001 calendar). */
export function posToDoy(pos: number): number {
  const i = Math.min(11, Math.max(0, Math.floor(pos))), f = pos - i; let d = 0;
  for (let m = 1; m <= i; m++) d += daysInMonth(2001, m);
  return d + f * daysInMonth(2001, i + 1);
}
export interface Next3 { m: number; year: number; median: number; p10: number; p90: number; chance: number }
export function nextMonths(arr: ArrayLike<number>, sp: Sp, count = 3): Next3[] {
  const ly = lastCompleteYear(sp), st = monthStats(arr, sp, ly), pr = monthProbs(arr, sp, ly), out: Next3[] = [];
  for (let i = 1; i <= count; i++) { const t = sp.tLast + i, m = monthOf(t); out.push({ m, year: yearOf(t), median: st.median[m - 1], p10: st.p10[m - 1], p90: st.p90[m - 1], chance: pr.p[m - 1] }); }
  return out;
}
export interface Pace {
  year: number; monthsNow: number; actual: number[]; median: number[]; p10: number[]; p90: number[];
  ytdComplete: number; proj: { lo: number; med: number; hi: number } | null; status: 'below' | 'normal' | 'above' | null; annual: { p25: number; p75: number } | null;
}
/** Cumulative curve of the current year against the cumulative curves of the last 10 complete years, plus a projected year total. */
export function pace(arr: ArrayLike<number>, sp: Sp, years = 10): Pace {
  const Y = yearOf(sp.tLast), mNow = monthOf(sp.tLast), ly = lastCompleteYear(sp);
  const actual: number[] = []; let c = 0; for (let m = 1; m <= mNow; m++) { const t = tFromYM(Y, m), v = t < arr.length && fin(arr[t]) ? arr[t] : 0; c += v; actual.push(c); }
  const ytdComplete = mNow > 1 ? actual[mNow - 2] : 0;
  const curves: number[][] = [], totals: number[] = [], rem: number[] = [];
  for (let y = ly - years + 1; y <= ly; y++) {
    const cum: number[] = []; let s = 0, r = 0, ok = true;
    for (let m = 1; m <= 12; m++) { const v = val(arr, sp, y, m); if (!fin(v)) { ok = false; break; } s += v; cum.push(s); if (m >= mNow) r += v; }
    if (ok) { curves.push(cum); totals.push(s); rem.push(r); }
  }
  const col = (i: number): number[] => curves.map((cu) => cu[i]);
  const median12 = Array.from({ length: 12 }, (_, i) => median(col(i))), p10 = Array.from({ length: 12 }, (_, i) => percentile(col(i), 10)), p90 = Array.from({ length: 12 }, (_, i) => percentile(col(i), 90));
  let proj: Pace['proj'] = null, status: Pace['status'] = null, annual: Pace['annual'] = null;
  if (rem.length >= 3) {
    proj = { lo: ytdComplete + percentile(rem, 10), med: ytdComplete + median(rem), hi: ytdComplete + percentile(rem, 90) };
    annual = { p25: percentile(totals, 25), p75: percentile(totals, 75) };
    status = proj.med < annual.p25 ? 'below' : proj.med > annual.p75 ? 'above' : 'normal';
  }
  return { year: Y, monthsNow: mNow, actual, median: median12, p10, p90, ytdComplete, proj, status, annual };
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, abs. error < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + (x >= 0 ? y : -y));
}
/** Theil-Sen slope: the median of all pairwise slopes. */
export function theilSen(xs: number[], ys: number[]): number {
  const s: number[] = []; for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) s.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  return s.length ? median(s) : NaN;
}
/** Mann-Kendall trend test, normal approximation with tie correction, two-sided p. */
export function mannKendall(ys: number[]): { s: number; z: number; p: number } {
  const n = ys.length; let s = 0; for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(ys[j] - ys[i]);
  const ties = new Map<number, number>(); for (const v of ys) ties.set(v, (ties.get(v) ?? 0) + 1);
  let v = (n * (n - 1) * (2 * n + 5)) / 18; for (const t of ties.values()) if (t > 1) v -= (t * (t - 1) * (2 * t + 5)) / 18;
  const z = v <= 0 ? 0 : s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
  return { s, z, p: 2 * (1 - normCdf(Math.abs(z))) };
}
export interface Shift { years: number[]; start: number[]; mid: number[]; end: number[]; slope: { start: number; mid: number; end: number }; p: { start: number; mid: number; end: number } }
/** Season start / middle / end (cumulative 10 / 50 / 90 %) per complete year, as day of year, with Theil-Sen slope (days per decade) and MK p. */
export function seasonShift(arr: ArrayLike<number>, sp: Sp, y0 = 2001): Shift | null {
  const years: number[] = [], st: number[] = [], mi: number[] = [], en: number[] = [], ly = lastCompleteYear(sp);
  for (let y = y0; y <= ly; y++) {
    const curve: number[] = []; let ok = true; for (let m = 1; m <= 12; m++) { const v = val(arr, sp, y, m); if (!fin(v)) { ok = false; break; } curve.push(v); }
    if (!ok) continue; const t = timingFromCurve(curve); if (!t) continue;
    years.push(y); st.push(posToDoy(t.start)); mi.push(posToDoy(t.mid)); en.push(posToDoy(t.end));
  }
  if (years.length < 8) return null;
  const f = (ys: number[]): { sl: number; p: number } => ({ sl: theilSen(years, ys) * 10, p: mannKendall(ys).p });
  const a = f(st), b = f(mi), c = f(en);
  return { years, start: st, mid: mi, end: en, slope: { start: a.sl, mid: b.sl, end: c.sl }, p: { start: a.p, mid: b.p, end: c.p } };
}
export interface Hindcast { flaggedN: number; flaggedHit: number; unflaggedN: number; unflaggedHit: number; allN: number; allHit: number; hitPct: number | null; unflaggedPct: number | null; basePct: number | null; skill: 'good' | 'weak' | 'insufficient' }
/** For each year Y (y0..last complete): flag months with chance >= 0.5 using only the 10 years before Y, then check whether they were above that window's P75 in Y. */
export function hindcast(arr: ArrayLike<number>, sp: Sp, y0 = 2016, critical = 0.5): Hindcast {
  const ly = lastCompleteYear(sp); let fN = 0, fH = 0, uN = 0, uH = 0;
  for (let Y = y0; Y <= ly; Y++) {
    const pr = monthProbs(arr, sp, Y - 1);
    for (let m = 1; m <= 12; m++) {
      const v = val(arr, sp, Y, m); if (!fin(v)) continue; const hit = v > pr.threshold;
      if (pr.p[m - 1] >= critical) { fN++; if (hit) fH++; } else { uN++; if (hit) uH++; }
    }
  }
  const allN = fN + uN, allHit = fH + uH, pct = (a: number, b: number): number | null => (b > 0 ? (100 * a) / b : null);
  const hitPct = pct(fH, fN), basePct = pct(allHit, allN);
  const skill: Hindcast['skill'] = fN < 5 || hitPct === null || basePct === null ? 'insufficient' : hitPct - basePct >= 15 ? 'good' : 'weak';
  return { flaggedN: fN, flaggedHit: fH, unflaggedN: uN, unflaggedHit: uH, allN, allHit, hitPct, unflaggedPct: pct(uH, uN), basePct, skill };
}
export const fmtTh = (x: number): string => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US').replace(/,/g, ' ') : '—');
