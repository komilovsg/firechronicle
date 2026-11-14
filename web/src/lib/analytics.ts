import { median, percentile, mad, robustZ, rankPercentile } from './stats';
import { MONTH_ABBR, MONTH_FULL, daysInMonth, monthOf, tFromYM, yearOf } from './time';
import type { Series } from './series';

export type Mode = 'harm' | 'modis' | 'viirs' | 'naive';
export const valueSeries = (s: Series, mode: Mode): Float64Array => s[mode];

export interface Span { tFirst: number; tLast: number }
/** All finite values of calendar month m (1..12) over years y0..y1, excluding the partial current month (t >= tLast). */
export function monthHistory(arr: ArrayLike<number>, m: number, y0: number, y1: number, sp: Span): { years: number[]; values: number[] } {
  const years: number[] = [], values: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const t = tFromYM(y, m);
    if (t < sp.tFirst || t >= sp.tLast || t >= arr.length) continue;
    const v = arr[t];
    if (Number.isFinite(v)) { years.push(y); values.push(v); }
  }
  return { years, values };
}
export interface Climatology { median: number[]; p10: number[]; p90: number[]; n: number[] }
export function climatology(arr: ArrayLike<number>, y0: number, y1: number, sp: Span): Climatology {
  const c: Climatology = { median: [], p10: [], p90: [], n: [] };
  for (let m = 1; m <= 12; m++) {
    const h = monthHistory(arr, m, y0, y1, sp).values;
    c.median.push(median(h)); c.p10.push(percentile(h, 10)); c.p90.push(percentile(h, 90)); c.n.push(h.length);
  }
  return c;
}
/** Complete years (all 12 months observed, before the current month) with totals. */
export function annualTotals(arr: ArrayLike<number>, y0: number, y1: number, sp: Span): { year: number; total: number }[] {
  const out: { year: number; total: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    const a = tFromYM(y, 1), b = tFromYM(y, 12);
    if (a < sp.tFirst || b >= sp.tLast || b >= arr.length) continue;
    let s = 0, ok = true;
    for (let t = a; t <= b; t++) { if (!Number.isFinite(arr[t])) { ok = false; break; } s += arr[t]; }
    if (ok) out.push({ year: y, total: s });
  }
  return out;
}

