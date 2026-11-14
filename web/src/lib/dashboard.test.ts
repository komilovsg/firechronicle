import { describe, expect, it } from 'vitest';
import { parseRecent, last7, deltaChip, seasonStatus, sensorStatus, sortRows, statusOf, activeCells, type CountryRow, type Recent } from './dashboard';

const rec: Recent = { days: ['a', 'b', 'c', 'd'], window_days: 2, regions: { X: { harm: [1, 2, 10, 20], median: [5, 5, 10, 10] }, Y: { harm: [0, 0, 0, 0], median: [0, 0, 0, 0] } } };
describe('recent', () => {
  it('sums the last window vs median', () => { const r = last7(rec, 'X')!; expect(r.value).toBe(30); expect(r.median).toBe(20); expect(r.pct).toBeCloseTo(50); });
  it('zero median -> NaN pct; missing key -> null', () => { expect(Number.isNaN(last7(rec, 'Y')!.pct)).toBe(true); expect(last7(rec, 'Z')).toBeNull(); expect(last7(null, 'X')).toBeNull(); });
  it('parseRecent rejects bad shapes and drops mismatched regions', () => {
    expect(parseRecent(null)).toBeNull(); expect(parseRecent({ days: [], regions: {} })).toBeNull();
    const p = parseRecent({ days: ['a', 'b'], window_days: 7, regions: { A: { harm: [1, 2], median: [1, 2] }, B: { harm: [1], median: [1] } } })!;
    expect(Object.keys(p.regions)).toEqual(['A']);
  });
});
describe('deltaChip', () => {
  it('arrows and flat band', () => {
    expect(deltaChip(-27.2)).toEqual({ text: '↓ 27%', dir: 'down' }); expect(deltaChip(41)).toEqual({ text: '↑ 41%', dir: 'up' });
    expect(deltaChip(1)?.dir).toBe('flat'); expect(deltaChip(NaN)).toBeNull(); expect(deltaChip(null)).toBeNull();
  });
});
describe('seasonStatus', () => {
  const s = { months: [7, 8, 9], peak: 8 };
  it('in season: day N of ~M', () => { expect(seasonStatus(s, 8, 10, 2026)).toEqual({ inSeason: true, label: 'IN SEASON', sub: 'day 41 of ~92' }); });
  it('wraps around the year end', () => { expect(seasonStatus({ months: [12, 1, 2], peak: 1 }, 1, 5, 2026)!.sub).toBe('day 36 of ~90'); });
  it('off season names the next month, wrapping', () => { expect(seasonStatus(s, 10, 1, 2026)).toEqual({ inSeason: false, label: 'OFF SEASON', sub: 'next: Jul' }); expect(seasonStatus(s, 5, 1, 2026)!.sub).toBe('next: Jul'); expect(seasonStatus(null, 1, 1, 2026)).toBeNull(); });
});
describe('sensorStatus', () => {
  const sn = { modis: { label: 'MODIS (Terra+Aqua)', start: '2000-11-01', end: '2026-11-14' }, snpp: { label: 'VIIRS S-NPP', start: '2012-01-20', end: '2026-11-02' }, n20: { label: 'VIIRS NOAA-20', start: '2018-04-01', end: '2026-11-14' }, n21: { label: 'VIIRS NOAA-21', start: '2023-03-01', end: '2026-11-14' } };
  it('ended when the end is more than 7 days before data_through', () => {
    const r = sensorStatus(sn, '2026-11-14'); expect(r.map((x) => x.state)).toEqual(['active', 'ended', 'active', 'active']);
    expect(r[1].text).toBe('ENDED 2 Nov 2026'); expect(r[0].label).toBe('MODIS Terra/Aqua'); expect(r[0].note).toContain('retiring');
  });
  it('7 days exactly is still active', () => { expect(sensorStatus(sn, '2026-11-09')[1].state).toBe('active'); });
});
describe('table', () => {
  const row = (name: string, pct: number): CountryRow => ({ id: name, name, value: 1, pct, ytd: 0, trend: [], rank: 50, status: 'normal' });
  const rows = [row('B', 5), row('A', NaN), row('C', -20)];
  it('sorts numbers with NaN last in both directions', () => { expect(sortRows(rows, 'pct', -1).map((r) => r.name)).toEqual(['B', 'C', 'A']); expect(sortRows(rows, 'pct', 1).map((r) => r.name)).toEqual(['C', 'B', 'A']); });
  it('sorts by name and is stable', () => { expect(sortRows(rows, 'name', 1).map((r) => r.name)).toEqual(['A', 'B', 'C']); expect(sortRows([row('x', 1), row('y', 1)], 'pct', 1).map((r) => r.name)).toEqual(['x', 'y']); });
  it('status thresholds', () => { expect([96, 80, 50, 10, NaN].map(statusOf)).toEqual(['extreme', 'above', 'normal', 'below', null]); });
});
describe('activeCells', () => {
  it('counts cells with detections vs the median of earlier years', () => {
    const hist = { c: [0, 1, 0, 0, 1, 2], t: [12, 12, 24, 36, 36, 36], harm: [1, 1, 1, 1, 1, 1] }; // counts per year: 12->2, 24->1, 36->3
    const now = { c: [0, 1, 2, 5], t: [48, 48, 48, 48], harm: [1, 0, 1, 1] };
    const r = activeCells(now, new Uint8Array([1, 1, 1, 0, 0, 1]), 48, hist)!;
    expect(r.value).toBe(3); expect(r.median).toBe(2); expect(r.pct).toBeCloseTo(50);
    expect(activeCells(now, new Uint8Array(6), 48, null)).toBeNull();
  });
});
