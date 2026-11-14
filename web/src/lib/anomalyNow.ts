import type { CellIndex } from './series';

export interface CellAnomaly {
  /** Percentile (0..100, mid-rank) of the target month among the same calendar month of earlier years; NaN = not enough history. */
  pct: Float64Array;
  /** Number of earlier years in which the cell had detections in that calendar month. */
  nYears: Int16Array;
  /** Harmonized value of the cell in the target month. */
  value: Float64Array;
  /** Number of earlier years compared (all years since tFirst, zeros included). */
  nPast: number;
}
/** Months with fewer than this many earlier years of detections are "not enough history". */
export const MIN_YEARS = 5;

/** Percentile of each cell's target month against its own earlier same-calendar-month values. Years without a row count as zero. */
export function anomalyNow(idx: CellIndex, cells: ArrayLike<number>, tTarget: number, tFirst: number, minYears = MIN_YEARS): CellAnomaly {
  const n = idx.nCells, m = idx.m;
  const pct = new Float64Array(n).fill(NaN), nYears = new Int16Array(n), value = new Float64Array(n);
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
  }
  return { pct, nYears, value, nPast };
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
