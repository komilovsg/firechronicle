export interface View { center: [number, number]; zoom: number; pitch: number; bearing: number }
/** Web-Mercator pixel position of lon/lat at a zoom (256 px tiles). */
export function mercatorPx(lon: number, lat: number, zoom: number): [number, number] {
  const s = 256 * 2 ** zoom, la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return [((lon + 180) / 360) * s, (0.5 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / (2 * Math.PI)) * s];
}
const angDiff = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);
/** True when the camera has left the default view: zoom off by > 0.3, centre moved > 10% of the viewport, or pitch/bearing changed. */
export function hasDrifted(cur: View, def: View, vw: number, vh: number): boolean {
  if (Math.abs(cur.zoom - def.zoom) > 0.3) return true;
  if (Math.abs(cur.pitch - def.pitch) > 1 || angDiff(cur.bearing, def.bearing) > 1) return true;
  const a = mercatorPx(cur.center[0], cur.center[1], cur.zoom), b = mercatorPx(def.center[0], def.center[1], cur.zoom);
  return Math.abs(a[0] - b[0]) > 0.1 * vw || Math.abs(a[1] - b[1]) > 0.1 * vh;
}
