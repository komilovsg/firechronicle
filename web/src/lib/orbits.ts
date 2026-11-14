// Imported by file: the package index also re-exports the WASM build, which the browser bundle does not need.
import { twoline2satrec } from '../../node_modules/satellite.js/dist/io.js';
import { propagate, gstime } from '../../node_modules/satellite.js/dist/propagation.js';
import { eciToGeodetic, degreesLat, degreesLong } from '../../node_modules/satellite.js/dist/transforms.js';
import type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';

export interface TleSat { id: string; name: string; norad: number; instrument: string; swath_km: number; tle1: string; tle2: string }
export interface Tle { source: string; fetched_at: string; satellites: TleSat[] }
export interface LL { lat: number; lon: number }
const R = 6371, D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Validate the optional tle.json; null when unusable. */
export function parseTle(j: unknown): Tle | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Partial<Tle>;
  if (!Array.isArray(o.satellites) || typeof o.fetched_at !== 'string') return null;
  const sats = o.satellites.filter((s) => s && typeof s.id === 'string' && typeof s.tle1 === 'string' && typeof s.tle2 === 'string' && Number.isFinite(s.swath_km));
  return sats.length ? { source: String(o.source ?? ''), fetched_at: o.fetched_at, satellites: sats } : null;
}
export const makeRec = (s: TleSat): SatRec => twoline2satrec(s.tle1, s.tle2);

/** Sub-satellite point (degrees) at `date`, or null when SGP4 fails. */
export function subPoint(rec: SatRec, date: Date): LL | null {
  const pv = propagate(rec, date);
  if (!pv || typeof pv.position === 'boolean') return null;
  const g = eciToGeodetic(pv.position, gstime(date));
  const lon = ((degreesLong(g.longitude) + 540) % 360) - 180;
  return { lat: degreesLat(g.latitude), lon };
}
/** Great-circle distance in km. */
export function distKm(a: LL, b: LL): number {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Initial bearing a -> b in degrees. */
export function bearing(a: LL, b: LL): number {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360;
}
/** Point `km` from `a` along bearing `brg` (degrees). */
export function destination(a: LL, brg: number, km: number): LL {
  const d = km / R, t = brg * D2R, p1 = a.lat * D2R, l1 = a.lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
}
/** Ground track from -before to +after minutes around `date`, split where it crosses the antimeridian. */
export function groundTrack(rec: SatRec, date: Date, before = 50, after = 50, stepSec = 30): LL[][] {
  const segs: LL[][] = []; let cur: LL[] = [];
  for (let s = -before * 60; s <= after * 60; s += stepSec) {
    const p = subPoint(rec, new Date(date.getTime() + s * 1000)); if (!p) continue;
    const last = cur[cur.length - 1];
    if (last && Math.abs(p.lon - last.lon) > 180) { segs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}
/** Swath band: polygon rings centred on the track, `swathKm` wide, built by offsetting each point perpendicular to the direction of motion. */
export function swathRings(track: LL[], swathKm: number): LL[][] {
  if (track.length < 2) return [];
  const left: LL[] = [], right: LL[] = [], h = swathKm / 2;
  for (let i = 0; i < track.length; i++) {
    const a = track[Math.max(0, i - 1)], b = track[Math.min(track.length - 1, i + 1)], brg = bearing(a, b);
    left.push(destination(track[i], brg - 90, h)); right.push(destination(track[i], brg + 90, h));
  }
  return [[...left, ...right.reverse(), left[0]]];
}
/** Cross-track distance (km, absolute) of point `p` from the great circle through `a` heading to `b`. */
export function crossTrackKm(a: LL, b: LL, p: LL): number {
  const d13 = distKm(a, p) / R, t13 = bearing(a, p) * D2R, t12 = bearing(a, b) * D2R;
  return Math.abs(Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R);
}
/** True when the sub-satellite point at `date` is within half a swath of `p`. */
export function swathCovers(rec: SatRec, date: Date, p: LL, swathKm: number): boolean {
  const s = subPoint(rec, date); return !!s && distKm(s, p) <= swathKm / 2;
}
export interface Pass { time: Date; minKm: number }
/** Passes in the next `hours` for which the swath covers `p`: local minima of the sub-point distance found on a 30 s grid, refined to 1 s. */
export function nextPasses(rec: SatRec, p: LL, from: Date, swathKm: number, hours = 24, stepSec = 30): Pass[] {
  const out: Pass[] = [], t0 = from.getTime(), n = Math.ceil((hours * 3600) / stepSec);
  const dist = (t: number): number => { const s = subPoint(rec, new Date(t)); return s ? distKm(s, p) : Infinity; };
  let prev = dist(t0 - stepSec * 1000), cur = dist(t0), prevT = t0;
  for (let i = 1; i <= n + 1; i++) {
    const t = t0 + i * stepSec * 1000, next = dist(t);
    if (cur <= prev && cur < next && cur < swathKm) {
      let lo = prevT - stepSec * 1000, hi = t; // ternary refine on [lo, hi]
      for (let k = 0; k < 12 && hi - lo > 1000; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (dist(m1) < dist(m2)) hi = m2; else lo = m1; }
      const tm = (lo + hi) / 2, dm = dist(tm);
      if (dm <= swathKm / 2 && tm >= t0 - 1000 && tm <= t0 + hours * 3600 * 1000) out.push({ time: new Date(tm), minKm: dm });
    }
    prev = cur; cur = next; prevT = prevT + stepSec * 1000;
  }
  return out;
}
