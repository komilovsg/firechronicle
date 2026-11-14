import { parsePolygon, type AoiSpec } from './hash';

/** Second area for compare mode, stored as b=... in the location hash (same grammar as the main area). */
export function encodeCmp(a: AoiSpec | null): string {
  if (!a) return '';
  const r4 = (x: number): string => String(Math.round(x * 10000) / 10000);
  if (a.kind === 'region') return 'b=' + a.id;
  if (a.kind === 'polygon') return 'b=p:' + a.pts.map(([x, y]) => `${r4(x)},${r4(y)}`).join(';');
  return `b=c:${r4(a.lat)},${r4(a.lon)},${r4(a.r)}`;
}
export function parseCmp(hash: string): AoiSpec | null {
  if (typeof hash !== 'string' || hash.length > 8000) return null;
  const b = new URLSearchParams(hash.replace(/^#/, '')).get('b');
  if (!b) return null;
  if (b.startsWith('p:')) { const pts = parsePolygon(b.slice(2)); return pts ? { kind: 'polygon', pts } : null; }
  if (b.startsWith('c:')) {
    const f = b.slice(2).split(',');
    if (f.length !== 3 || !f.every((x) => /^-?\d+(\.\d+)?$/.test(x))) return null;
    const [lat, lon, r] = f.map(Number);
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && r >= 1 && r <= 500 ? { kind: 'circle', lat, lon, r } : null;
  }
  return /^[A-Za-z0-9-]{2,20}$/.test(b) ? { kind: 'region', id: b } : null;
}
