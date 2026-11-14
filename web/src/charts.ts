import * as echarts from 'echarts/core';
import { HeatmapChart, LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { SEQ, type Theme } from './theme';
import { MONTH_ABBR, tFromYM, tLabel, yearOf } from './lib/time';
import { percentile } from './lib/stats';
import { fmtInt } from './lib/format';
import type { Series } from './lib/series';
import type { AnomalyCell, Climatology, ThisMonth } from './lib/analytics';

echarts.use([HeatmapChart, LineChart, BarChart, GridComponent, TooltipComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, LegendComponent, AriaComponent, CanvasRenderer]);
export type Chart = echarts.ECharts;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Opt = any;

export function makeChart(el: HTMLElement): Chart {
  const c = echarts.init(el, undefined, { renderer: 'canvas' });
  new ResizeObserver(() => c.resize()).observe(el);
  return c;
}
const fmt = fmtInt;
const mono = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const base = (th: Theme): Opt => ({
  animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, animationDuration: 300,
  textStyle: { fontFamily: "'IBM Plex Sans', system-ui, sans-serif", color: th.ink2 },
  tooltip: { backgroundColor: th.surface, borderColor: th.line, textStyle: { color: th.ink, fontSize: 12, fontFamily: mono }, extraCssText: 'box-shadow:none;', confine: true },
});
const axisCommon = (th: Theme): Opt => ({ axisLine: { lineStyle: { color: th.line } }, axisTick: { show: false }, axisLabel: { color: th.ink3, fontSize: 11, fontFamily: mono }, splitLine: { lineStyle: { color: th.line, opacity: 0.5 } } });

export interface CalInput { s: Series; arr: Float64Array; years: number[]; tFirst: number; tLast: number; tNrt: number; vmax: number; selT: number | null; th: Theme; label: string }
export function calendarOption(i: CalInput): Opt {
  const { th } = i, data: Opt[] = [], empty: Opt[] = [];
  i.years.forEach((y, yi) => {
    for (let m = 1; m <= 12; m++) {
      const t = tFromYM(y, m);
      if (t > i.tLast) continue;
      const v = i.arr[t], sel = t === i.selT;
      const nrt = t >= i.tNrt;
      if (!Number.isFinite(v)) {
        empty.push({ value: [m - 1, yi, 0, t], itemStyle: { color: th.empty, decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [1, 4], rotation: -Math.PI / 4, color: th.ink3 + '66' } } });
        continue;
      }
      const st: Opt = {};
      if (nrt) { st.borderColor = th.ember; st.borderWidth = 1.5; st.decal = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [1, 3], rotation: Math.PI / 4, color: 'rgba(255,255,255,.35)' }; }
      if (sel) { st.borderColor = th.ink; st.borderWidth = 2.5; }
      data.push({ value: [m - 1, yi, v, t], itemStyle: st });
    }
  });
  return {
    ...base(th),
    aria: { enabled: true, decal: { show: false } },
    tooltip: { ...base(th).tooltip, trigger: 'item', formatter: (p: Opt) => {
      const t = p.value[3] as number, v = p.value[2] as number, s = i.s;
      if (p.seriesIndex === 1) return `${tLabel(t)}<br>No data for this source`;
      const lines = [`<b>${tLabel(t)}</b>${t >= i.tNrt ? ' (provisional)' : ''}`, `${i.label}: <b>${fmt(v)}</b>`];
      if (Number.isFinite(s.harm[t])) lines.push(`Harmonized band: ${fmt(s.lo[t])}–${fmt(s.hi[t])} (approx. 90%)`);
      lines.push(`Raw MODIS ${fmt(s.modis[t])} · S-NPP ${fmt(s.snpp[t])} · N20 ${fmt(s.n20[t])} · N21 ${fmt(s.n21[t])}`);
      return lines.join('<br>');
    } },
    grid: { left: 46, right: 12, top: 38, bottom: 46 },
    xAxis: { type: 'category', data: MONTH_ABBR, position: 'top', splitArea: { show: false }, ...axisCommon(th), splitLine: { show: false } },
    yAxis: { type: 'category', data: i.years.map(String), inverse: true, ...axisCommon(th), splitLine: { show: false }, axisLabel: { color: th.ink3, fontSize: 10, fontFamily: mono, interval: (idx: number) => idx % 2 === 0 || window.innerWidth > 768 } },
    visualMap: { type: 'continuous', min: 0, max: Math.max(1, i.vmax), dimension: 2, seriesIndex: 0, calculable: false, orient: 'horizontal', left: 'center', bottom: 2, itemWidth: 10, itemHeight: 160, text: [`${fmt(i.vmax)}+`, '0'], textStyle: { color: th.ink2, fontFamily: mono, fontSize: 11 }, inRange: { color: SEQ }, outOfRange: { color: SEQ[9] } },
    series: [
      { type: 'heatmap', data, emphasis: { itemStyle: { borderColor: th.ink, borderWidth: 1.5 } }, itemStyle: { borderColor: th.bg, borderWidth: 1 }, progressive: 0 },
      { type: 'heatmap', data: empty, silent: false, emphasis: { disabled: true }, itemStyle: { borderColor: th.bg, borderWidth: 1 }, progressive: 0 },
    ],
  };
}

