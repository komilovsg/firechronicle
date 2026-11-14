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

export interface ThisMonth { year: number; month: number; value: number; fraction: number; days: number; hist: number[]; histYears: number[]; median: number; p10: number; p90: number; pctVsMedian: number; rank: number }
/** Current (partial) month vs the same calendar month of earlier years, history pro-rated by fraction of the month elapsed. */
export function thisMonthStats(arr: ArrayLike<number>, y0: number, y1: number, sp: Span, partialDays: number): ThisMonth | null {
  const y = yearOf(sp.tLast), m = monthOf(sp.tLast), dim = daysInMonth(y, m);
  const value = arr[sp.tLast];
  const fraction = Math.min(1, Math.max(0.01, partialDays / dim));
  const h = monthHistory(arr, m, y0, Math.min(y1, y - 1), sp);
  if (!Number.isFinite(value) || !h.values.length) return null;
  const hist = h.values.map((v) => v * fraction);
  const med = median(hist);
  return { year: y, month: m, value, fraction, days: partialDays, hist, histYears: h.years, median: med, p10: percentile(hist, 10), p90: percentile(hist, 90), pctVsMedian: med > 0 ? (value / med - 1) * 100 : NaN, rank: rankPercentile(value, hist) };
}
export const ordinal = (n: number): string => {
  const k = Math.round(n), r = k % 100;
  const s = r >= 11 && r <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[k % 10] ?? 'th';
  return `${k}${s}`;
};
const fmtN = (x: number): string => Math.round(x).toLocaleString('en-US');

export interface Outlook { threshold: number; months: { m: number; year: number; k: number; n: number; p: number; critical: boolean }[]; next: { from: number; to: number; n: number } | null }
/** Climatological probability that a month exceeds the pooled long-term monthly P75; p = (k+1)/(n+2). Not a forecast. */
export function outlook(arr: ArrayLike<number>, sp: Span, pct = 75, critical = 0.5): Outlook {
  const pooled: number[] = [];
  for (let t = sp.tFirst; t < sp.tLast && t < arr.length; t++) if (Number.isFinite(arr[t])) pooled.push(arr[t]);
  const threshold = percentile(pooled, pct);
  const months: Outlook['months'] = [];
  for (let i = 1; i <= 12; i++) {
    const t = sp.tLast + i, m = monthOf(t), year = yearOf(t);
    let k = 0, n = 0;
    for (let tt = sp.tFirst; tt < sp.tLast && tt < arr.length; tt++) {
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
  return { threshold, months, next };
}
export function outlookText(o: Outlook): string {
  if (!o.next) return 'No month in the next 12 is above 50% likelihood of a high-activity month (climatology, not a forecast).';
  const a = MONTH_ABBR[o.next.from - 1], b = MONTH_ABBR[o.next.to - 1];
  return `Next critical period: ${a === b ? a : `${a}–${b}`} (based on ${o.next.n} years).`;
}

export interface AnomalyCell { m: number; year: number; z: number }
export function anomalies(arr: ArrayLike<number>, y0: number, y1: number, sp: Span): AnomalyCell[] {
  const out: AnomalyCell[] = [];
  for (let m = 1; m <= 12; m++) {
    const h = monthHistory(arr, m, y0, y1, sp);
    const med = median(h.values), md = mad(h.values);
    h.years.forEach((year, i) => out.push({ m, year, z: robustZ(h.values[i], med, md, 3) }));
  }
  return out;
}

export interface SummaryInput { arr: ArrayLike<number>; y0: number; y1: number; sp: Span; partialDays: number }
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
  const tm = thisMonthStats(arr, y0, y1, sp, inp.partialDays);
  if (tm) {
    const share = tm.fraction < 1 ? ` so far (${tm.days} days)` : '';
    out.push(`${MONTH_FULL[tm.month - 1]} ${tm.year}${share}: ${fmtN(tm.value)} detections${Number.isFinite(tm.rank) ? `, ${ordinal(tm.rank)} percentile` : ''}.`);
  }
  return out;
}
