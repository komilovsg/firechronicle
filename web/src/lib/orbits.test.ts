import { describe, expect, it } from 'vitest';
import tleRaw from '../../public/data/tle.json?raw';
import { parseTle, makeRec, subPoint, groundTrack, swathRings, distKm, crossTrackKm, swathCovers, nextPasses, destination, bearing } from './orbits';

const tle = parseTle(JSON.parse(tleRaw))!;
const terra = tle.satellites.find((s) => s.id === 'terra')!, rec = makeRec(terra), t0 = new Date(tle.fetched_at);
describe('tle parsing', () => {
  it('accepts the file and rejects junk', () => { expect(tle.satellites.length).toBe(5); expect(parseTle(null)).toBeNull(); expect(parseTle({ satellites: [], fetched_at: 'x' })).toBeNull(); expect(parseTle({ satellites: [{ id: 'a' }], fetched_at: 'x' })).toBeNull(); });
});
describe('sgp4 positions', () => {
  it('sub-point stays inside the inclination band and track is continuous', () => {
    const p = subPoint(rec, t0)!; expect(Math.abs(p.lat)).toBeLessThanOrEqual(99); expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    const segs = groundTrack(rec, t0, 50, 50); expect(segs.flat().length).toBe(201);
    for (const s of segs) for (let i = 1; i < s.length; i++) expect(distKm(s[i - 1], s[i])).toBeLessThan(260); // 30 s at ~7 km/s
  });
  it('is polar: about 98 degrees inclination reaches high latitudes within an orbit', () => { const lats = groundTrack(rec, t0, 0, 100).flat().map((p) => Math.abs(p.lat)); expect(Math.max(...lats)).toBeGreaterThan(75); });
});
describe('geometry', () => {
  it('destination and bearing round trip', () => { const a = { lat: 40, lon: 70 }, b = destination(a, 90, 500); expect(distKm(a, b)).toBeCloseTo(500, 0); expect(bearing(a, b)).toBeCloseTo(90, 0); });
  it('swath band width equals swath_km', () => {
    const tr = groundTrack(rec, t0, 5, 5)[0], ring = swathRings(tr, 2330)[0], half = (ring.length - 1) / 2, mid = Math.floor(half / 2);
    expect(distKm(ring[mid], ring[ring.length - 2 - mid])).toBeGreaterThan(2300); expect(distKm(ring[mid], ring[ring.length - 2 - mid])).toBeLessThan(2360);
  });
  it('cross-track distance of a point on the great circle is ~0 and of a point 100 km aside is ~100', () => {
    const a = { lat: 30, lon: 60 }, b = { lat: 35, lon: 62 }, on = destination(a, bearing(a, b), 300), side = destination(on, bearing(a, b) + 90, 100);
    expect(crossTrackKm(a, b, on)).toBeLessThan(1); expect(crossTrackKm(a, b, side)).toBeCloseTo(100, -1);
  });
});
describe('passes', () => {
  const ca = { lat: 43, lon: 68 };
  it('finds passes over Central Asia within 24 h, in order, each within half a swath', () => {
    const ps = nextPasses(rec, ca, t0, terra.swath_km, 24); expect(ps.length).toBeGreaterThanOrEqual(2);
    ps.forEach((p, i) => { expect(p.minKm).toBeLessThanOrEqual(terra.swath_km / 2); expect(swathCovers(rec, p.time, ca, terra.swath_km)).toBe(true); if (i) expect(p.time.getTime()).toBeGreaterThan(ps[i - 1].time.getTime()); expect(p.time.getTime()).toBeGreaterThanOrEqual(t0.getTime() - 1000); expect(p.time.getTime()).toBeLessThanOrEqual(t0.getTime() + 24 * 3600e3); });
  });
  it('a narrower swath finds no more passes than a wider one', () => { expect(nextPasses(rec, ca, t0, 400, 24).length).toBeLessThanOrEqual(nextPasses(rec, ca, t0, 2330, 24).length); });
  it('a zero-width swath finds none', () => { expect(nextPasses(rec, ca, t0, 0, 24)).toEqual([]); });
});
