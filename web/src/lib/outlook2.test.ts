import { describe, expect, it } from 'vitest';
import { crossing, timingFromCurve, monthPhrase, posToDoy, normCdf, theilSen, mannKendall, pace, hindcast, nextMonths, seasonShift, fmtTh, monthProbs } from './outlook2';
import { tFromYM } from './time';

const mkSeries = (f: (y: number, m: number) => number, y0 = 2001, y1 = 2026, partialMonth = 6): { arr: Float64Array; sp: { tFirst: number; tLast: number } } => {
  const arr = new Float64Array(tFromYM(y1, 12) + 1).fill(NaN);
  for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) arr[tFromYM(y, m)] = f(y, m);
  return { arr, sp: { tFirst: tFromYM(y0, 1), tLast: tFromYM(y1, partialMonth) } };
};
describe('season crossings', () => {
  it('single-month season crosses inside that month', () => {
    const c = Array(12).fill(0); c[3] = 100;
    const t = timingFromCurve(c)!; expect(t.start).toBeCloseTo(3.1, 5); expect(t.mid).toBeCloseTo(3.5, 5); expect(t.end).toBeCloseTo(3.9, 5);
  });
  it('flat curve: 10 / 50 / 90 % land at 1.2 / 6 / 10.8', () => { const t = timingFromCurve(Array(12).fill(5))!; expect([t.start, t.mid, t.end].map((x) => +x.toFixed(2))).toEqual([1.2, 6, 10.8]); });
  it('empty curve is null; phrases and day-of-year', () => {
    expect(crossing(Array(12).fill(0), 0.5)).toBeNull();
    const ab = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    expect([0.1, 3.5, 3.9].map((p) => monthPhrase(p, ab))).toEqual(['early Jan', 'mid Apr', 'late Apr']);
    expect(posToDoy(0)).toBe(0); expect(Math.round(posToDoy(1))).toBe(31); expect(Math.round(posToDoy(12))).toBe(365);
  });
});
describe('statistics', () => {
  it('normal CDF', () => { expect(normCdf(0)).toBeCloseTo(0.5, 6); expect(normCdf(1.96)).toBeCloseTo(0.975, 3); expect(normCdf(-1.96)).toBeCloseTo(0.025, 3); });
  it('Theil-Sen is exact on a line and robust to an outlier', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; expect(theilSen(x, x.map((v) => 2 * v + 1))).toBeCloseTo(2, 9);
    const y = x.map((v) => 2 * v + 1); y[9] = 500; expect(theilSen(x, y)).toBeCloseTo(2, 9);
  });
  it('Mann-Kendall: monotone series has S=45, z=3.935 and a tiny p; constant series p=1', () => {
    const r = mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); expect(r.s).toBe(45); expect(r.z).toBeCloseTo(44 / Math.sqrt(125), 6); expect(r.p).toBeLessThan(1e-3);
    expect(mannKendall([3, 3, 3, 3, 3, 3]).p).toBeCloseTo(1, 6); expect(mannKendall([1, 3, 2, 4, 3, 5, 4, 6]).p).toBeLessThan(0.05);
    expect(mannKendall([5, 1, 4, 2, 5, 1, 3, 2]).p).toBeGreaterThan(0.3);
  });
});
describe('pace and projection', () => {
  it('constant years project exactly and read as normal', () => {
    const { arr, sp } = mkSeries(() => 10); const p = pace(arr, sp);
    expect(p.year).toBe(2026); expect(p.ytdComplete).toBe(50); expect(p.actual.length).toBe(6);
    expect(p.proj).toEqual({ lo: 120, med: 120, hi: 120 }); expect(p.status).toBe('normal'); expect(p.median[11]).toBe(120); expect(p.median[0]).toBe(10);
  });
  it('a strong start in a varying history reads above normal', () => {
    const { arr, sp } = mkSeries((y, m) => (y === 2026 ? 100 : 10 + (y % 5) + (m % 3)));
    const p = pace(arr, sp); expect(p.status).toBe('above'); expect(p.proj!.lo).toBeLessThanOrEqual(p.proj!.med); expect(p.proj!.med).toBeLessThanOrEqual(p.proj!.hi);
  });
});
describe('next months and shift', () => {
  it('next three months use the 10 complete years', () => {
    const { arr, sp } = mkSeries((_, m) => (m === 7 ? 100 : 1)); const n = nextMonths(arr, sp);
    expect(n.map((x) => x.m)).toEqual([7, 8, 9]); expect(n[0].median).toBe(100); expect(n[1].median).toBe(1); expect(n[0].chance).toBeGreaterThan(0.9); expect(n[1].chance).toBeLessThan(0.2);
  });
  it('a season that moves 1 month earlier every 10 years is detected', () => {
    const { arr, sp } = mkSeries((y, m) => { const peak = Math.round(9 - (y - 2001) / 10); return m === peak ? 100 : 1; }, 2001, 2026);
    const s = seasonShift(arr, sp)!; expect(s.slope.start).toBeLessThan(-15); expect(s.p.start).toBeLessThan(0.05);
  });
  it('a fixed season has no significant shift', () => { const { arr, sp } = mkSeries((_, m) => (m === 7 ? 100 : 1)); const s = seasonShift(arr, sp)!; expect(s.p.start).toBeGreaterThan(0.05); expect(s.slope.start).toBeCloseTo(0, 6); });
});
describe('hindcast', () => {
  it('perfectly seasonal series: flagged months always high, base rate low, good skill', () => {
    const { arr, sp } = mkSeries((y, m) => (m === 7 || m === 8 ? 100 + (y % 3) : 1));
    const h = hindcast(arr, sp); expect(h.hitPct).toBe(100); expect(h.basePct!).toBeCloseTo(100 / 6, 5); expect(h.skill).toBe('good'); expect(h.unflaggedPct).toBe(0);
  });
  it('noise has weak skill and too few flags is "insufficient"', () => {
    let seed = 7; const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const { arr, sp } = mkSeries(() => rnd()); expect(['weak', 'insufficient']).toContain(hindcast(arr, sp).skill);
    const flat = mkSeries(() => 5); expect(hindcast(flat.arr, flat.sp).skill).toBe('insufficient');
  });
  it('monthProbs is Laplace smoothed', () => { const { arr, sp } = mkSeries((_, m) => (m === 7 ? 100 : 1)); const pr = monthProbs(arr, sp, 2025); expect(pr.p[6]).toBeCloseTo(11 / 12, 6); expect(pr.p[0]).toBeCloseTo(1 / 12, 6); });
});
describe('format', () => { it('thin-space thousands', () => { expect(fmtTh(12345.6)).toBe('12 346'); expect(fmtTh(NaN)).toBe('—'); }); });
