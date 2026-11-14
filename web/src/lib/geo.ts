export type Pt = [number, number]; // [lon, lat]
export function pointInPolygon(lon: number, lat: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** A polygon as [outer ring, ...holes]. */
export type Poly = Pt[][];

/** GeoJSON Polygon or MultiPolygon → list of polygons. Many countries are MultiPolygons. */
export function geometryPolys(g: { type: string; coordinates: unknown }): Poly[] {
  return g.type === 'MultiPolygon' ? (g.coordinates as Poly[]) : [g.coordinates as Poly];
}

/** Inside any polygon's outer ring and outside all of that polygon's holes. */
export function pointInPolys(lon: number, lat: number, polys: Poly[]): boolean {
  return polys.some((p) => pointInPolygon(lon, lat, p[0]) && !p.slice(1).some((h) => pointInPolygon(lon, lat, h)));
}

export function circlePolygon(lat: number, lon: number, rKm: number, n = 64): Pt[] {
  const R = 6371, d = rKm / R, la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const b = (2 * Math.PI * i) / n;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    out.push([(((lo2 * 180) / Math.PI + 540) % 360) - 180, (la2 * 180) / Math.PI]);
  }
  return out;
}
export function bboxOf(ring: Pt[]): [number, number, number, number] {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
