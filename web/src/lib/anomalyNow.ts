import type { CellIndex } from './series';
import { mad, median, percentile } from './stats';
import { MONTH_FULL, monthOf, yearOf } from './time';
import { ordinal } from './analytics';

export interface CellAnomaly {
  /** Percentile (0..100, mid-rank) of the target month among the same calendar month of earlier years; NaN = not enough history. */
  pct: Float64Array;
  /** Number of earlier years in which the cell had detections in that calendar month. */
  nYears: Int16Array;
  /** Harmonized value of the cell in the target month. */
  value: Float64Array;
  /** Number of earlier years compared (all years since tFirst, zeros included). */
  nPast: number;
  /** Per cell, over the earlier years (zeros included): median, 75th percentile, raw MAD and the highest value. */
  med: Float64Array; p75: Float64Array; madv: Float64Array; max: Float64Array;
}
/** Months with fewer than this many earlier years of detections are "not enough history". */
export const MIN_YEARS = 5;

/** Percentile of each cell's target month against its own earlier same-calendar-month values. Years without a row count as zero. */
export function anomalyNow(idx: CellIndex, cells: ArrayLike<number>, tTarget: number, tFirst: number, minYears = MIN_YEARS): CellAnomaly {
  const n = idx.nCells, m = idx.m;
  const pct = new Float64Array(n).fill(NaN), nYears = new Int16Array(n), value = new Float64Array(n);
  const med = new Float64Array(n), p75 = new Float64Array(n), madv = new Float64Array(n), max = new Float64Array(n);
  const nPast = Math.max(0, Math.floor((tTarget - tFirst) / 12));
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    let val = 0, withData = 0;
    const hist: number[] = [];
    for (let j = idx.cellStart[c]; j < idx.cellStart[c + 1]; j++) {
      const r = idx.byCell[j], t = m.t[r];
      if (t === tTarget) val = m.harm[r];
      else if (t < tTarget && t >= tFirst && (tTarget - t) % 12 === 0 && m.harm[r] > 0) { hist.push(m.harm[r]); withData++; }
    }
    value[c] = val; nYears[c] = withData;
    if (withData < minYears || nPast === 0) continue;
    const zeros = nPast - withData;
    let less = 0, eq = 0;
    if (val > 0) { less = zeros; for (const h of hist) { if (h < val) less++; else if (h === val) eq++; } }
    else { eq = zeros; }
    pct[c] = ((less + 0.5 * eq) / nPast) * 100;
    const all = hist.concat(new Array(zeros).fill(0));
    med[c] = median(all); p75[c] = percentile(all, 75); madv[c] = mad(all); max[c] = Math.max(0, ...hist);
  }
  return { pct, nYears, value, nPast, med, p75, madv, max };
}

export interface Unusual { cell: number; pct: number; value: number }
/** Highest-percentile cells (value > 0, enough history), most unusual first. */
export function topUnusual(a: CellAnomaly, cells: ArrayLike<number>, k = 5): Unusual[] {
  const out: Unusual[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (Number.isFinite(a.pct[c]) && a.value[c] > 0) out.push({ cell: c, pct: a.pct[c], value: a.value[c] });
  }
  out.sort((x, y) => y.pct - x.pct || y.value - x.value);
  return out.slice(0, k);
}
/** Colour bin: 0 well below, 1 below, 2 normal, 3 above, 4 extreme (>= 95th); -1 = not enough history. */
export function anomalyBin(p: number): number {
  if (!Number.isFinite(p)) return -1;
  return p < 10 ? 0 : p < 25 ? 1 : p < 75 ? 2 : p < 95 ? 3 : 4;
}

export interface Ranked { cell: number; pct: number; value: number; median: number; z: number; record: boolean }
export interface RankOptions { k?: number; minCount?: number; maxPerGroup?: number; groupOf?: (cell: number) => string }
/** Cells that may appear in the list: >= 5 past years with data and a count of at least max(minCount, own P75). Ranked by percentile, then robust z, then value. */
export function eligibleUnusual(a: CellAnomaly, cells: ArrayLike<number>, minCount = 10): Ranked[] {
  const out: Ranked[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!Number.isFinite(a.pct[c])) continue;
    const v = a.value[c];
    if (!(v >= Math.max(minCount, a.p75[c]))) continue;
    out.push({ cell: c, pct: a.pct[c], value: v, median: a.med[c], z: (v - a.med[c]) / Math.max(a.madv[c] * 1.4826, 1), record: v >= a.max[c] && v > 0 });
  }
  out.sort((x, y) => y.pct - x.pct || y.z - x.z || y.value - x.value);
  return out;
}
/** Top list with per-group diversity (default: at most 2 per country in the top 5; remaining slots are filled with the next best). Empty when fewer than 3 cells qualify. */
export function rankUnusual(a: CellAnomaly, cells: ArrayLike<number>, o: RankOptions = {}): { list: Ranked[]; eligible: number } {
  const k = o.k ?? 5, cap = o.maxPerGroup ?? 2, el = eligibleUnusual(a, cells, o.minCount ?? 10);
  if (el.length < 3) return { list: [], eligible: el.length };
  const list: Ranked[] = [], used = new Set<number>(), count = new Map<string, number>();
  for (const r of el) {
    if (list.length >= k) break;
    const g = o.groupOf ? o.groupOf(r.cell) : '';
    if ((count.get(g) ?? 0) >= cap) continue;
    list.push(r); used.add(r.cell); count.set(g, (count.get(g) ?? 0) + 1);
  }
  for (const r of el) { if (list.length >= k) break; if (!used.has(r.cell)) { list.push(r); used.add(r.cell); } }
  return { list, eligible: el.length };
}
/** First year in which a calendar month (1..12) has data, given the first data month tFirst. */
export function firstYearOfMonth(tFirst: number, month: number): number {
  return monthOf(tFirst) <= month ? yearOf(tFirst) : yearOf(tFirst) + 1;
}
const fmt0 = (x: number): string => String(Math.round(x));
/** Never says "100th": records read "Highest October since 2001 (21 vs median 3)", others "92nd percentile \u00b7 21 vs median 8". */
export function unusualText(r: Ranked, targetT: number, tFirst: number): string {
  const m = monthOf(targetT);
  if (r.record) return `Highest ${MONTH_FULL[m - 1]} since ${firstYearOfMonth(tFirst, m)} (${fmt0(r.value)} vs median ${fmt0(r.median)})`;
  return `${ordinal(Math.min(99, Math.max(1, Math.round(r.pct))))} percentile \u00b7 ${fmt0(r.value)} vs median ${fmt0(r.median)}`;
}
export const unusualBadge = (r: Ranked): string => (r.record ? 'Record' : `${ordinal(Math.min(99, Math.max(1, Math.round(r.pct))))} pct`);
export const noUnusualText = (targetT: number): string => `No unusual activity in ${MONTH_FULL[monthOf(targetT) - 1]} \u2014 most areas are near or below their usual level.`;
