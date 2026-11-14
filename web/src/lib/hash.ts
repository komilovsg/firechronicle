import type { Pt } from './geo';

export type CalMode = 'harm' | 'modis' | 'viirs' | 'naive' | 'swipe';
export const CAL_MODES: CalMode[] = ['harm', 'modis', 'viirs', 'naive', 'swipe'];
export type AoiSpec = { kind: 'region'; id: string } | { kind: 'polygon'; pts: Pt[] } | { kind: 'circle'; lat: number; lon: number; r: number };
export interface HashState { aoi: AoiSpec; y0: number; y1: number; mode: CalMode }

export const MAX_VERTS = 200;
const MAX_LEN = 8000;
const num = (s: string): number | null => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null);
const r4 = (x: number): string => String(Math.round(x * 10000) / 10000);

export function encodeHash(s: HashState): string {
  const p: string[] = [];
  if (s.aoi.kind === 'region') p.push('a=' + s.aoi.id);
  else if (s.aoi.kind === 'polygon') p.push('p=' + s.aoi.pts.map(([x, y]) => `${r4(x)},${r4(y)}`).join(';'));
  else p.push(`c=${r4(s.aoi.lat)},${r4(s.aoi.lon)},${r4(s.aoi.r)}`);
  p.push(`y=${s.y0}-${s.y1}`, `m=${s.mode}`);
  return '#' + p.join('&');
}
export function parsePolygon(v: string): Pt[] | null {
  const parts = v.split(';');
  if (parts.length < 3 || parts.length > MAX_VERTS) return null;
  const pts: Pt[] = [];
  for (const q of parts) {
    const [a, b, ...rest] = q.split(',');
    if (rest.length || a === undefined || b === undefined) return null;
    const lon = num(a), lat = num(b);
    if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    pts.push([lon, lat]);
  }
  return pts;
}
/** Parse and validate a location hash. Invalid or out-of-range parts are omitted (caller falls back to defaults). */
export function parseHash(hash: string): Partial<HashState> {
  const out: Partial<HashState> = {};
  if (typeof hash !== 'string' || hash.length > MAX_LEN) return out;
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const a = q.get('a'), p = q.get('p'), c = q.get('c'), y = q.get('y'), m = q.get('m');
  if (a !== null && /^[A-Za-z0-9-]{2,20}$/.test(a)) out.aoi = { kind: 'region', id: a };
  else if (p !== null) { const pts = parsePolygon(p); if (pts) out.aoi = { kind: 'polygon', pts }; }
  else if (c !== null) {
    const f = c.split(',');
    if (f.length === 3) {
      const lat = num(f[0]), lon = num(f[1]), r = num(f[2]);
      if (lat !== null && lon !== null && r !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && r >= 1 && r <= 500) out.aoi = { kind: 'circle', lat, lon, r };
    }
  }
  if (y !== null) {
    const mm = /^(\d{4})-(\d{4})$/.exec(y);
    if (mm) { const y0 = +mm[1], y1 = +mm[2]; if (y0 >= 2000 && y1 <= 2100 && y0 <= y1) { out.y0 = y0; out.y1 = y1; } }
  }
  if (m !== null && (CAL_MODES as string[]).includes(m)) out.mode = m as CalMode;
  return out;
}