export interface Season { months: number[]; peak: number }
/** Typical season: months whose median share of the sum of monthly medians is >= minShare. */
export function detectSeason(med: number[], minShare = 0.08): Season | null {
  const v = med.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const tot = v.reduce((a, b) => a + b, 0);
  if (tot <= 0) return null;
  const months: number[] = [];
  v.forEach((x, i) => { if (x / tot >= minShare) months.push(i + 1); });
  const peak = v.indexOf(Math.max(...v)) + 1;
  return { months, peak };
}
/** Compress months (1..12) into circular ranges: [3,4,5,7,8,9,10] -> ["Mar\u2013May","Jul\u2013Oct"]; [11,12,1,2] -> ["Nov\u2013Feb"]. */
export function monthRanges(months: number[]): string[] {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (!set.size) return [];
  if (set.size === 12) return ['Jan\u2013Dec'];
  // start at a month whose predecessor is absent, so wrap-around runs stay whole
  let start = 1;
  for (let m = 1; m <= 12; m++) if (set.has(m) && !set.has(m === 1 ? 12 : m - 1)) { start = m; break; }
  const out: { a: number; b: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((start - 1 + i) % 12) + 1;
    if (!set.has(m)) continue;
    const last = out[out.length - 1];
    const prev = m === 1 ? 12 : m - 1;
    if (last && last.b === prev) last.b = m; else out.push({ a: m, b: m });
  }
  out.sort((x, y) => x.a - y.a);
  return out.map((r) => (r.a === r.b ? MONTH_ABBR[r.a - 1] : `${MONTH_ABBR[r.a - 1]}\u2013${MONTH_ABBR[r.b - 1]}`));
}
const joinAnd = (a: string[]): string => (a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

export interface ThisMonth { approx: boolean; year: number; month: number; value: number; fraction: number; days: number; hist: number[]; histYears: number[]; median: number; p10: number; p90: number; pctVsMedian: number; rank: number }
/** Current (partial) month vs the same calendar month of earlier years, history pro-rated by fraction of the month elapsed. */
/** hist (optional): same-days-1..D totals of past years from partial.json (t, value); without it, history is pro-rated by days (approximate). */
export function thisMonthStats(arr: ArrayLike<number>, y0: number, y1: number, sp: Span, partialDays: number, hist?: { t: number[]; v: number[] } | null): ThisMonth | null {
  const y = yearOf(sp.tLast), m = monthOf(sp.tLast), dim = daysInMonth(y, m);
  const value = arr[sp.tLast];
  let fraction = Math.min(1, Math.max(0.01, partialDays / dim)), approx = true;
  let years: number[], vals: number[];
  if (hist && hist.t.length) {
    years = []; vals = [];
    hist.t.forEach((t, i) => { const yy = yearOf(t); if (monthOf(t) === m && yy < y && yy >= y0 && yy <= y1 && Number.isFinite(hist.v[i])) { years.push(yy); vals.push(hist.v[i]); } });
    approx = false; fraction = 1;
  } else {
    const h = monthHistory(arr, m, y0, Math.min(y1, y - 1), sp);
    years = h.years; vals = h.values.map((v) => v * fraction);
  }
  if (!Number.isFinite(value) || !vals.length) return null;
  const med = median(vals);
  return { approx, year: y, month: m, value, fraction: approx ? fraction : 1, days: partialDays, hist: vals, histYears: years, median: med, p10: percentile(vals, 10), p90: percentile(vals, 90), pctVsMedian: med > 0 ? (value / med - 1) * 100 : NaN, rank: rankPercentile(value, vals) };
}
export const ordinal = (n: number): string => {
  const k = Math.round(n), r = k % 100;
  const s = r >= 11 && r <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[k % 10] ?? 'th';
  return `${k}${s}`;
};
const fmtN = (x: number): string => Math.round(x).toLocaleString('en-US');

export interface Outlook { threshold: number; years: number; months: { m: number; year: number; k: number; n: number; p: number; critical: boolean }[]; next: { from: number; to: number; n: number } | null }
/**
 * Climatological probability that a calendar month is high-activity: above the area's 75th percentile of monthly values
 * over the most recent `years` complete years. p = (k+1)/(n+2), Laplace-smoothed. Not a forecast.
 */
export function outlook(arr: ArrayLike<number>, sp: Span, pct = 75, critical = 0.5, years = 10): Outlook {
  const lastYear = yearOf(sp.tLast) - 1; // latest complete year (the current month is partial)
  const t0 = Math.max(sp.tFirst, tFromYM(lastYear - years + 1, 1)), t1 = Math.min(tFromYM(lastYear, 12), sp.tLast - 1);
  const win: number[] = [];
  for (let t = t0; t <= t1 && t < arr.length; t++) if (Number.isFinite(arr[t])) win.push(arr[t]);
  const threshold = percentile(win, pct);
  const months: Outlook['months'] = [];
  for (let i = 1; i <= 12; i++) {
    const t = sp.tLast + i, m = monthOf(t), year = yearOf(t);
    let k = 0, n = 0;
    for (let tt = t0; tt <= t1 && tt < arr.length; tt++) {
      if (monthOf(tt) !== m || !Number.isFinite(arr[tt])) continue;
      n++; if (arr[tt] > threshold) k++;
    }
    const p = (k + 1) / (n + 2);
    months.push({ m, year, k, n, p, critical: p >= critical });
  }
  let next: Outlook['next'] = null;
  const first = months.findIndex((x) => x.critical);
  if (first >= 0) {
    let last = first;
    while (last + 1 < months.length && months[last + 1].critical) last++;
    next = { from: months[first].m, to: months[last].m, n: Math.max(...months.map((x) => x.n)) };
  }
  return { threshold, years, months, next };
}
export function outlookText(o: Outlook): string {
  if (!o.next) return 'No month in the next 12 is likely to be high-activity (climatology, not a forecast).';
  const a = MONTH_ABBR[o.next.from - 1], b = MONTH_ABBR[o.next.to - 1];
  return `Next high-activity period: ${a === b ? a : `${a}\u2013${b}`} (based on ${o.next.n} years).`;
}

export interface AnomalyCell { m: number; year: number; z: number }
export function anomalies(arr: ArrayLike<number>, y0: number, y1: number, sp: Span): AnomalyCell[] {
  const out: AnomalyCell[] = [];
  for (let m = 1; m <= 12; m++) {
    const h = monthHistory(arr, m, y0, y1, sp);
    const med = median(h.values), md = Math.max(mad(h.values), Math.sqrt(Math.max(0, med)), 1); // floor: counts are Poisson-like
    h.years.forEach((year, i) => out.push({ m, year, z: robustZ(h.values[i], med, md, 3) }));
  }
  return out;
}

export interface SummaryInput { arr: ArrayLike<number>; y0: number; y1: number; sp: Span; partialDays: number; partialHist?: { t: number[]; v: number[] } | null }
export function buildSummary(inp: SummaryInput): string[] {
  const { arr, y0, y1, sp } = inp, out: string[] = [];
  const cl = climatology(arr, y0, y1, sp);
  const season = detectSeason(cl.median);
  if (!season) {
    out.push('Too few detections here to describe a fire season.');
  } else {
    const r = monthRanges(season.months);
    out.push(r.length === 1 && season.months.length === 1
      ? `Fire season here is concentrated in ${r[0]}.`
      : `Fire season here usually runs ${joinAnd(r)}, peaking in ${MONTH_ABBR[season.peak - 1]}.`);
  }
  const at = annualTotals(arr, y0, y1, sp);
  if (at.length >= 3) {
    const last = at[at.length - 1], med = median(at.map((a) => a.total));
    if (med > 0) {
      const pct = (last.total / med - 1) * 100;
      const rel = Math.abs(pct) < 3 ? 'in line with' : `${Math.round(Math.abs(pct))}% ${pct > 0 ? 'above' : 'below'}`;
      out.push(`${last.year} was ${rel} the ${at[0].year}–${last.year} median.`);
    }
  }
  const tm = thisMonthStats(arr, y0, y1, sp, inp.partialDays, inp.partialHist);
  if (tm) {
    const share = tm.days < daysInMonth(tm.year, tm.month) ? ` so far (${tm.days} days)` : '';
    out.push(`${MONTH_FULL[tm.month - 1]} ${tm.year}${share}: ${fmtN(tm.value)} detections${Number.isFinite(tm.rank) ? `, ${ordinal(tm.rank)} percentile` : ''}.`);
  }
  return out;
}

export interface Ytd { value: number; median: number; pct: number; months: number }
/** Year-to-date total over the complete months of the current year vs the same months of earlier years (within y0..y1). */
export function ytdStats(arr: ArrayLike<number>, sp: Span, y0: number, y1: number): Ytd | null {
  const Y = yearOf(sp.tLast), m = monthOf(sp.tLast) - 1; // current month is partial
  if (m < 1) return null;
  const sum = (y: number): number | null => {
    let s = 0;
    for (let k = 1; k <= m; k++) { const t = tFromYM(y, k); if (t < sp.tFirst || t >= arr.length || !Number.isFinite(arr[t])) return null; s += arr[t]; }
    return s;
  };
  const value = sum(Y);
  if (value === null) return null;
  const past: number[] = [];
  for (let y = y0; y <= Math.min(y1, Y - 1); y++) { const v = sum(y); if (v !== null) past.push(v); }
  if (!past.length) return null;
  const med = median(past);
  return { value, median: med, pct: med > 0 ? (value / med - 1) * 100 : NaN, months: m };
}