export function monthOption(tm: ThisMonth, th: Theme): Opt {
  const years = [...tm.histYears, tm.year];
  const data = [...tm.hist.map((v) => ({ value: Math.round(v * 10) / 10, itemStyle: { color: th.ink3, borderRadius: [3, 3, 0, 0] } })), { value: Math.round(tm.value * 10) / 10, itemStyle: { color: th.ember, borderRadius: [3, 3, 0, 0] } }];
  return {
    ...base(th), aria: { enabled: false },
    tooltip: { ...base(th).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 50, right: 12, top: 14, bottom: 28 },
    xAxis: { type: 'category', data: years.map(String), ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 10, fontFamily: mono, interval: years.length > 14 ? 1 : 0 } },
    yAxis: { type: 'value', name: tm.days < 28 ? (tm.approx ? `earlier years pro-rated to ${tm.days} days (approximate)` : `days 1\u2013${tm.days} of each year`) : 'detections', nameTextStyle: { color: th.ink3, fontSize: 10, align: 'left' }, ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 11, fontFamily: mono, formatter: (v: number) => fmt(v) } },
    series: [{ type: 'bar', data, barMaxWidth: 16, markArea: { silent: true, itemStyle: { color: th.ink3, opacity: 0.16 }, data: [[{ yAxis: tm.p10 }, { yAxis: tm.p90 }]] }, markLine: { silent: true, symbol: 'none', lineStyle: { color: th.ink, width: 1.5, type: 'dashed' }, label: { color: th.ink2, fontSize: 10, formatter: 'median', position: 'insideStartTop' }, data: [{ yAxis: tm.median }] } }],
  };
}

export function seasonOption(cl: Climatology, selYear: number | null, arr: Float64Array, th: Theme): Opt {
  const lo = cl.p10.map((v) => v), band = cl.p90.map((v, i) => v - cl.p10[i]);
  const sel = selYear === null ? [] : MONTH_ABBR.map((_, i) => { const v = arr[tFromYM(selYear, i + 1)]; return Number.isFinite(v) ? v : null; });
  const area = (color: string, opacity: number) => ({ color, opacity });
  const series: Opt[] = [
    { name: 'P10', type: 'line', stack: 'b', data: lo, symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
    { name: 'P10–P90', type: 'line', stack: 'b', data: band, symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: area(th.ink3, 0.28), silent: true, tooltip: { show: false } },
    { name: 'Median', type: 'line', data: cl.median, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2, color: th.ink }, itemStyle: { color: th.ink } },
  ];
  if (selYear !== null) series.push({ name: String(selYear), type: 'line', data: sel, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2, color: th.ember }, itemStyle: { color: th.ember } });
  return {
    ...base(th), aria: { enabled: false },
    legend: { data: ['Median', 'P10–P90', ...(selYear !== null ? [String(selYear)] : [])], top: 0, textStyle: { color: th.ink2, fontSize: 11 }, itemHeight: 8 },
    tooltip: { ...base(th).tooltip, trigger: 'axis', formatter: (ps: Opt[]) => { const i = ps[0].dataIndex; return `<b>${MONTH_ABBR[i]}</b><br>Median ${fmt(cl.median[i])}<br>P10–P90 ${fmt(cl.p10[i])}–${fmt(cl.p90[i])}${selYear !== null ? `<br>${selYear}: ${fmt(sel[i] as number)}` : ''}`; } },
    grid: { left: 50, right: 12, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: MONTH_ABBR, boundaryGap: false, ...axisCommon(th), splitLine: { show: false } },
    yAxis: { type: 'value', ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 11, fontFamily: mono, formatter: (v: number) => fmt(v) } },
    series,
  };
}

