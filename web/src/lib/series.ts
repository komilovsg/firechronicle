import { tFromDate } from './time';

export interface Meta {
  version: number; sample?: boolean; generated_at: string;
  region: { name: string; bbox: number[] }; h3_res: number;
  t_first: number; t_last: number; t_nrt_from: number; current_month_partial_days: number; units: string;
  sensors: Record<'modis' | 'snpp' | 'n20' | 'n21', { label: string; start: string; end: string }>;
  sources: { name: string; url: string; doi?: string }[];
  validation?: Record<string, unknown>;
  refresh?: Record<string, unknown>;
  cleaning?: Record<string, unknown>;
  data_through?: string;
}
/** lo/hi (old shape) or sdc/pv (new shape: correlated calibration sd per cell, Poisson variance per cell). */
export interface Monthly { c: number[]; t: number[]; modis: number[]; snpp: number[]; n20: number[]; n21: number[]; harm: number[]; lo?: number[]; hi?: number[]; sdc?: number[]; pv?: number[] }
export interface Region { id: string; name: string; t: number[]; modis: number[]; snpp: number[]; n20: number[]; n21: number[]; harm: number[]; lo: number[]; hi: number[]; naive?: number[] }

export interface SensorT { snppStart: number; snppEnd: number; n20Start: number; n21Start: number }
export function sensorTs(meta: Meta): SensorT {
  const g = (d: string, f: number) => tFromDate(d) ?? f;
  return {
    snppStart: g(meta.sensors.snpp.start, 144), snppEnd: g(meta.sensors.snpp.end, 322),
    n20Start: g(meta.sensors.n20.start, 219), n21Start: g(meta.sensors.n21.start, 278),
  };
}

/** Naive splice: MODIS before S-NPP starts (2012-01, t<144), S-NPP until the month it ended, NOAA-20 from that month on. */
export function naiveAt(t: number, o: { modis: number; snpp: number; n20: number }, snppEnd = 322, snppStart = 144): number {
  if (t < snppStart) return o.modis;
  return t >= snppEnd ? o.n20 : o.snpp;
}

const KEYS = ['modis', 'snpp', 'n20', 'n21', 'harm', 'lo', 'hi'] as const;
export type Key = (typeof KEYS)[number];
export interface Series {
  modis: Float64Array; snpp: Float64Array; n20: Float64Array; n21: Float64Array;
  harm: Float64Array; lo: Float64Array; hi: Float64Array; naive: Float64Array; viirs: Float64Array;
  nT: number;
}
export function emptySeries(nT: number): Series {
  const m = () => new Float64Array(nT);
  return { modis: m(), snpp: m(), n20: m(), n21: m(), harm: m(), lo: m(), hi: m(), naive: m(), viirs: m(), nT };
}
/** Fill derived series (naive, viirs) and mark months before t_first as NaN (no data). */
export function finalize(s: Series, meta: Meta): Series {
  const st = sensorTs(meta);
  for (let t = 0; t < s.nT; t++) {
    if (t < meta.t_first) {
      for (const k of KEYS) s[k][t] = NaN;
      s.naive[t] = NaN; s.viirs[t] = NaN;
      continue;
    }
    s.naive[t] = naiveAt(t, { modis: s.modis[t], snpp: s.snpp[t], n20: s.n20[t] }, st.snppEnd, st.snppStart);
    let sum = 0, n = 0;
    if (t >= st.snppStart && t <= st.snppEnd) { sum += s.snpp[t]; n++; }
    if (t >= st.n20Start) { sum += s.n20[t]; n++; }
    if (t >= st.n21Start) { sum += s.n21[t]; n++; }
    s.viirs[t] = n ? sum / n : NaN;
  }
  return s;
}
export function seriesFromRegion(r: Region, meta: Meta): Series {
  const s = emptySeries(meta.t_last + 1);
  for (let i = 0; i < r.t.length; i++) {
    const t = r.t[i];
    if (t < 0 || t >= s.nT) continue;
    for (const k of KEYS) s[k][t] = r[k][i];
  }
  return finalize(s, meta);
}

/** Row index grouped by cell and by month, built once. */
export class CellIndex {
  readonly cellStart: Int32Array; readonly byCell: Int32Array;
  readonly tStart: Int32Array; readonly byT: Int32Array;
  constructor(readonly m: Monthly, readonly nCells: number, readonly nT: number) {
    const n = m.c.length;
    const group = (keys: number[], size: number) => {
      const start = new Int32Array(size + 2);
      for (let i = 0; i < n; i++) start[keys[i] + 1]++;
      for (let i = 0; i < size + 1; i++) start[i + 1] += start[i];
      const fill = start.slice(0, size + 1), order = new Int32Array(n);
      for (let i = 0; i < n; i++) order[fill[keys[i]]++] = i;
      return { start, order };
    };
    const a = group(m.c, nCells), b = group(m.t, nT);
    this.cellStart = a.start; this.byCell = a.order; this.tStart = b.start; this.byT = b.order;
  }
  aggregate(cells: ArrayLike<number>, meta: Meta): Series {
    const s = emptySeries(this.nT), m = this.m;
    const useSd = !!(m.sdc && m.pv);
    const sdSum = useSd ? new Float64Array(this.nT) : null, pvSum = useSd ? new Float64Array(this.nT) : null;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      for (let j = this.cellStart[c]; j < this.cellStart[c + 1]; j++) {
        const r = this.byCell[j], t = m.t[r];
        if (t >= this.nT) continue;
        s.modis[t] += m.modis[r]; s.snpp[t] += m.snpp[r]; s.n20[t] += m.n20[r]; s.n21[t] += m.n21[r];
        s.harm[t] += m.harm[r];
        if (useSd) { sdSum![t] += m.sdc![r]; pvSum![t] += m.pv![r]; } else if (m.lo && m.hi) { s.lo[t] += m.lo[r]; s.hi[t] += m.hi[r]; }
      }
    }
    if (useSd) {
      // calibration error is correlated across cells (sum linearly); counting noise is independent (sum variances)
      for (let t = 0; t < this.nT; t++) {
        const sd = Math.sqrt(sdSum![t] * sdSum![t] + pvSum![t]);
        s.lo[t] = Math.max(0, s.harm[t] - 1.645 * sd); s.hi[t] = s.harm[t] + 1.645 * sd;
      }
    }
    return finalize(s, meta);
  }
  /** Harmonized value per cellIdx for one month (0 where no row), only cells in mask. */
  frame(t: number, mask: Uint8Array, key: Key = 'harm'): Float64Array {
    const out = new Float64Array(this.nCells);
    if (t < 0 || t >= this.nT) return out;
    for (let j = this.tStart[t]; j < this.tStart[t + 1]; j++) {
      const r = this.byT[j], c = this.m.c[r];
      if (mask[c]) out[c] = this.m[key]?.[r] ?? 0;
    }
    return out;
  }
  /** Sum per cellIdx over months t0..t1 inclusive. */
  period(t0: number, t1: number, cells: ArrayLike<number>, key: Key = 'harm'): Float64Array {
    const out = new Float64Array(this.nCells);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      for (let j = this.cellStart[c]; j < this.cellStart[c + 1]; j++) {
        const r = this.byCell[j], t = this.m.t[r];
        if (t >= t0 && t <= t1) out[c] += this.m[key]?.[r] ?? 0;
      }
    }
    return out;
  }
}
