import { describe, expect, it } from 'vitest';
import { median, percentile, mad, robustZ, rankPercentile } from './stats';
import { tFromYM, tLabel, parseTLabel, yearOf, monthOf } from './time';
import { naiveAt, CellIndex, type Meta, type Monthly } from './series';
import { ytdStats, thisMonthStats, detectSeason, buildSummary, monthRanges, outlook, outlookText, anomalies } from './analytics';
import { encodeHash, parseHash } from './hash';
import { fsLayout, firstOverlap } from './fsLayout';
import { jumpPct, cvRows, headline, fmtNum, cpToX, perYearBias, independentCheck } from './validation';
import { csvCell, buildCsv } from './csv';
import { pointInPolygon, circlePolygon } from './geo';

describe('stats', () => {
  it('median/percentile', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([0, 10, 20, 30, 40], 25)).toBe(10);
    expect(percentile([1, 2, NaN, 3], 100)).toBe(3);
    expect(median([])).toBeNaN();
  });
  it('mad and robust z', () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(robustZ(5, 3, 1)).toBeCloseTo(2 / 1.4826, 6);
    expect(robustZ(1000, 3, 1)).toBe(3);
    expect(robustZ(-1000, 3, 1)).toBe(-3);
  });
  it('MAD = 0 guard', () => {
    expect(robustZ(5, 5, 0)).toBe(0);
    expect(robustZ(6, 5, 0)).toBe(3);
    expect(robustZ(4, 5, 0)).toBe(-3);
  });
  it('rank percentile', () => {
    expect(rankPercentile(5, [1, 2, 3, 4])).toBe(100);
    expect(rankPercentile(2, [1, 2, 3, 4])).toBe(37.5);
  });
});

describe('time', () => {
  it('t <-> YYYY-MM', () => {
    expect(tFromYM(2000, 1)).toBe(0);
    expect(tFromYM(2012, 1)).toBe(144);
    expect(tLabel(322)).toBe('2026-11');
    expect(parseTLabel('2026-11')).toBe(322);
    expect(parseTLabel('2026-13')).toBeNull();
    expect(parseTLabel('abc')).toBeNull();
    expect(yearOf(143)).toBe(2011); expect(monthOf(143)).toBe(12);
    for (let t = 0; t < 400; t++) expect(parseTLabel(tLabel(t))).toBe(t);
  });
});

describe('naive splice', () => {
  const o = { modis: 1, snpp: 7, n20: 9 };
  it('switches at 144 and after S-NPP end', () => {
    expect(naiveAt(143, o)).toBe(1);
    expect(naiveAt(144, o)).toBe(7);
    expect(naiveAt(321, o)).toBe(7);
    expect(naiveAt(322, o)).toBe(9);
    expect(naiveAt(323, o)).toBe(9);
    expect(naiveAt(298, o, 299)).toBe(7);
    expect(naiveAt(299, o, 299)).toBe(9);
    expect(naiveAt(10, o, 322, 12)).toBe(1);
    expect(naiveAt(12, o, 322, 12)).toBe(7);
  });
});

const meta = { t_first: 10, t_last: 20, sensors: { modis: { start: '2000-11-01' }, snpp: { start: '2012-01-20', end: '2026-11-02' }, n20: { start: '2018-04-01' }, n21: { start: '2023-03-01' } } } as unknown as Meta;
describe('AOI aggregation', () => {
  const m: Monthly = { c: [0, 1, 1, 2], t: [12, 12, 13, 12], modis: [1, 2, 3, 4], snpp: [0, 0, 0, 0], n20: [0, 0, 0, 0], n21: [0, 0, 0, 0], harm: [1.5, 2.5, 3.5, 4.5], lo: [1, 2, 3, 4], hi: [2, 3, 4, 5] };
  const idx = new CellIndex(m, 3, 21);
  it('sum over cells equals manual sum', () => {
    const s = idx.aggregate([0, 1], meta);
    expect(s.modis[12]).toBe(3); expect(s.harm[12]).toBe(4); expect(s.harm[13]).toBe(3.5); expect(s.naive[12]).toBe(3);
    expect(s.harm[5]).toBeNaN();
  });
  it('empty AOI is zeros', () => {
    const s = idx.aggregate([], meta);
    for (let t = 10; t <= 20; t++) { expect(s.harm[t]).toBe(0); expect(s.modis[t]).toBe(0); }
  });
  it('frame and period', () => {
    const f = idx.frame(12, Uint8Array.from([1, 1, 0]));
    expect(Array.from(f)).toEqual([1.5, 2.5, 0]);
    expect(Array.from(idx.period(12, 13, [1]))).toEqual([0, 6, 0]);
  });
});

