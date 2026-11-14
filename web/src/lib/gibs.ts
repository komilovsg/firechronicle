/** NASA GIBS (EPSG:3857, "best") imagery products and tile URLs. Layer ids and ranges verified against WMTSCapabilities. */
export const BM_IDS = ['mono', 'color', 'sat', 'relief', 'night'] as const;
export type BmId = (typeof BM_IDS)[number];
export function parseBm(hash: string): BmId | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('bm');
  return v && (BM_IDS as readonly string[]).includes(v) ? (v as BmId) : null;
}
export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export interface Product { layer: string; label: string; tms: string; maxzoom: number; ext: string; time: string | null }
const P = (layer: string, label: string, level: number, ext: string, time: string | null): Product => ({ layer, label, tms: `GoogleMapsCompatible_Level${level}`, maxzoom: level, ext, time });
export const FIRST_IMAGERY = '2000-02-24';       // MODIS Terra true colour starts
const SNPP_FROM = '2015-11-24';                   // VIIRS S-NPP true colour starts in GIBS
const N20_FROM = '2018-01-05';                    // VIIRS NOAA-20 true colour starts
export const RELIEF = P('ASTER_GDEM_Color_Shaded_Relief', 'ASTER GDEM shaded relief', 12, 'jpg', null);
export const NIGHT = P('VIIRS_Black_Marble', 'VIIRS Black Marble night lights, 2016', 8, 'png', '2016-01-01');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: string): boolean => ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export function addDays(d: string, n: number): string { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
export const yesterday = (now: Date): string => addDays(now.toISOString().slice(0, 10), -1);
/** Clamp an imagery date into [first imagery day, yesterday]. */
export function clampImageryDate(d: string, now: Date): string {
  const hi = yesterday(now);
  return d < FIRST_IMAGERY ? FIRST_IMAGERY : d > hi ? hi : d;
}
/** True-colour product for a day: Terra before S-NPP imagery exists, S-NPP, then NOAA-20. */
export function gibsProduct(date: string): Product {
  if (date >= N20_FROM) return P('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'VIIRS NOAA-20', 9, 'jpg', date);
  if (date >= SNPP_FROM) return P('VIIRS_SNPP_CorrectedReflectance_TrueColor', 'VIIRS S-NPP', 9, 'jpg', date);
  return P('MODIS_Terra_CorrectedReflectance_TrueColor', 'MODIS Terra', 9, 'jpg', date);
}
export function tileUrl(p: Product): string {
  return `${GIBS}/${p.layer}/default/${p.time ? p.time + '/' : ''}${p.tms}/{z}/{y}/{x}.${p.ext}`;
}
/** 15th of month t (t = 0 is 2000-01). */
export function monthMid(t: number): string { return `${2000 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-15`; }
/** Imagery day synced to the app: manual override, else the 15th of the selected month, else the latest day. */
export function imageryDateFor(frameT: number | null, now: Date, manual: string | null): string {
  if (manual && isIsoDate(manual)) return clampImageryDate(manual, now);
  return clampImageryDate(frameT !== null ? monthMid(frameT) : yesterday(now), now);
}
