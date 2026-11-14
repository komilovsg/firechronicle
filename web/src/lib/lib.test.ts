import { describe, expect, it } from 'vitest';
import { median, percentile, mad, robustZ, rankPercentile } from './stats';
import { tFromYM, tLabel, parseTLabel, yearOf, monthOf } from './time';
import { naiveAt, CellIndex, type Meta, type Monthly } from './series';
import { detectSeason, buildSummary, monthRanges, outlook, outlookText, anomalies } from './analytics';
import { encodeHash, parseHash } from './hash';
import { jumpPct, cvRows, headline, fmtNum, cpToX } from './validation';
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
    expect(naiveAt(322, o)).toBe(7);
    expect(naiveAt(323, o)).toBe(9);
    expect(naiveAt(300, o, 299)).toBe(9);
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
    expect(o.next).toEqual({ from: 7, to: 9, n: 11 });
    expect(outlookText(o)).toBe('Next critical period: Jul–Sep (based on 11 years).');
    expect(o.months[0].m).toBe(12);
    expect(o.months.find((x) => x.m === 8)!.p).toBeCloseTo(12 / 13, 6);
  });
  it('none above threshold', () => {
    const o = outlook(mk(() => 5, sp.tLast), sp);
    expect(o.next).toBeNull();
    expect(o.months.every((x) => x.k === 0 && !x.critical)).toBe(true);
    expect(outlookText(o)).toContain('No month');
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
