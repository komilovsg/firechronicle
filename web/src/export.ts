import { latLngToCell } from 'h3-js';
import { buildCsv, csvRow } from './lib/csv';
import { tLabel, tFromYM } from './lib/time';
import type { Series } from './lib/series';

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function seriesCsv(s: Series, y0: number, y1: number, tFirst: number, tLast: number): string {
  const rows: (string | number)[][] = [];
  for (let t = Math.max(tFirst, tFromYM(y0, 1)); t <= Math.min(tLast, tFromYM(y1, 12)); t++) {
    const r = (x: number) => Math.round(x * 100) / 100;
    rows.push([tLabel(t), s.modis[t], s.snpp[t], s.n20[t], s.n21[t], s.naive[t], r(s.harm[t]), r(s.lo[t]), r(s.hi[t])]);
  }
  return buildCsv(['t', 'modis', 'snpp', 'n20', 'n21', 'naive', 'harm', 'lo', 'hi'], rows);
}
export interface PointsResult { csv: string; rows: number; missing: number[] }
/** Stream points/{year}.csv.gz, keep rows whose H3 cell is in the AOI and whose date is in range. */
export async function pointsCsv(cells: Set<string>, res: number, y0: number, y1: number, onProgress: (done: number, total: number, rows: number) => void): Promise<PointsResult> {
  const header = 'date,time,lat,lon,satellite,instrument,confidence,frp,daynight,type,processing,country'.split(',');
  const out: string[] = [csvRow(header)], missing: number[] = [];
  const lo = `${y0}-01-01`, hi = `${y1}-12-31`, total = y1 - y0 + 1;
  for (let y = y0; y <= y1; y++) {
    onProgress(y - y0, total, out.length - 1);
    const r = await fetch(`./data/points/${y}.csv.gz`).catch(() => null);
    if (!r || !r.ok || !r.body) { missing.push(y); continue; }
    // some static hosts already send Content-Encoding: gzip, and then fetch() has decoded the body
    const already = /gzip/i.test(r.headers.get('content-encoding') ?? '');
    const raw = already ? r.body : r.body.pipeThrough(new DecompressionStream('gzip'));
    const reader = raw.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '', first = true;
    const handle = (line: string) => {
      if (!line) return;
      if (first) { first = false; if (line.startsWith('date,')) return; }
      const f = line.split(',');
      if (f.length < 11 || f[0] < lo || f[0] > hi) return;
      const lat = Number(f[2]), lon = Number(f[3]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (!cells.has(latLngToCell(lat, lon, res))) return;
      out.push(csvRow([...f.slice(0, 11), f[11] ?? '']));  // country: ISO3, empty in older files
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value; const parts = buf.split('\n'); buf = parts.pop() ?? '';
      for (const p of parts) handle(p.replace(/\r$/, ''));
    }
    handle(buf.replace(/\r$/, ''));
  }
  onProgress(total, total, out.length - 1);
  return { csv: out.join('\r\n') + '\r\n', rows: out.length - 1, missing };
}

import type { Meta, Region } from './lib/series';
/** Every region's monthly series (raw per sensor, naive, harmonized, band) in one long CSV. */
export function regionsCsv(regions: Region[], meta: Meta, toSeries: (r: Region, m: Meta) => Series): string {
  const rows: (string | number)[][] = [];
  for (const r of regions) {
    const s = toSeries(r, meta), q = (x: number) => Math.round(x * 100) / 100;
    for (let t = meta.t_first; t <= meta.t_last; t++) rows.push([r.id, tLabel(t), s.modis[t], s.snpp[t], s.n20[t], s.n21[t], s.naive[t], q(s.harm[t]), q(s.lo[t]), q(s.hi[t])]);
  }
  return buildCsv(['region', 't', 'modis', 'snpp', 'n20', 'n21', 'naive', 'harm', 'lo', 'hi'], rows);
}