export function anomalyOption(cells: AnomalyCell[], years: number[], th: Theme): Opt {
  const yi = new Map(years.map((y, i) => [y, i]));
  const data = cells.filter((c) => yi.has(c.year)).map((c) => ({ value: [c.m - 1, yi.get(c.year), Math.round(c.z * 100) / 100] }));
  return {
    ...base(th), aria: { enabled: false },
    tooltip: { ...base(th).tooltip, trigger: 'item', formatter: (p: Opt) => `<b>${years[p.value[1]]}-${String(p.value[0] + 1).padStart(2, '0')}</b><br>robust z = ${p.value[2]}` },
    grid: { left: 46, right: 12, top: 26, bottom: 46 },
    xAxis: { type: 'category', data: MONTH_ABBR, position: 'top', ...axisCommon(th), splitLine: { show: false } },
    yAxis: { type: 'category', data: years.map(String), inverse: true, ...axisCommon(th), splitLine: { show: false }, axisLabel: { color: th.ink3, fontSize: 10, fontFamily: mono, interval: (idx: number) => idx % 2 === 0 || window.innerWidth > 768 } },
    visualMap: { type: 'continuous', min: -3, max: 3, calculable: false, orient: 'horizontal', left: 'center', bottom: 2, itemWidth: 10, itemHeight: 160, text: ['+3', '−3'], textStyle: { color: th.ink2, fontFamily: mono, fontSize: 11 }, inRange: { color: [...th.div].reverse() } },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: th.bg, borderWidth: 1 }, progressive: 0 }],
  };
}

export function beforeAfterOption(s: Series, y0: number, y1: number, tFirst: number, tLast: number, snppEndT: number, th: Theme, cps: { harm: number | null; naive: number | null; harmLabel?: string; naiveLabel?: string; snppX?: number; snppLabel?: string; endLabel?: string } = { harm: null, naive: null }): Opt {
  const naive: number[][] = [], harm: number[][] = [], lo: number[][] = [], band: number[][] = [];
  for (let y = y0; y <= y1; y++) {
    const a = tFromYM(y, 1), b = tFromYM(y, 12);
    if (a < tFirst || b >= tLast) continue;
    let n = 0, h = 0, l = 0, u = 0;
    for (let t = a; t <= b; t++) { n += s.naive[t]; h += s.harm[t]; l += s.lo[t]; u += s.hi[t]; }
    const x = y + 0.5;
    naive.push([x, n]); harm.push([x, h]); lo.push([x, l]); band.push([x, u - l]);
  }
  const ml = (x: number, name: string, color: string, solid = false): Opt => ({ xAxis: x, label: { formatter: name, color: th.ink2, fontSize: 10, position: 'insideEndTop', rotate: 90, align: 'right', distance: 4 }, lineStyle: { color, type: solid ? 'solid' : 'dotted', width: solid ? 1.5 : 1 } });
  const marks: Opt[] = [ml(cps.snppX ?? 2012, `S-NPP starts ${cps.snppLabel ?? ''}${cps.naive ? ` \u00b7 naive break ${cps.naiveLabel ?? ''}` : ''}`, th.ember), ml(yearOf(snppEndT) + (snppEndT % 12) / 12 + 0.07, `S-NPP ends ${cps.endLabel ?? ''}`, th.ink3)];
  if (cps.harm !== null) marks.push(ml(cps.harm, `Harmonized break ${cps.harmLabel ?? ''}`, th.ink, true));
  return {
    ...base(th), aria: { enabled: false },
    legend: { data: ['Naive splice', 'Harmonized', 'Approx. 90% band'], top: 0, textStyle: { color: th.ink2, fontSize: 11 }, itemHeight: 8 },
    tooltip: { ...base(th).tooltip, trigger: 'axis', formatter: (ps: Opt[]) => { const x = ps[0].value[0] - 0.5; const f = (n: string) => { const p = ps.find((q: Opt) => q.seriesName === n); return p ? fmt(p.value[1]) : '–'; }; return `<b>${x}</b><br>Naive ${f('Naive splice')}<br>Harmonized ${f('Harmonized')}`; } },
    grid: { left: 54, right: 14, top: 34, bottom: 26 },
    xAxis: { type: 'value', min: Math.min(y0, 2000), max: yearOf(tLast) + 1, interval: 2, ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 10, fontFamily: mono, formatter: (v: number) => String(v) }, splitLine: { show: false } },
    yAxis: { type: 'value', ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 11, fontFamily: mono, formatter: (v: number) => fmt(v) } },
    series: [
      { name: 'low', type: 'line', stack: 'b', data: lo, symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: 'Approx. 90% band', type: 'line', stack: 'b', data: band, symbol: 'none', itemStyle: { color: th.ink3 }, lineStyle: { opacity: 0 }, areaStyle: { color: th.ink3, opacity: 0.28 }, silent: true, tooltip: { show: false } },
      { name: 'Naive splice', type: 'line', data: naive, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2, color: th.ember, type: 'dashed' }, itemStyle: { color: th.ember }, markLine: { silent: true, symbol: 'none', data: marks } },
      { name: 'Harmonized', type: 'line', data: harm, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5, color: th.ink }, itemStyle: { color: th.ink } },
    ],
  };
}