describe('season and summary', () => {
  const sp = { tFirst: 12, tLast: 12 * 11 + 10 }; // 2001-01 .. 2011-11 (partial)
  const arr = new Float64Array(sp.tLast + 1);
  for (let t = 0; t <= sp.tLast; t++) { const m = monthOf(t); arr[t] = (m === 7 ? 40 : m === 8 ? 100 : m === 9 ? 40 : 2) * (yearOf(t) === 2010 ? 1.5 : 1); }
  arr[sp.tLast] = 3;
  it('detects Jul-Sep with Aug peak', () => {
    const med = [2, 2, 2, 2, 2, 2, 40, 100, 40, 2, 2, 2];
    expect(detectSeason(med)).toEqual({ months: [7, 8, 9], peak: 8 });
    expect(detectSeason([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
  it('summary text', () => {
    const s = buildSummary({ arr, y0: 2000, y1: 2026, sp, partialDays: 14 }).join(' ');
    expect(s).toContain('runs Jul\u2013Sep, peaking in Aug.');
    expect(s).toContain('2010 was');
    expect(s).toContain('above');
    expect(s).toContain('November 2011 so far (14 days): 3 detections');
  });
  it('anomaly z clipped, constant series guarded', () => {
    const z = anomalies(arr, 2001, 2011, sp);
    expect(z.every((c) => Math.abs(c.z) <= 3)).toBe(true);
    expect(z.find((c) => c.m === 8 && c.year === 2010)!.z).toBe(3);
  });
});

describe('outlook', () => {
  const mk = (f: (t: number) => number, tLast: number) => { const a = new Float64Array(tLast + 1); for (let t = 0; t <= tLast; t++) a[t] = f(t); return a; };
  const sp = { tFirst: 0, tLast: 12 * 10 + 10 };
  it('seasonal series -> critical Jun-Sep run, starting next month', () => {
    const o = outlook(mk((t) => (monthOf(t) >= 7 && monthOf(t) <= 9 ? 100 : 1), sp.tLast), sp);
    expect(o.next).toEqual({ from: 7, to: 9, n: 10 });
    expect(outlookText(o)).toBe('Next high-activity period: Jul–Sep (based on 10 years).');
    expect(o.months[0].m).toBe(12);
    expect(o.months.find((x) => x.m === 8)!.p).toBeCloseTo(11 / 12, 6);
  });
  it('none above threshold', () => {
    const o = outlook(mk(() => 5, sp.tLast), sp);
    expect(o.next).toBeNull();
    expect(o.months.every((x) => x.k === 0 && !x.critical)).toBe(true);
    expect(outlookText(o)).toContain('No month');
    expect(o.years).toBe(10);
  });
  it('n = 0 gives the prior 0.5', () => {
    const o = outlook(new Float64Array(1), { tFirst: 0, tLast: 0 });
    expect(o.months.every((x) => x.n === 0 && x.p === 0.5)).toBe(true);
  });
  it('all above', () => {
    const a = mk((t) => (t === 0 ? 0 : 10), sp.tLast); // threshold P75 = 10, strictly above => none
    expect(outlook(a, sp).months.every((x) => x.k === 0)).toBe(true);
    const b = mk((t) => (t % 12 === 11 ? 1 : 10) + (t % 12 === 11 ? 0 : 0), sp.tLast);
    expect(outlook(b, sp, 0).months.filter((x) => x.m !== 12).every((x) => x.k === x.n && x.p === (x.n + 1) / (x.n + 2))).toBe(true);
  });
});

describe('hash state', () => {
  const base = { y0: 2005, y1: 2026, mode: 'naive' as const };
  it('round-trips', () => {
    for (const aoi of [{ kind: 'region', id: 'KAZ' }, { kind: 'polygon', pts: [[60.1234, 40], [61, 41.5], [62.25, 40.1]] }, { kind: 'circle', lat: 41.3, lon: 69.2, r: 120 }] as const) {
      expect(parseHash(encodeHash({ ...base, aoi: aoi as never }))).toEqual({ ...base, aoi });
    }
  });
  it('rejects malformed and out-of-range', () => {
    expect(parseHash('#a=<script>').aoi).toBeUndefined();
    expect(parseHash('#c=95,10,10').aoi).toBeUndefined();
    expect(parseHash('#c=10,200,10').aoi).toBeUndefined();
    expect(parseHash('#c=10,10,501').aoi).toBeUndefined();
    expect(parseHash('#c=10,10,0').aoi).toBeUndefined();
    expect(parseHash('#c=x,10,10').aoi).toBeUndefined();
    expect(parseHash('#p=1,2;3,4').aoi).toBeUndefined();
    expect(parseHash('#p=1,2;3,4;5,95').aoi).toBeUndefined();
    expect(parseHash('#y=2020-2010').y0).toBeUndefined();
    expect(parseHash('#y=1999-2010').y0).toBeUndefined();
    expect(parseHash('#m=evil').mode).toBeUndefined();
    expect(parseHash('#' + 'a'.repeat(9000))).toEqual({});
    const many = Array.from({ length: 201 }, (_, i) => `${i % 90},${i % 80}`).join(';');
    expect(parseHash('#p=' + many).aoi).toBeUndefined();
    const ok = Array.from({ length: 200 }, (_, i) => `${i % 90},${i % 80}`).join(';');
    expect(parseHash('#p=' + ok).aoi).toBeDefined();
  });
});

describe('csv', () => {
  it('escapes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });
  it('injection guard but numbers untouched', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe('"\'\rx"');
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('+3')).toBe('+3');
    expect(csvCell('1e-3')).toBe('1e-3');
    expect(csvCell('-')).toBe("'-");
  });
  it('builds rows', () => { expect(buildCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n'); });
});

describe('geo', () => {
  it('point in polygon and circle', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
    const c = circlePolygon(40, 70, 100);
    expect(pointInPolygon(70, 40, c)).toBe(true);
    expect(pointInPolygon(70, 42, c)).toBe(false);
  });
});

describe('month ranges', () => {
  it('compresses and wraps', () => {
    expect(monthRanges([7, 8, 9])).toEqual(['Jul\u2013Sep']);
    expect(monthRanges([3, 4, 5, 7, 8, 9, 10])).toEqual(['Mar\u2013May', 'Jul\u2013Oct']);
    expect(monthRanges([11, 12, 1, 2])).toEqual(['Nov\u2013Feb']);
    expect(monthRanges([12, 1])).toEqual(['Dec\u2013Jan']);
    expect(monthRanges([5])).toEqual(['May']);
    expect(monthRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual(['Jan\u2013Dec']);
    expect(monthRanges([])).toEqual([]);
  });
  it('summary uses ranges', () => {
    const arr = new Float64Array(12 * 12 + 1);
    for (let t = 0; t < arr.length; t++) { const m = monthOf(t); arr[t] = [3, 4, 5, 7, 8, 9, 10].includes(m) ? (m === 4 ? 100 : 50) : 1; }
    expect(buildSummary({ arr, y0: 2000, y1: 2012, sp: { tFirst: 0, tLast: 144 }, partialDays: 10 })[0]).toBe('Fire season here usually runs Mar\u2013May and Jul\u2013Oct, peaking in Apr.');
  });
});

describe('validation helpers', () => {
  it('jump percent from ratio', () => {
    expect(jumpPct(1.6)).toBe('+60%'); expect(jumpPct(0.46)).toBe('\u221254%');
    expect(jumpPct(undefined)).toBe('\u2014'); expect(jumpPct(NaN)).toBe('\u2014'); expect(jumpPct('x')).toBe('\u2014');
  });
  it('never prints undefined or NaN', () => {
    const rows = cvRows({ cv: { snpp: { region_month: { bias_pct: -0.13, mae: 238.55, r2: 0.978, n: 168 }, years: '2012-2025' }, n20: { region_month: { r2: 'bad' } } } });
    expect(rows[0]).toMatchObject({ sensor: 'S-NPP', bias: '\u22120.13%', mae: '239', r2: '0.978' });
    expect(JSON.stringify(rows)).not.toMatch(/undefined|NaN/);
    expect(cvRows({})).toEqual([]);
    expect(cvRows(undefined)).toEqual([]);
    expect(headline(undefined).naive).toBe('\u2014');
    expect(fmtNum(undefined)).toBe('\u2014');
    expect(cpToX('2011-01')).toBeCloseTo(2011.0417, 3); expect(cpToX('bad')).toBeNull();
  });
});

import { anomalyNow, topUnusual, anomalyBin } from './anomalyNow';
import { fmtInt } from './format';
import { encodeCmp, parseCmp } from './cmp';

describe('anomalyNow', () => {
  // tFirst = 0, target = 12*10 + 6 (Jul of year 10); two cells
  const T = 126;
  const rows: { c: number; t: number; v: number }[] = [];
  for (let y = 0; y < 10; y++) rows.push({ c: 0, t: 12 * y + 6, v: 10 + y }); // cell 0: 10..19 every year
  rows.push({ c: 0, t: T, v: 100 }); // above everything
  for (let y = 0; y < 3; y++) rows.push({ c: 1, t: 12 * y + 6, v: 5 }); // cell 1: only 3 years of data
  rows.push({ c: 1, t: T, v: 50 });
  rows.push({ c: 0, t: T - 1, v: 999 }); // other month, must be ignored
  const m = { c: rows.map((r) => r.c), t: rows.map((r) => r.t), modis: rows.map(() => 0), snpp: rows.map(() => 0), n20: rows.map(() => 0), n21: rows.map(() => 0), harm: rows.map((r) => r.v), lo: rows.map(() => 0), hi: rows.map(() => 0) };
  const idx = new CellIndex(m as unknown as Monthly, 3, 200);
  it('percentile against own history; thin history is NaN', () => {
    const a = anomalyNow(idx, [0, 1, 2], T, 0);
    expect(a.nPast).toBe(10);
    expect(a.pct[0]).toBe(100); expect(a.nYears[0]).toBe(10);
    expect(a.pct[1]).toBeNaN(); expect(a.nYears[1]).toBe(3);
    expect(a.pct[2]).toBeNaN();
  });
  it('zero value ranks at the bottom; ties use mid-rank', () => {
    const a = anomalyNow(idx, [0], T + 12, 0); // no row at target for cell 0
    expect(a.value[0]).toBe(0); expect(a.pct[0]).toBe(0);
    const eqRows = { ...m, harm: m.harm.map((v, i) => (m.c[i] === 0 && m.t[i] === T ? 14 : v)) };
    const b = anomalyNow(new CellIndex(eqRows as unknown as Monthly, 3, 200), [0], T, 0);
    expect(b.pct[0]).toBe(((4 + 0.5 * 1) / 10) * 100); // 10..13 below, 14 equal
  });
  it('top list and bins', () => {
    const a = anomalyNow(idx, [0, 1], T, 0);
    expect(topUnusual(a, [0, 1], 5).map((x) => x.cell)).toEqual([0]);
    expect([anomalyBin(NaN), anomalyBin(5), anomalyBin(20), anomalyBin(50), anomalyBin(80), anomalyBin(95)]).toEqual([-1, 0, 1, 2, 3, 4]);
  });
});
describe('format and compare hash', () => {
  it('thin separators', () => { expect(fmtInt(1234567)).toBe('1 234 567'); expect(fmtInt(999)).toBe('999'); expect(fmtInt(-1500)).toBe('−1 500'); expect(fmtInt(NaN)).toBe('–'); });
  it('cmp round trip and rejection', () => {
    for (const a of [{ kind: 'region', id: 'KAZ' }, { kind: 'polygon', pts: [[60, 40], [61, 41], [62, 40.5]] }, { kind: 'circle', lat: 41.3, lon: 69.2, r: 100 }] as const) expect(parseCmp('#' + encodeCmp(a as never))).toEqual(a);
    expect(parseCmp('#b=c:99,0,10')).toBeNull(); expect(parseCmp('#b=<x>')).toBeNull(); expect(parseCmp('#a=KAZ')).toBeNull(); expect(parseCmp('#b=p:1,2;3,4')).toBeNull();
  });
});

import { pointInPolys, geometryPolys } from './geo';
describe('multipolygon AOI', () => {
  const sq = (x0: number, y0: number, s: number): [number, number][] => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
  const multi = geometryPolys({ type: 'MultiPolygon', coordinates: [[sq(0, 0, 10), sq(4, 4, 2)], [sq(20, 0, 5)]] });
  it('finds points in every part and excludes holes', () => {
    expect(pointInPolys(1, 1, multi)).toBe(true);
    expect(pointInPolys(22, 2, multi)).toBe(true);
    expect(pointInPolys(5, 5, multi)).toBe(false);
    expect(pointInPolys(15, 5, multi)).toBe(false);
  });
  it('wraps a plain Polygon', () => {
    expect(pointInPolys(1, 1, geometryPolys({ type: 'Polygon', coordinates: [sq(0, 0, 10)] }))).toBe(true);
  });
});

describe('P0 updates', () => {
  it('outlook uses only the last 10 complete years', () => {
    const tLast = 12 * 20 + 10; // 2020-11 partial; window = 2010..2019
    const a = new Float64Array(tLast + 1);
    for (let t = 0; t <= tLast; t++) a[t] = yearOf(t) < 2010 ? 1000 : monthOf(t) === 3 ? 50 : 1; // old years are huge but ignored
    const o = outlook(a, { tFirst: 0, tLast });
    expect(o.threshold).toBeLessThan(60);
    expect(o.months.find((x) => x.m === 3)!.n).toBe(10);
    expect(o.months.find((x) => x.m === 3)!.critical).toBe(true);
  });
  it('AOI band from sdc and pv: calibration sums linearly, Poisson variance sums', () => {
    const m = { c: [0, 1], t: [12, 12], modis: [1, 1], snpp: [0, 0], n20: [0, 0], n21: [0, 0], harm: [100, 50], sdc: [3, 4], pv: [16, 9] };
    const s = new CellIndex(m as unknown as Monthly, 2, 21).aggregate([0, 1], meta);
    const sd = Math.sqrt(7 * 7 + 25);
    expect(s.lo[12]).toBeCloseTo(150 - 1.645 * sd, 6); expect(s.hi[12]).toBeCloseTo(150 + 1.645 * sd, 6);
    const small = { ...m, harm: [1, 1], sdc: [5, 5], pv: [0, 0] };
    expect(new CellIndex(small as unknown as Monthly, 2, 21).aggregate([0, 1], meta).lo[12]).toBe(0);
  });
  it('old lo/hi shape still sums', () => {
    const m = { c: [0], t: [12], modis: [1], snpp: [0], n20: [0], n21: [0], harm: [5], lo: [4], hi: [6] };
    const s = new CellIndex(m as unknown as Monthly, 1, 21).aggregate([0], meta);
    expect(s.lo[12]).toBe(4); expect(s.hi[12]).toBe(6);
  });
  it('this month uses same-days history when partial.json is given; else approximate', () => {
    const tLast = 12 * 11 + 10, arr = new Float64Array(tLast + 1);
    for (let t = 0; t <= tLast; t++) arr[t] = 100;
    arr[tLast] = 30;
    const sp = { tFirst: 0, tLast };
    const withHist = thisMonthStats(arr, 2000, 2026, sp, 10, { t: [10, 22, 34], v: [20, 30, 40] })!;
    expect(withHist.approx).toBe(false); expect(withHist.median).toBe(30); expect(withHist.hist).toEqual([20, 30, 40]);
    const approx = thisMonthStats(arr, 2000, 2026, sp, 10)!;
    expect(approx.approx).toBe(true); expect(approx.median).toBeCloseTo(100 * (10 / 30), 6);
  });
  it('robust z floor keeps tiny-count months from exploding', () => {
    const sp = { tFirst: 0, tLast: 12 * 6 };
    const a = new Float64Array(sp.tLast + 1).fill(0); a[6 + 12 * 3] = 2; // one 2 among zeros in July
    const z = anomalies(a, 2000, 2005, sp).find((c) => c.m === 7 && c.year === 2003)!.z;
    expect(z).toBeCloseTo(2 / 1.4826, 6);
  });
  it('year-level bias and independent check helpers', () => {
    const v = { cv: { snpp: { per_year_bias_pct: { '2014': 1.5, '2013': -0.5, x: 3, '2015': 'bad' }, country_month: { r2: 0.9851 }, climatology_r2: 0.62 } } };
    expect(perYearBias(v, 'snpp')).toEqual([{ year: 2013, bias: -0.5 }, { year: 2014, bias: 1.5 }]);
    expect(perYearBias({}, 'snpp')).toEqual([]);
    expect(independentCheck(v)).toEqual({ r2: '0.985', baseline: '0.620' });
    expect(independentCheck({})).toEqual({ r2: '—', baseline: '—' });
  });
});

describe('fullscreen layout and ytd', () => {
  it('layout by width', () => { expect([1920, 1024, 1023, 768, 641, 640, 375].map(fsLayout)).toEqual(['wide', 'wide', 'mid', 'mid', 'mid', 'mobile', 'mobile']); });
  it('overlap detection', () => {
    expect(firstOverlap([{ id: 'a', x: 0, y: 0, w: 100, h: 100 }, { id: 'b', x: 100, y: 0, w: 50, h: 50 }])).toBeNull();
    expect(firstOverlap([{ id: 'a', x: 0, y: 0, w: 100, h: 100 }, { id: 'b', x: 90, y: 90, w: 50, h: 50 }])).toEqual(['a', 'b']);
  });
  it('year to date vs earlier years', () => {
    const tLast = 12 * 3 + 5; // 2003-06 partial: Jan..May complete
    const arr = new Float64Array(tLast + 1);
    for (let t = 0; t <= tLast; t++) arr[t] = yearOf(t) === 2003 ? 20 : 10; // 5 months: 100 vs 50
    const r = ytdStats(arr, { tFirst: 0, tLast }, 2000, 2026)!;
    expect(r.value).toBe(100); expect(r.median).toBe(50); expect(r.pct).toBe(100); expect(r.months).toBe(5);
    expect(ytdStats(arr, { tFirst: 0, tLast: 12 * 3 }, 2000, 2026)).toBeNull();
    expect(ytdStats(arr, { tFirst: 24, tLast }, 2003, 2026)).toBeNull();
  });
});

import { DEFAULT_REFRESH, formatCountdown, freshness, nextRun, parseRefresh, shortCountdown } from './freshness';
describe('freshness', () => {
  const R = parseRefresh({ schedule_utc: '03:00', cadence: 'daily', auto_update_until: '2027-05-15', issues_url: 'https://example.org/i' });
  it('next 03:00 UTC, also across UTC midnight and exactly at the schedule', () => {
    expect(nextRun(new Date('2026-11-15T01:00:00Z'), '03:00').toISOString()).toBe('2026-11-15T03:00:00.000Z');
    expect(nextRun(new Date('2026-11-15T03:00:00Z'), '03:00').toISOString()).toBe('2026-11-16T03:00:00.000Z');
    expect(nextRun(new Date('2026-11-15T23:59:59Z'), '03:00').toISOString()).toBe('2026-11-16T03:00:00.000Z');
    expect(nextRun(new Date('2026-12-31T23:30:00Z'), '03:00').toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
  it('fresh / stale threshold / ended', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(freshness(now, '2026-11-14', R)).toEqual({ state: 'fresh', daysOld: 1 });
    expect(freshness(now, '2026-11-12', R).state).toBe('fresh'); // 3 days
    expect(freshness(now, '2026-11-11', R)).toEqual({ state: 'stale', daysOld: 4 });
    expect(freshness(now, null, R).state).toBe('stale');
    expect(freshness(new Date('2027-05-15T23:00:00Z'), '2027-05-14', R).state).toBe('fresh'); // last day still counts
    expect(freshness(new Date('2027-05-16T00:00:01Z'), '2027-05-14', R).state).toBe('ended');
    expect(freshness(new Date('2027-06-01T00:00:00Z'), '2027-05-31', R).state).toBe('ended'); // ended wins over fresh
  });
  it('missing or malformed refresh block falls back to defaults', () => {
    expect(parseRefresh(undefined)).toEqual(DEFAULT_REFRESH);
    expect(parseRefresh({ schedule_utc: '25:99', auto_update_until: 'soon', issues_url: 'http://x' })).toEqual(DEFAULT_REFRESH);
    expect(parseRefresh({ schedule_utc: '04:30' }).schedule_utc).toBe('04:30');
  });
  it('countdown formatting', () => {
    expect(formatCountdown(7 * 3600e3 + 12 * 60e3 + 45e3)).toBe('07:12:45'); expect(formatCountdown(-5)).toBe('00:00:00');
    expect(shortCountdown(7.4 * 3600e3)).toBe('7h'); expect(shortCountdown(12.5 * 60e3)).toBe('12m'); expect(shortCountdown(10e3)).toBe('1m');
  });
});

import { hasDrifted, type View } from './viewDrift';
describe('view drift', () => {
  const def: View = { center: [67, 45], zoom: 4, pitch: 45, bearing: 0 };
  it('same view is not drifted; small changes stay under the thresholds', () => {
    expect(hasDrifted(def, def, 800, 600)).toBe(false);
    expect(hasDrifted({ ...def, zoom: 4.25 }, def, 800, 600)).toBe(false);
    expect(hasDrifted({ ...def, pitch: 45.5, bearing: 0.5 }, def, 800, 600)).toBe(false);
  });
  it('zoom, pitch, bearing and pan beyond the thresholds', () => {
    expect(hasDrifted({ ...def, zoom: 4.4 }, def, 800, 600)).toBe(true);
    expect(hasDrifted({ ...def, zoom: 3.6 }, def, 800, 600)).toBe(true);
    expect(hasDrifted({ ...def, pitch: 0 }, def, 800, 600)).toBe(true);
    expect(hasDrifted({ ...def, bearing: 359 + 0.0 }, def, 800, 600)).toBe(false); // 1 degree
    expect(hasDrifted({ ...def, bearing: -10 }, def, 800, 600)).toBe(true);
    // at zoom 4 one degree of longitude is about 11.4 px: 10% of 800 px is 80 px, about 7 degrees
    expect(hasDrifted({ ...def, center: [70, 45] }, def, 800, 600)).toBe(false);
    expect(hasDrifted({ ...def, center: [75, 45] }, def, 800, 600)).toBe(true);
    expect(hasDrifted({ ...def, center: [67, 52] }, def, 800, 600)).toBe(true);
  });
});

import { addDays, clampImageryDate, gibsProduct, imageryDateFor, isIsoDate, monthMid, parseBm, tileUrl, RELIEF, NIGHT } from './gibs';
import { parseNow } from './clock';
describe('gibs and clock', () => {
  it('product by date', () => {
    expect(gibsProduct('2021-08-15').layer).toBe('VIIRS_NOAA20_CorrectedReflectance_TrueColor');
    expect(gibsProduct('2018-01-05').layer).toContain('NOAA20'); expect(gibsProduct('2018-01-04').layer).toContain('SNPP');
    expect(gibsProduct('2015-11-24').layer).toContain('SNPP'); expect(gibsProduct('2015-11-23').layer).toContain('MODIS_Terra');
    expect(gibsProduct('2005-08-15').maxzoom).toBe(9);
  });
  it('tile urls', () => {
    expect(tileUrl(gibsProduct('2021-08-15'))).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2021-08-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg');
    expect(tileUrl(RELIEF)).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ASTER_GDEM_Color_Shaded_Relief/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg');
    expect(tileUrl(NIGHT)).toContain('/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png');
  });
  it('dates: clamp, month mid, sync rule', () => {
    const now = new Date('2026-11-15T10:00:00Z');
    expect(clampImageryDate('1999-01-01', now)).toBe('2000-02-24'); expect(clampImageryDate('2030-01-01', now)).toBe('2026-11-14');
    expect(monthMid(260)).toBe('2021-09-15'); expect(addDays('2021-12-31', 1)).toBe('2022-01-01'); expect(addDays('2021-03-01', -1)).toBe('2021-02-28');
    expect(imageryDateFor(null, now, null)).toBe('2026-11-14'); expect(imageryDateFor(260, now, null)).toBe('2021-09-15');
    expect(imageryDateFor(322, now, null)).toBe('2026-11-14'); // 15 Nov is in the future -> latest day
    expect(imageryDateFor(260, now, '2021-09-16')).toBe('2021-09-16'); expect(imageryDateFor(260, now, 'garbage')).toBe('2021-09-15');
    expect(isIsoDate('2021-02-30')).toBe(false); expect(isIsoDate('2021-02-28')).toBe(true);
  });
  it('bm hash and now param are validated', () => {
    expect(parseBm('#a=KAZ&bm=sat')).toBe('sat'); expect(parseBm('#bm=evil')).toBeNull(); expect(parseBm('#a=KAZ')).toBeNull();
    expect(parseNow('?now=2026-11-20')?.toISOString()).toBe('2026-11-20T12:00:00.000Z');
    expect(parseNow('?now=2026-13-40')).toBeNull(); expect(parseNow('?now=x')).toBeNull(); expect(parseNow('?now=2026-02-30')).toBeNull(); expect(parseNow('')).toBeNull();
  });
});

import { ask, buildAskBody, nav, parseAskResponse, sanitizeFacts, validateAction } from './assistant';
describe('assistant contracts', () => {
  const lim = { regionIds: ['central-asia', 'KAZ', 'TJK'], firstYear: 2000, lastYear: 2026, modes: ['harm', 'modis', 'viirs', 'naive', 'swipe'] };
  it('facts: key pattern, count cap, value types', () => {
    const raw: Record<string, unknown> = { good_key: 1, 'Bad Key': 2, ok2: 'x', nul: null, nan: NaN, obj: { a: 1 }, long: 'y'.repeat(500), '': 1, ['k'.repeat(41)]: 1 };
    const f = sanitizeFacts(raw);
    expect(Object.keys(f).sort()).toEqual(['good_key', 'long', 'nul', 'ok2']); expect((f.long as string).length).toBe(200);
    const many: Record<string, unknown> = {}; for (let i = 0; i < 60; i++) many['k' + i] = i;
    expect(Object.keys(sanitizeFacts(many)).length).toBe(40);
    expect(buildAskBody('  hi  ', 'ru', { name: 'Kazakhstan', facts: { a_b: 1 } })).toEqual({ q: 'hi', lang: 'ru', area: { name: 'Kazakhstan', facts: { a_b: 1 } } });
    expect(buildAskBody('q', 'en').area).toBeUndefined();
  });
  it('answer parsing: sources, refusal, bad shapes', () => {
    const a = parseAskResponse({ answer: 'text <b>x</b>', refused: false, sources: [{ title: 'T', section: 'S', url: 'https://x.org/a' }, { title: 'U', section: '', url: 'javascript:alert(1)' }, { nope: 1 }], model: 'm', cached: true, disclosure: 'SI answer' })!;
    expect(a.answer).toBe('text <b>x</b>'); expect(a.sources).toEqual([{ title: 'T', section: 'S', url: 'https://x.org/a' }, { title: 'U', section: '', url: '' }]); expect(a.cached).toBe(true); expect(a.disclosure).toBe('SI answer');
    const r = parseAskResponse({ refused: true, reason: 'not in the knowledge base', answer: '', sources: [] })!; expect(r.refused).toBe(true); expect(r.reason).toContain('knowledge base');
    expect(parseAskResponse(null)).toBeNull(); expect(parseAskResponse({ foo: 1 })).toBeNull(); expect(parseAskResponse('x')).toBeNull();
  });
  it('nav action validation', () => {
    expect(validateAction({ area: 'KAZ', yearFrom: 2010, yearTo: 2020, mode: 'naive', compare: 'TJK' }, lim)).toEqual({ area: 'KAZ', yearFrom: 2010, yearTo: 2020, mode: 'naive', compare: 'TJK' });
    expect(validateAction({ area: 'XXX', yearFrom: 2030, mode: 'evil', compare: '<x>' }, lim)).toBeNull();
    expect(validateAction({ yearFrom: 2020, yearTo: 2010 }, lim)).toBeNull();
    expect(validateAction({ compare: null }, lim)).toEqual({ compare: null });
    expect(validateAction({ yearFrom: 1999.5 }, lim)).toBeNull(); expect(validateAction('x', lim)).toBeNull();
  });
  const resp = (status: number, body: unknown, headers: Record<string, string> = {}) => async () => ({ ok: status >= 200 && status < 300, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => body });
  it('api client with a mocked fetch', async () => {
    const ok = await ask(resp(200, { answer: 'hi', refused: false, sources: [] }), 'https://api.example/', { q: 'q', lang: 'en' });
    expect(ok.ok && ok.value.answer).toBe('hi');
    const rate = await ask(resp(429, {}, { 'retry-after': '30' }), 'https://api.example', { q: 'q', lang: 'en' });
    expect(rate).toEqual({ ok: false, error: { kind: 'rate', retryAfter: 30 } });
    expect(await ask(resp(500, {}), 'https://api.example', { q: 'q', lang: 'en' })).toEqual({ ok: false, error: { kind: 'bad' } });
    expect(await ask(async () => { throw new TypeError('offline'); }, 'https://api.example', { q: 'q', lang: 'en' })).toEqual({ ok: false, error: { kind: 'network' } });
    expect(await ask(resp(200, { weird: true }), 'https://api.example', { q: 'q', lang: 'en' })).toEqual({ ok: false, error: { kind: 'bad' } });
    expect(await ask(resp(200, {}), '', { q: 'q', lang: 'en' })).toEqual({ ok: false, error: { kind: 'unconfigured' } });
    const n = await nav(resp(200, { action: { area: 'TJK', yearFrom: 2005, mode: 'bogus' }, refused: false }), 'https://api.example', 'show tajikistan from 2005', lim);
    expect(n.ok && n.value).toEqual({ action: { area: 'TJK', yearFrom: 2005 }, refused: false });
    const nr = await nav(resp(200, { refused: true }), 'https://api.example', 'make me a sandwich', lim);
    expect(nr.ok && nr.value).toEqual({ action: null, refused: true });
  });
});