export function pctl(a: number[], p: number): number { return percentile(a, p); }

/** Annual harmonized totals of two areas overlaid (naive splice dashed). */
export function compareAnnualOption(a: Series, b: Series, nameA: string, nameB: string, y0: number, y1: number, tFirst: number, tLast: number, th: Theme): Opt {
  const col = [th.ink, th.viirs];
  const mk = (sr: Series, key: 'harm' | 'naive') => {
    const out: number[][] = [];
    for (let y = y0; y <= y1; y++) {
      const t0 = tFromYM(y, 1), t1 = tFromYM(y, 12);
      if (t0 < tFirst || t1 >= tLast) continue;
      let v = 0; for (let t = t0; t <= t1; t++) v += sr[key][t];
      out.push([y + 0.5, v]);
    }
    return out;
  };
  const line = (name: string, data: number[][], color: string, dashed: boolean): Opt => ({ name, type: 'line', data, symbol: 'circle', symbolSize: 4, lineStyle: { width: dashed ? 1.5 : 2.5, color, type: dashed ? 'dashed' : 'solid' }, itemStyle: { color } });
  return {
    ...base(th), aria: { enabled: false },
    legend: { data: [nameA, nameB, `${nameA} (naive)`, `${nameB} (naive)`], top: 0, textStyle: { color: th.ink2, fontSize: 11 }, itemHeight: 8 },
    tooltip: { ...base(th).tooltip, trigger: 'axis', formatter: (ps: Opt[]) => `<b>${Math.floor(ps[0].value[0])}</b><br>` + ps.map((p: Opt) => `${p.seriesName}: ${fmt(p.value[1])}`).join('<br>') },
    grid: { left: 54, right: 14, top: 44, bottom: 26 },
    xAxis: { type: 'value', min: Math.min(y0, 2000), max: yearOf(tLast) + 1, interval: 2, ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 10, fontFamily: mono, formatter: (v: number) => String(v) }, splitLine: { show: false } },
    yAxis: { type: 'value', ...axisCommon(th), axisLabel: { color: th.ink3, fontSize: 11, fontFamily: mono, formatter: (v: number) => fmt(v) } },
    series: [line(nameA, mk(a, 'harm'), col[0], false), line(nameB, mk(b, 'harm'), col[1], false), line(`${nameA} (naive)`, mk(a, 'naive'), col[0], true), line(`${nameB} (naive)`, mk(b, 'naive'), col[1], true)],
  };
}
