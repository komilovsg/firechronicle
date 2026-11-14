import './style.css';
import { el } from './ui/dom';
import { cellToLatLng } from 'h3-js';
import { loadMeta, loadRegions, loadCountries, loadCells, loadMonthly, loadPartial, type Countries, type Partial } from './data';
import { CellIndex, seriesFromRegion, sensorTs, type Meta, type Region, type Series } from './lib/series';
import { circlePolygon, bboxOf, geometryPolys, pointInPolys, type Poly, type Pt } from './lib/geo';
import { encodeHash, parseHash, MAX_VERTS, type AoiSpec, type CalMode } from './lib/hash';
import { MONTH_FULL, MONTH_ABBR, daysInMonth, monthOf, tFromYM, tLabel, yearOf } from './lib/time';
import { median, percentile } from './lib/stats';
import { detectSeason, monthRanges, anomalies, annualTotals, buildSummary, climatology, ordinal, outlook, outlookText, thisMonthStats, type Mode } from './lib/analytics';
import type * as ChartsMod from './charts';
import type { Chart } from './charts';
import type { FireMap } from './map';
import type { Replay } from './replay';
import { cpToX, cvRows, DASH, fmtP, headline, independentCheck, notes, perYearBias, pick, num, str } from './lib/validation';
import { SEQ, gradientCss, onThemeChange, prefersDark, theme, themeMode, applyThemeMode, type ThemeMode } from './theme';
import { fmtInt } from './lib/format';
import { enhanceAll } from './ui/select';
import { initFreshness } from './freshnessUi';
import { initAssistant } from './assistant';
import { openStylePanel, refreshStylePanel, type BmApi } from './basemap';
import { BM_IDS, imageryDateFor, addDays, clampImageryDate, parseBm, type BmId } from './lib/gibs';
import type { FsApi, HudData } from './fullscreen';
import { parseRefresh } from './lib/freshness';
import { encodeCmp, parseCmp } from './lib/cmp';
import { ytdStats } from './lib/analytics';
import { anomalyNow, anomalyBin, rankUnusual, unusualText, unusualBadge, noUnusualText, type CellAnomaly } from './lib/anomalyNow';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const fmt = fmtInt;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface State { aoi: AoiSpec; y0: number; y1: number; mode: CalMode; frameT: number | null; seasonYear: number | null }
let meta: Meta, regions: Region[], countries: Countries, cellIds: string[] = [];
let lat: Float64Array, lon: Float64Array;
let cellCountry: string[] | null = null;
let index: CellIndex | null = null;
let monthlyPromise: Promise<void> | null = null;
let aoiCells: number[] = [], aoiName = '', aoiRing: Pt[] | null = null, aoiPolys: Poly[] | null = null;
let series: Series | null = null;
let monthVmax = 1;
let fireMap: FireMap | undefined, replay: Replay | undefined;
let partial: Partial | null = null;
let bm: BmId = 'mono', imgManual: string | null = null, imgKey = '', lastImgSync = 0, imgTimer = 0;
let cmp: AoiSpec | null = null, cmpSeries: Series | null = null, cmpName = '';
let legendKey = '';
let mapMode: 'activity' | 'anomaly' = 'activity';
let anom: CellAnomaly | null = null, anomT = 0;
let C: typeof ChartsMod | null = null;
let visuals: Promise<void> | null = null;
const charts: Record<string, Chart> = {};
const state: State = { aoi: { kind: 'region', id: 'central-asia' }, y0: 2000, y1: 2026, mode: 'harm', frameT: null, seasonYear: null };
let lastYear = 2026;

const MODE_LABEL: Record<CalMode, string> = { harm: 'Harmonized', modis: 'Raw MODIS', viirs: 'Raw VIIRS', naive: 'Naive splice', swipe: 'Swipe: naive vs harmonized' };
const MODE_NOTE: Record<CalMode, string> = {
  harm: 'MODIS-equivalent detections per month, all sensors calibrated to one scale.',
  modis: 'Raw Terra + Aqua detections, no calibration. Empty before November 2000.',
  viirs: 'Raw VIIRS detections, averaged over the VIIRS satellites active that month. Empty before VIIRS starts.',
  naive: 'MODIS before VIIRS starts, then S-NPP (NOAA-20 once S-NPP ended), stitched without calibration. Note the step at the switch.',
  swipe: 'Drag the handle, or focus it and use the arrow keys. Left: naive splice. Right: harmonized. Same colour scale.',
};

function setStatus(msg: string, retry?: () => void): void {
  const s = $('status'); s.textContent = '';
  if (!msg) return;
  s.append(el('span', undefined, msg));
  if (retry) { const b = el('button', 'btn', 'Retry') as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', retry); s.append(b); }
}
const chart = (key: string, id: string): Chart => (charts[key] ??= C!.makeChart($(id)));

/* ---------- AOI ---------- */
function polysForAoi(a: AoiSpec): Poly[] | null {
  if (a.kind === 'polygon') return [[a.pts]];
  if (a.kind === 'circle') return [[circlePolygon(a.lat, a.lon, a.r)]];
  if (a.id === 'central-asia') return null;
  const f = countries.features.find((x) => x.properties.id === a.id);
  return f ? geometryPolys(f.geometry as { type: string; coordinates: unknown }) : null;
}
function computeAoi(): void {
  const a = state.aoi;
  aoiPolys = polysForAoi(a);
  // outline and map bounds use the largest outer ring (the mainland for multi-part countries)
  aoiRing = aoiPolys ? aoiPolys.map((p) => p[0]).reduce((x, y) => (y.length > x.length ? y : x)) : null;
  aoiCells = [];
  for (let i = 0; i < cellIds.length; i++) if (!aoiPolys || pointInPolys(lon[i], lat[i], aoiPolys)) aoiCells.push(i);
  if (a.kind === 'region') aoiName = a.id === 'central-asia' ? meta.region.name : (countries.features.find((f) => f.properties.id === a.id)?.properties.name ?? a.id);
  else if (a.kind === 'polygon') aoiName = `Custom polygon, ${a.pts.length} points`;
  else aoiName = `${a.r} km around ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`;
}
async function ensureMonthly(): Promise<void> {
  if (index) return;
  monthlyPromise ??= loadMonthly().then((m) => { index = new CellIndex(m, cellIds.length, meta.t_last + 1); });
  try { await monthlyPromise; } catch (e) { monthlyPromise = null; throw e; }
}
function getSeries(): Series | null {
  const a = state.aoi;
  if (a.kind === 'region') { const r = regions.find((x) => x.id === a.id); if (r) return seriesFromRegion(r, meta); }
  if (index) return index.aggregate(aoiCells, meta);
  return null;
}

/* ---------- rendering ---------- */
let renderToken = 0;
async function refresh(fit = true): Promise<void> {
  const token = ++renderToken;
  computeAoi();
  anom = null; renderUnusual();
  $('maphint').hidden = !(state.aoi.kind === 'region' && state.aoi.id === 'central-asia');
  $('aoi-name').textContent = aoiName;
  syncControls();
  writeHash();
  if (!aoiCells.length) { showEmpty(); drawShape(); return; }
  $('panel').removeAttribute('data-empty');
  series = getSeries();
  if (!series) {
    setStatus('Loading cell data for this area…');
    try { await ensureMonthly(); } catch { setStatus('Could not load monthly.json.', () => void refresh()); return; }
    if (token !== renderToken) return;
    setStatus('');
    series = getSeries();
  }
  if (!series) return;
  await computeCmp();
  renderText();
  try { await visuals; } catch { return; }
  if (token !== renderToken || !C) return;
  renderCharts();
  drawShape();
  if (fit) fitMap();
  void mapAfterIndex(token);
}
function showEmpty(): void {
  $('panel').setAttribute('data-empty', '1');
  const s = $('summary'); s.textContent = '';
  s.append(el('div', 'empty-state', 'No fire detections have been recorded in this area. Try a larger polygon or radius, or pick a country.'));
  fireMap?.setHexes([], 1000);
  $('maplegend').textContent = ''; $('mapnote').textContent = '';
}
function drawShape(): void {
  fireMap?.setShape(state.aoi.kind === 'region' && state.aoi.id === 'central-asia' ? null : aoiRing);
}
function fitMap(): void {
  let b: [number, number, number, number];
  if (aoiRing && state.aoi.kind !== 'region') b = bboxOf(aoiRing);
  else { const pts: Pt[] = aoiCells.map((i) => [lon[i], lat[i]] as Pt); b = bboxOf(aoiRing && state.aoi.kind === 'region' ? aoiRing : pts); b = [b[0] - 0.3, b[1] - 0.3, b[2] + 0.3, b[3] + 0.3]; }
  const fm = fireMap; if (fm) void fm.ready.then(() => fm.resetTo(b, true));
}
const pdays = (): number => partial?.days ?? meta.current_month_partial_days;
/** Same-days (1..D) totals of earlier years for the selected area, from partial.json; null = not available. */
function partialHist(): { t: number[]; v: number[] } | null {
  if (!partial || partial.t_month !== meta.t_last) return null;
  const a = state.aoi, r = a.kind === 'region' ? partial.regions?.[a.id] : undefined;
  if (r) return { t: r.t, v: r.harm };
  if (!partial.c.length) return null;
  const mask = new Uint8Array(cellIds.length); for (const c of aoiCells) mask[c] = 1;
  const by = new Map<number, number>();
  for (let i = 0; i < partial.c.length; i++) if (mask[partial.c[i]]) by.set(partial.t[i], (by.get(partial.t[i]) ?? 0) + partial.harm[i]);
  const ts = [...by.keys()].sort((x, y) => x - y);
  return { t: ts, v: ts.map((t) => by.get(t)!) };
}
function valuesFor(mode: Mode): Float64Array { return series![mode]; }

async function computeCmp(): Promise<void> {
  cmpSeries = null; cmpName = '';
  if (!cmp) return;
  if (cmp.kind === 'region') {
    const cid = cmp.id, r = regions.find((x) => x.id === cid);
    if (r) { cmpSeries = seriesFromRegion(r, meta); cmpName = r.name; return; }
  }
  const polys = polysForAoi(cmp);
  const cells: number[] = [];
  for (let i = 0; i < cellIds.length; i++) if (!polys || pointInPolys(lon[i], lat[i], polys)) cells.push(i);
  if (!cells.length) return;
  try { await ensureMonthly(); } catch { return; }
  cmpSeries = index!.aggregate(cells, meta);
  cmpName = cmp.kind === 'polygon' ? `Custom polygon, ${cmp.pts.length} points` : cmp.kind === 'circle' ? `${cmp.r} km around ${cmp.lat.toFixed(1)}, ${cmp.lon.toFixed(1)}` : (cmp as { id: string }).id;
}
function renderText(): void {
  const s = series!;
  const sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const harm = s.harm;
  // summary + outlook
  const sum = $('summary'); sum.textContent = '';
  const lines = buildSummary({ arr: harm, y0: state.y0, y1: state.y1, sp, partialDays: pdays(), partialHist: partialHist() });
  const o = outlook(harm, sp);
  [...lines, outlookText(o)].forEach((t) => sum.append(el('p', undefined, t)));
  const strip = $('outlook'); strip.textContent = '';
  for (const m of o.months) {
    const c = el('div', 'cellm' + (m.critical ? ' crit' : ''));
    c.setAttribute('role', 'listitem');
    c.setAttribute('aria-label', `${MONTH_FULL[m.m - 1]} ${m.year}: ${Math.round(m.p * 100)}% chance of a high-activity month${m.critical ? ', likely high-activity' : ''}`);
    c.append(el('span', undefined, MONTH_ABBR[m.m - 1]), el('b', undefined, `${Math.round(m.p * 100)}%`));
    const bar = el('i'); bar.style.width = `${Math.round(m.p * 100)}%`; c.append(bar);
    strip.append(c);
  }
  $('outlook-note').textContent = `Share of the last ${o.years} years in which this month was above the area's recent 75th percentile (${fmt(o.threshold)} detections per month), Laplace-smoothed: (k+1)/(n+2). Months at 50% or more are marked. Climatology, not a forecast.`;

}
function renderCharts(): void {
  const s = series!, th = theme(), { monthOption, seasonOption, anomalyOption, beforeAfterOption } = C!;
  const sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const harm = s.harm;
  renderCalendar();
  // this month
  const tm = thisMonthStats(harm, state.y0, state.y1, sp, pdays(), partialHist());
  if (tm) {
    const pct = Number.isFinite(tm.pctVsMedian) ? `${tm.pctVsMedian >= 0 ? '+' : '−'}${Math.abs(Math.round(tm.pctVsMedian))}% vs median` : 'no median to compare';
    const dim = daysInMonth(tm.year, tm.month);
    const part = tm.days < dim ? ` so far (${tm.days} of ${dim} days; ${tm.approx ? 'approximate: earlier years pro-rated by days' : `compared with days 1\u2013${tm.days} of earlier years`})` : '';
    $('month-text').textContent = `${MONTH_FULL[tm.month - 1]} ${tm.year}${part}: ${fmt(tm.value)} detections, ${pct}, ${ordinal(tm.rank)} percentile.`;
    chart('month', 'month-chart').setOption(monthOption(tm, th), true);
    $('month-chart').setAttribute('aria-label', `Bar chart of ${MONTH_FULL[tm.month - 1]} detections for each year. ${tm.year}: ${fmt(tm.value)}; median ${fmt(tm.median)}; P10 to P90 ${fmt(tm.p10)} to ${fmt(tm.p90)}.`);
  } else { $('month-text').textContent = 'Not enough history to compare this month.'; charts.month?.clear(); }
  // season
  const cl = climatology(harm, state.y0, state.y1, sp);
  const full = annualTotals(harm, state.y0, state.y1, sp).map((a) => a.year);
  const sel = $<HTMLSelectElement>('season-year');
  const keep = state.seasonYear !== null && full.includes(state.seasonYear) ? state.seasonYear : (full[full.length - 1] ?? null);
  state.seasonYear = keep;
  sel.textContent = '';
  full.forEach((y) => { const op = el('option', undefined, String(y)) as HTMLOptionElement; op.value = String(y); sel.append(op); });
  if (keep !== null) sel.value = String(keep);
  chart('season', 'season-chart').setOption(seasonOption(cl, keep, harm, th), true);
  const pk = cl.median.indexOf(Math.max(...cl.median.filter(Number.isFinite)));
  $('season-chart').setAttribute('aria-label', `Line chart of monthly median detections with P10 to P90 band. Peak month ${MONTH_FULL[pk] ?? 'n/a'} at ${fmt(cl.median[pk])}.`);
  // anomalies
  const years: number[] = []; for (let y = state.y0; y <= state.y1; y++) years.push(y);
  const an = anomalies(harm, state.y0, state.y1, sp);
  chart('anom', 'anom-chart').setOption(anomalyOption(an, years, th), true);
  const hi = an.reduce((a, b) => (b.z > a.z ? b : a), an[0] ?? { z: 0, m: 1, year: 0 });
  $('anom-chart').setAttribute('aria-label', `Heatmap of robust z-scores by year and month. Largest positive anomaly ${hi.year}-${String(hi.m).padStart(2, '0')}, z = ${hi.z.toFixed(1)}.`);
  // before / after
  const snppEnd = sensorTs(meta).snppEnd;
  const hl = headline(meta.validation);
  if (cmpSeries) chart('ba', 'ba-chart').setOption(C!.compareAnnualOption(s, cmpSeries, aoiName, cmpName, state.y0, state.y1, meta.t_first, meta.t_last, th), true);
  else chart('ba', 'ba-chart').setOption(beforeAfterOption(s, state.y0, state.y1, meta.t_first, meta.t_last, snppEnd, th, { harm: cpToX(hl.harmCp), naive: cpToX(hl.naiveCp), harmLabel: hl.harmCp ?? '', naiveLabel: hl.naiveCp ?? '', snppX: yearOf(sensorTs(meta).snppStart) + ((sensorTs(meta).snppStart % 12) / 12), snppLabel: tLabel(sensorTs(meta).snppStart), endLabel: tLabel(snppEnd) }), true);
  const tot = (a: Float64Array, y: number) => { let x = 0; for (let t = tFromYM(y, 1); t <= tFromYM(y, 12); t++) x += a[t]; return x; };
  $('ba-chart').setAttribute('aria-label', `Annual totals, naive splice versus harmonized. 2011: naive ${fmt(tot(s.naive, 2011))}, harmonized ${fmt(tot(s.harm, 2011))}. 2012: naive ${fmt(tot(s.naive, 2012))}, harmonized ${fmt(tot(s.harm, 2012))}.`);
  replay?.setData(harm, meta.t_first, meta.t_last, th); hudPing();
}

function renderCompareCalendar(): void {
  const A = series!, B = cmpSeries!, th = theme(), mode = state.mode === 'swipe' ? 'harm' : (state.mode as Mode);
  const years: number[] = []; for (let y = state.y0; y <= state.y1; y++) years.push(y);
  const pos: number[] = [];
  for (const a of [A[mode], B[mode]]) for (let t = meta.t_first; t <= meta.t_last; t++) if (a[t] > 0) pos.push(a[t]);
  const vmax = Math.max(1, Math.round(percentile(pos, 98)));
  const mk = (sr: Series, label: string) => C!.calendarOption({ s: sr, arr: sr[mode], years, tFirst: meta.t_first, tLast: meta.t_last, tNrt: meta.t_nrt_from, vmax, selT: null, th, label: MODE_LABEL[mode] + ': ' + label });
  $('cal-stage').hidden = true; $('cmp-wrap').hidden = false;
  $('cmp-title-a').textContent = aoiName; $('cmp-title-b').textContent = cmpName;
  const a = chart('cmpA', 'cmp-a'), b = chart('cmpB', 'cmp-b');
  a.resize(); b.resize(); a.setOption(mk(A, aoiName), true); b.setOption(mk(B, cmpName), true);
  $('cmp-a').setAttribute('aria-label', `Calendar heatmap for ${aoiName}, same colour scale as ${cmpName}, 0 to ${fmt(vmax)} or more`);
  $('cmp-b').setAttribute('aria-label', `Calendar heatmap for ${cmpName}, same colour scale as ${aoiName}, 0 to ${fmt(vmax)} or more`);
  $('cal-note').textContent = `Both areas share one colour scale (0 to ${fmt(vmax)}+). ${MODE_NOTE[mode]}`;
  const lg = $('cal-legend'); lg.textContent = '';
  for (const [cls, txt] of [['nrt', `Provisional (NRT), from ${tLabel(meta.t_nrt_from)}`], ['empty', 'No data for this source']] as const) { const li = el('li'); li.append(el('span', `sw ${cls}`), txt); lg.append(li); }
}
function renderCalendar(): void {
  if (!C) return;
  if (cmpSeries) { renderCompareCalendar(); return; }
  $('cmp-wrap').hidden = true; $('cal-stage').hidden = false;
  const s = series!, th = theme(), mode = state.mode;
  const years: number[] = []; for (let y = state.y0; y <= state.y1; y++) years.push(y);
  const swipe = mode === 'swipe';
  const arrA = valueSeries(swipe ? 'naive' : (mode as Mode)), arrB = s.harm;
  const pos: number[] = [];
  for (const a of swipe ? [arrA, arrB] : [arrA]) for (let t = meta.t_first; t <= meta.t_last; t++) if (a[t] > 0) pos.push(a[t]);
  const vmax = Math.max(1, Math.round(percentile(pos, 98)));
  const mk = (arr: Float64Array, label: string) => C!.calendarOption({ s, arr, years, tFirst: meta.t_first, tLast: meta.t_last, tNrt: meta.t_nrt_from, vmax, selT: state.frameT, th, label });
  const a = chart('calA', 'cal-a');
  a.setOption(mk(arrA, swipe ? 'Naive splice' : MODE_LABEL[mode]), true);
  $('cal-b').hidden = !swipe; $('cal-handle').hidden = !swipe; $('chip-l').hidden = !swipe; $('chip-r').hidden = !swipe;
  if (swipe) { const b = chart('calB', 'cal-b'); b.resize(); b.setOption(mk(arrB, 'Harmonized'), true); }
  a.off('click'); a.on('click', onCalClick);
  if (swipe) { charts.calB.off('click'); charts.calB.on('click', onCalClick); }
  $('cal-note').textContent = MODE_NOTE[mode];
  let top = { t: meta.t_first, v: -1 };
  for (let t = meta.t_first; t <= meta.t_last; t++) if (arrA[t] > top.v) top = { t, v: arrA[t] };
  const desc = `Heatmap of ${MODE_LABEL[mode]} detections, ${years[0]} to ${years[years.length - 1]}, months across and years down. Busiest month ${tLabel(top.t)} with ${fmt(top.v)}. Color scale 0 to ${fmt(vmax)} or more.`;
  $('cal-a').setAttribute('aria-label', desc);
  $('cal-b').setAttribute('aria-label', 'Heatmap of harmonized detections, right side of the comparison');
  const lg = $('cal-legend'); lg.textContent = '';
  for (const [cls, txt] of [['nrt', `Provisional (NRT), from ${tLabel(meta.t_nrt_from)}`], ['empty', 'No data for this source']] as const) { const li = el('li'); li.append(el('span', `sw ${cls}`), txt); lg.append(li); }
  const unit = el('li', undefined, meta.units); lg.append(unit);
}
const valueSeries = (m: Mode): Float64Array => valuesFor(m);
function onCalClick(p: { seriesIndex?: number; value?: unknown }): void {
  if (p.seriesIndex !== 0 || !Array.isArray(p.value)) return;
  state.frameT = p.value[3] as number;
  replay?.setT(state.frameT, false);
  renderCalendar(); renderMap();
}

function biasStrip(rows: { year: number; bias: number }[]): HTMLElement {
  const wrap = el('div', 'biasbox');
  wrap.append(el('div', 'cap', 'Year-level bias: each left-out year, S-NPP prediction vs MODIS (%)'));
  const strip = el('div', 'bias-strip'); strip.setAttribute('role', 'img');
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.bias)));
  strip.setAttribute('aria-label', `Year-level bias from ${rows[0].year} to ${rows[rows.length - 1].year}, largest ${max.toFixed(1)} percent`);
  for (const r of rows) {
    const b = el('span', 'bb'); b.title = `${r.year}: ${r.bias > 0 ? '+' : r.bias < 0 ? '\u2212' : ''}${Math.abs(r.bias).toFixed(1)}%`;
    const bar = el('i', r.bias >= 0 ? 'pos' : 'neg'); bar.style.height = `${(Math.abs(r.bias) / max) * 50}%`; b.append(bar); strip.append(b);
  }
  wrap.append(strip, el('div', 'cap', `${rows[0].year}\u2013${rows[rows.length - 1].year}, scale \u00b1${max.toFixed(1)}%`));
  return wrap;
}
function renderProof(): void {
  const v = meta.validation, h = headline(v);
  const trio = $('trio'); trio.textContent = '';
  const add = (cls: string, k: string, val: string, sub: string) => { const li = el('li', cls); li.append(el('div', 'k', k), el('div', 'v', val), el('div', 's', sub)); trio.append(li); };
  add('bad', 'Naive stitching', h.naive, h.naiveCp ? `wrong sign; change point ${h.naiveCp}, the sensor switch` : 'wrong sign; sensors joined without calibration');
  add('', 'MODIS only', h.modis, h.modisCp ? `one sensor, no splice; change point ${h.modisCp}` : 'one sensor, no splice');
  add('', 'Harmonized', h.harm, h.harmCp ? `all sensors, one scale; change point ${h.harmCp}` : 'all sensors, one scale');
  $('ba-why').textContent = `Naive stitching flips the sign of the change (2012\u201325 vs 2001\u201311: ${h.naive} vs ${h.harm}) and hides a clear decline.`;
  // validation panel
  const box = $('valid'); box.textContent = '';
  const ic = independentCheck(v), rows = cvRows(v), head = rows[0];
  box.append(el('h3', undefined, 'Independent check'));
  box.append(el('p', 'cap', `Predicting each left-out year's monthly MODIS totals from VIIRS S-NPP alone gives R\u00b2 ${ic.r2} vs ${ic.baseline} for a seasonal-climatology baseline.`));
  if (head) {
    const big = el('div', 'big');
    for (const [k, val] of [['Bias', head.bias], ['MAE', head.mae], ['R\u00b2', head.r2]]) { const d = el('div'); d.append(el('b', undefined, val), el('span', undefined, k)); big.append(d); }
    box.append(el('h3', undefined, 'Leave-one-year-out, region by month'), big);
    const tb = el('table'); const hd = el('tr');
    ['Sensor', 'Bias', 'MAE', 'R\u00b2', 'n'].forEach((t) => hd.append(el('th', undefined, t))); tb.append(hd);
    rows.forEach((r) => { const tr = el('tr'); [r.sensor, r.bias, r.mae, r.r2, r.n].forEach((t) => tr.append(el('td', undefined, t))); tb.append(tr); });
    box.append(tb);
  } else box.append(el('p', 'cap', 'Cross-validation numbers are not available in this data release.'));
  for (const [k, label] of [['snpp', 'S-NPP']] as const) { const pb = perYearBias(v, k); if (pb.length) box.append(biasStrip(pb)); else if (k === 'snpp') box.append(el('p', 'cap', `Year-level bias (${label}): ${DASH}`)); }
  if (meta.sample) box.append(el('p', 'cap', 'Sample data: placeholder numbers.'));
}
const SVGNS = 'http://www.w3.org/2000/svg';
/** Tiny inline chart of annual totals; a dashed tick marks the year the sensors were switched. */
function spark(vals: { year: number; total: number }[], color: string, markYear: number): SVGElement {
  const w = 120, h = 30, max = Math.max(1, ...vals.map((v) => v.total)), x = (i: number): number => (i / Math.max(1, vals.length - 1)) * (w - 4) + 2, y = (v: number): number => h - 3 - (v / max) * (h - 8);
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class', 'tspark'); svg.setAttribute('aria-hidden', 'true');
  const mi = vals.findIndex((v) => v.year === markYear);
  if (mi >= 0) { const l = document.createElementNS(SVGNS, 'line'); l.setAttribute('x1', String(x(mi))); l.setAttribute('x2', String(x(mi))); l.setAttribute('y1', '1'); l.setAttribute('y2', String(h - 1)); l.setAttribute('stroke', 'currentColor'); l.setAttribute('stroke-dasharray', '2 2'); l.setAttribute('opacity', '.45'); svg.append(l); }
  const pl = document.createElementNS(SVGNS, 'polyline'); pl.setAttribute('points', vals.map((v, i) => `${x(i).toFixed(1)},${y(v.total).toFixed(1)}`).join(' ')); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '1.8'); pl.setAttribute('stroke-linejoin', 'round'); svg.append(pl);
  return svg;
}
function renderInsights(): void {
  const v = meta.validation, h = headline(v), ic = independentCheck(v), st = sensorTs(meta);
  const y1 = yearOf(meta.t_last) - 1, yS = yearOf(st.snppStart), yF = yearOf(meta.t_first) + 1;
  $('h-proof').textContent = `Change in fire activity, ${yS}\u2013${y1} vs ${yF}\u2013${yS - 1}`;
  $('proof-cap').textContent = 'Central Asia';
  const ul = $('insights'); ul.textContent = '';
  const ca = regions.find((r) => r.id === 'central-asia');
  const caSeries = ca ? seriesFromRegion(ca, meta) : null, sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const naiveAnn = caSeries ? annualTotals(caSeries.naive, 2000, y1, sp) : [], harmAnn = caSeries ? annualTotals(caSeries.harm, 2000, y1, sp) : [];
  const nr = num(pick(v, 'naive_break_2012', 'jump_ratio')), hr = num(pick(v, 'harmonized_break_2012', 'jump_ratio'));
  const tile = (cls: string, label: string, value: string, badge: { cls: string; text: string } | null, note: string, chart: SVGElement | null): void => {
    const li = el('li', `tile ${cls}`); li.append(el('div', 'k', label), el('div', 'v', value));
    if (badge) li.append(el('span', `pill ${badge.cls}`, badge.text));
    li.append(el('div', 's', note)); if (chart) li.append(chart); ul.append(li);
  };
  const cs = getComputedStyle(document.documentElement), ember = cs.getPropertyValue('--ember').trim() || '#ff7d33', ink = cs.getPropertyValue('--ink').trim() || '#fff';
  tile('naive', 'Just stitching MODIS \u2192 VIIRS', h.naive, nr === null ? null : { cls: 'warn', text: nr > 1 ? '\u2717 false rise' : '\u2717 false change' }, `created by the sensor switch in ${yS}, not by fires`, naiveAnn.length ? spark(naiveAnn, ember, yS) : null);
  tile('harm', 'FireChronicle (harmonized)', h.harm, hr === null ? null : { cls: 'ok', text: hr < 1 ? '\u2713 real decline' : '\u2713 real rise' }, h.modis !== DASH ? `MODIS alone agrees: ${h.modis}` : 'calibrated to one scale', harmAnn.length ? spark(harmAnn, ink, yS) : null);
  tile('check', 'Independent check', ic.r2 === DASH ? DASH : `R\u00b2 ${ic.r2}`, null, `VIIRS predicts left-out MODIS years${ic.baseline !== DASH ? ` \u00b7 baseline ${Number(ic.baseline).toFixed(2)}` : ''}`, null);
}

/* ---------- map frame ---------- */
async function mapAfterIndex(token: number): Promise<void> {
  const cells = aoiCells.map((idx) => ({ idx, id: cellIds[idx] }));
  const dLon = Math.max(...aoiCells.map((i) => lon[i])) - Math.min(...aoiCells.map((i) => lon[i])), dLat = Math.max(...aoiCells.map((i) => lat[i])) - Math.min(...aoiCells.map((i) => lat[i]));
  const diag = Math.hypot(dLon * 80, dLat * 111) * 1000;
  const height = Math.min(150000, Math.max(12000, diag * 0.08));
  if (!fireMap) return;
  await fireMap.ready;
  fireMap.setHexes(cells, height);
  try { await ensureMonthly(); } catch { $('mapnote').textContent = 'Cell data failed to load.'; return; }
  if (token !== renderToken || !index) return;
  const all: number[] = [];
  const mask = new Uint8Array(cellIds.length); for (const c of aoiCells) mask[c] = 1;
  const m = index.m;
  for (let r = 0; r < m.c.length; r++) if (mask[m.c[r]] && m.harm[r] > 0) all.push(m.harm[r]);
  monthVmax = Math.max(1, percentile(all, 98));
  anomT = anomalyTarget(); anom = anomalyNow(index, aoiCells, anomT, meta.t_first); renderUnusual();
  renderMap();
}
function anomalyTarget(): number {
  return pdays() < daysInMonth(yearOf(meta.t_last), monthOf(meta.t_last)) ? meta.t_last - 1 : meta.t_last;
}
/** Country label for a cell: the pipeline's per-cell ISO3 when present, else a polygon test of its centre. */
function cellCountryName(c: number): string {
  const iso = cellCountry?.[c];
  if (iso) return countries.features.find((f) => f.properties.id === iso)?.properties.name ?? iso;
  return countryOf(lon[c], lat[c]);
}
function countryOf(lo: number, la: number): string {
  for (const f of countries.features) if (pointInPolys(lo, la, geometryPolys(f.geometry as { type: string; coordinates: unknown }))) return f.properties.name;
  return 'Outside the six countries';
}
const hemi = (v: number, p: string, n: string): string => `${Math.abs(v).toFixed(1)}\u00b0${v >= 0 ? p : n}`;
function unusualRanked() { return anom ? rankUnusual(anom, aoiCells, { k: 5, groupOf: (c) => cellCountryName(c) }) : null; }
function renderUnusual(): void {
  const note = $('unusual-note'), ol = $('toplist'); ol.textContent = '';
  if (!anom) { note.textContent = 'Loading cell data\u2026'; return; }
  const { list } = unusualRanked()!;
  if (!list.length) { note.textContent = noUnusualText(anomT); hudPing(); return; }
  note.textContent = `Latest complete month, ${MONTH_FULL[monthOf(anomT) - 1]} ${yearOf(anomT)}, compared with the same month of earlier years, cell by cell. Cells need 5+ years of history and a clearly busy month. Click one to see it on the map.`;
  list.forEach((u, i) => {
    const li = el('li'), b = el('button') as HTMLButtonElement; b.type = 'button';
    const la = lat[u.cell], lo = lon[u.cell], detail = unusualText(u, anomT, meta.t_first);
    const mid = el('span'); mid.append(cellCountryName(u.cell)); mid.append(el('small', undefined, `${hemi(la, 'N', 'S')} ${hemi(lo, 'E', 'W')}`)); mid.append(el('small', undefined, detail));
    b.append(el('span', 'rk', String(i + 1)), mid, el('span', 'pc', unusualBadge(u)));
    b.setAttribute('aria-label', `Rank ${i + 1}: ${cellCountryName(u.cell)}, ${hemi(la, 'N', 'S')} ${hemi(lo, 'E', 'W')}. ${detail}. Show on map.`);
    b.addEventListener('click', () => { setMapMode('anomaly'); fireMap?.flyTo(lo, la, 7); $('map').scrollIntoView({ block: 'nearest' }); });
    li.append(b); ol.append(li);
  });
  hudPing();
}
function setMapMode(m: 'activity' | 'anomaly'): void {
  mapMode = m; hudPing();
  document.querySelectorAll<HTMLElement>('#maplayers button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === m)));
  fireMap?.setMode(m);
  renderMap();
}
function renderAnomalyLayer(): void {
  if (!anom || !fireMap) return;
  const th = theme(), cols = [th.div[0], th.div[1], th.div[2], th.div[3], th.div[4]];
  const colors: string[] = new Array(cellIds.length).fill('#888888'); const heights = new Float64Array(cellIds.length);
  for (const c of aoiCells) {
    const b = anomalyBin(anom.pct[c]);
    colors[c] = b < 0 ? (th.dark ? '#6b7380' : '#9aa1ab') : cols[b];
    heights[c] = b < 0 ? 0.04 : 0.1 + 0.9 * (anom.pct[c] / 100);
  }
  fireMap.setAnomaly(colors, heights); fireMap.setMode('anomaly');
  const note = $('mapnote'); note.textContent = `Anomaly now \u00b7 ${tLabel(anomT)} vs earlier ${MONTH_FULL[monthOf(anomT) - 1]}s`;
  const lg = $('maplegend'); lg.textContent = '';
  const g = el('div', 'legend-grid');
  const row = (sw: string[], text: string) => { const r = el('div', 'row3'); sw.forEach((c) => { const x = el('span', 'sw2'); x.style.background = c; r.append(x); }); r.append(text); g.append(r); };
  row([cols[0], cols[1]], 'Below normal'); row([cols[2]], 'Normal'); row([cols[3]], 'Above normal'); row([cols[4]], 'Extreme (\u2265 95th pct)'); row([th.dark ? '#6b7380' : '#9aa1ab'], 'Not enough history');
  lg.append(g);
}
function renderMap(): void {
  syncImagery();
  if (mapMode === 'anomaly') { renderAnomalyLayer(); return; }
  fireMap?.setMode('activity');
  if (!index || !aoiCells.length || !replay) return;
  const mask = new Uint8Array(cellIds.length); for (const c of aoiCells) mask[c] = 1;
  const note = $('mapnote'); note.textContent = '';
  let vals: Float64Array, vmax: number, label: string;
  if (state.frameT !== null) {
    vals = index.frame(state.frameT, mask); vmax = monthVmax; label = tLabel(state.frameT);
    note.append(el('span', undefined, `Month ${label}`));
    if (!replay.playing) { const b = el('button', 'btn small', 'Show period') as HTMLButtonElement; b.type = 'button'; b.style.marginLeft = '8px'; b.addEventListener('click', () => { state.frameT = null; renderCalendar(); renderMap(); }); note.append(b); }
  } else {
    const t0 = Math.max(meta.t_first, tFromYM(state.y0, 1)), t1 = Math.min(meta.t_last, tFromYM(state.y1, 12));
    vals = index.period(t0, t1, aoiCells); const pos = Array.from(vals).filter((v) => v > 0); vmax = Math.max(1, percentile(pos, 98));
    label = `${state.y0}–${state.y1}`; note.append(el('span', undefined, `Period ${label}`));
  }
  fireMap?.setValues(vals, vmax);
  const lkey = `${label}|${Math.round(vmax)}`;
  if (lkey === legendKey && $('maplegend').childElementCount) return;
  legendKey = lkey;
  const lg = $('maplegend'); lg.textContent = '';
  const bar = el('div', 'bar'); bar.style.background = gradientCss(SEQ);
  const ends = el('div', 'ends'); ends.append(el('span', undefined, '0'), el('span', undefined, `${fmt(vmax)}+`));
  lg.append(el('div', undefined, `Harmonized detections per cell, ${label}`), bar, ends);
}

/* ---------- controls ---------- */
function syncControls(): void {
  const sel = $<HTMLSelectElement>('aoi-region');
  sel.value = state.aoi.kind === 'region' ? state.aoi.id : '';
  $<HTMLSelectElement>('y0').value = String(state.y0); $<HTMLSelectElement>('y1').value = String(state.y1);
  $<HTMLSelectElement>('cmp-region').value = cmp && cmp.kind === 'region' ? cmp.id : '';
  [...$('cal-modes').children].forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.mode === state.mode)));
  if (state.aoi.kind === 'circle') { $<HTMLInputElement>('c-lat').value = String(state.aoi.lat); $<HTMLInputElement>('c-lon').value = String(state.aoi.lon); $<HTMLInputElement>('c-r').value = String(state.aoi.r); }
}
function writeHash(): void {
  try { history.replaceState(null, '', encodeHash({ aoi: state.aoi, y0: state.y0, y1: state.y1, mode: state.mode }) + (cmp ? '&' + encodeCmp(cmp) : '') + (bm !== 'mono' ? `&bm=${bm}` : '')); } catch { /* sandboxed */ }
}
function applyHash(): void {
  const h = parseHash(location.hash);
  if (h.aoi) {
    if (h.aoi.kind === 'region' && !regions.some((r) => r.id === (h.aoi as { id: string }).id)) { /* unknown region: ignore */ }
    else state.aoi = h.aoi;
  }
  if (h.y0 !== undefined && h.y1 !== undefined) { state.y0 = Math.max(2000, h.y0); state.y1 = Math.min(lastYear, h.y1); if (state.y0 > state.y1) { state.y0 = 2000; state.y1 = lastYear; } }
  if (h.mode) state.mode = h.mode;
  const hb = parseBm(location.hash); if (hb) bm = hb; else { try { const v = localStorage.getItem('fc-bm'); if (v && (BM_IDS as readonly string[]).includes(v)) bm = v as BmId; } catch { /* ignore */ } }
  const c = parseCmp(location.hash);
  cmp = c && !(c.kind === 'region' && !regions.some((r) => r.id === (c as { id: string }).id)) ? c : null;
}
function wireControls(): void {
  const cs = $<HTMLSelectElement>('cmp-region');
  const off = el('option', undefined, 'Off') as HTMLOptionElement; off.value = ''; cs.append(off);
  regions.forEach((r) => { const o = el('option', undefined, r.name) as HTMLOptionElement; o.value = r.id; cs.append(o); });
  cs.addEventListener('change', () => { cmp = cs.value ? { kind: 'region', id: cs.value } : null; state.frameT = null; void refresh(false); });
  const reg = $<HTMLSelectElement>('aoi-region');
  const ca = regions.find((r) => r.id === 'central-asia');
  const custom = el('option', undefined, 'Custom area') as HTMLOptionElement; custom.value = ''; custom.disabled = true;
  reg.append(custom);
  [ca, ...regions.filter((r) => r.id !== 'central-asia')].forEach((r) => { if (!r) return; const o = el('option', undefined, r.name) as HTMLOptionElement; o.value = r.id; reg.append(o); });
  reg.addEventListener('change', () => { if (reg.value) { cancelDraw(); state.aoi = { kind: 'region', id: reg.value }; state.frameT = null; clearMsg(); void refresh(); } });
  for (const id of ['y0', 'y1']) {
    const s = $<HTMLSelectElement>(id);
    for (let y = 2000; y <= lastYear; y++) { const o = el('option', undefined, String(y)) as HTMLOptionElement; o.value = String(y); s.append(o); }
    s.addEventListener('change', () => {
      state.y0 = +$<HTMLSelectElement>('y0').value; state.y1 = +$<HTMLSelectElement>('y1').value;
      if (state.y0 > state.y1) { if (id === 'y0') state.y1 = state.y0; else state.y0 = state.y1; }
      state.frameT = null; void refresh(false);
    });
  }
  // calendar modes
  for (const m of ['harm', 'modis', 'viirs', 'naive', 'swipe'] as CalMode[]) {
    const b = el('button', undefined, MODE_LABEL[m] === 'Swipe: naive vs harmonized' ? 'Swipe compare' : MODE_LABEL[m]) as HTMLButtonElement; b.type = 'button'; b.dataset.mode = m;
    b.addEventListener('click', () => { state.mode = m; syncControls(); writeHash(); if (series) renderCalendar(); });
    $('cal-modes').append(b);
  }
  $<HTMLSelectElement>('season-year').addEventListener('change', (e) => { state.seasonYear = +(e.target as HTMLSelectElement).value; if (series) { const cl = climatology(series.harm, state.y0, state.y1, { tFirst: meta.t_first, tLast: meta.t_last }); charts.season.setOption(C!.seasonOption(cl, state.seasonYear, series.harm, theme()), true); } });
  // draw
  $('draw-start').addEventListener('click', () => (fireMap?.drawing ? cancelDraw() : startDraw()));
  $('draw-finish').addEventListener('click', finishDraw);
  $('draw-clear').addEventListener('click', () => { cancelDraw(); clearMsg(); state.aoi = { kind: 'region', id: 'central-asia' }; state.frameT = null; void refresh(); });
  // circle
  $('circle-form').addEventListener('submit', (e) => { e.preventDefault(); applyCircle(); });
  $('copy-link').addEventListener('click', copyLink);
  $('dim-toggle').addEventListener('click', (e) => { const b = e.currentTarget as HTMLElement; const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '3D' : '2D'; fireMap?.set3d(on); });
  // swipe handle
  const stage = $('cal-stage'), handle = $('cal-handle');
  const setCut = (pct: number) => { const c = Math.max(2, Math.min(98, pct)); stage.style.setProperty('--cut', `${c}%`); handle.setAttribute('aria-valuenow', String(Math.round(c))); };
  setCut(50);
  const fromX = (x: number) => { const r = stage.getBoundingClientRect(); setCut(((x - r.left) / r.width) * 100); };
  handle.addEventListener('pointerdown', (e) => { handle.setPointerCapture(e.pointerId); fromX(e.clientX); });
  handle.addEventListener('pointermove', (e) => { if (handle.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
  handle.addEventListener('keydown', (e) => {
    const cur = +handle.getAttribute('aria-valuenow')!, st = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setCut(cur - st); else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setCut(cur + st);
    else if (e.key === 'Home') setCut(2); else if (e.key === 'End') setCut(98); else return;
    e.preventDefault();
  });
  // PNG buttons
  const map: Record<string, [string, string]> = { cal: ['calA', 'calendar'], month: ['month', 'this-month'], season: ['season', 'typical-season'], anom: ['anom', 'anomalies'], ba: ['ba', 'before-after'] };
  document.querySelectorAll<HTMLElement>('[data-png]').forEach((b) => b.addEventListener('click', () => {
    const [k, name] = map[b.dataset.png!]; const c = charts[k]; if (!c) return;
    const a = document.createElement('a'); a.href = c.getDataURL({ pixelRatio: 2, backgroundColor: theme().bg, type: 'png' }); a.download = `firechronicle-${name}.png`; a.click();
  }));
  // exports
  $('dl-points').addEventListener('click', exportPoints);
  $('dl-series').addEventListener('click', () => { if (!series) return; void import('./export').then((x) => { x.download(new Blob([x.seriesCsv(series!, state.y0, state.y1, meta.t_first, meta.t_last)], { type: 'text/csv;charset=utf-8' }), `firechronicle-monthly-${state.y0}-${state.y1}.csv`); setExp('Monthly series CSV downloaded.'); }); });
  $('dl-brief').addEventListener('click', briefing);
  $('proof-why').addEventListener('click', (e) => { e.preventDefault(); $('before-after').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); });
  $('why-link').addEventListener('click', (e) => { e.preventDefault(); const d = $<HTMLDetailsElement>('method'); d.open = true; void ensureExplainer(); $('why').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); });
  window.addEventListener('hashchange', () => { applyHash(); state.frameT = null; void refresh(); });
}
const draft: Pt[] = [];
function startDraw(): void {
  if (!fireMap) return;
  draft.length = 0; fireMap.setDraft([]); fireMap.setDrawing(true); ($('draw-finish') as HTMLButtonElement).disabled = true;
  $('draw-start').setAttribute('aria-pressed', 'true'); $('draw-hint').hidden = false; msg('');
}
function cancelDraw(): void {
  draft.length = 0; fireMap?.setDraft([]); fireMap?.setDrawing(false); ($('draw-finish') as HTMLButtonElement).disabled = true;
  $('draw-start').setAttribute('aria-pressed', 'false'); $('draw-hint').hidden = true;
}
function finishDraw(): void {
  if (draft.length < 3) { msg('A polygon needs at least 3 points.'); return; }
  const pts = draft.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as Pt);
  cancelDraw(); clearMsg(); state.aoi = { kind: 'polygon', pts }; state.frameT = null; void refresh();
}
function msg(t: string, neutral = false): void { const m = $('aoi-msg'); m.textContent = t; m.style.color = neutral ? 'var(--ink-3)' : ''; }
function clearMsg(): void { msg(''); for (const id of ['c-lat', 'c-lon', 'c-r']) $(id).removeAttribute('aria-invalid'); }
function applyCircle(): void {
  const f = (id: string) => $<HTMLInputElement>(id), num = (s: string) => (/^\s*-?\d+([.,]\d+)?\s*$/.test(s) ? Number(s.replace(',', '.')) : NaN);
  const la = num(f('c-lat').value), lo = num(f('c-lon').value), r = num(f('c-r').value), errs: string[] = [];
  const chk = (id: string, ok: boolean, e: string) => { f(id).setAttribute('aria-invalid', String(!ok)); if (!ok) errs.push(e); };
  chk('c-lat', la >= -90 && la <= 90, 'Latitude must be between −90 and 90.');
  chk('c-lon', lo >= -180 && lo <= 180, 'Longitude must be between −180 and 180.');
  chk('c-r', r >= 1 && r <= 500, 'Radius must be between 1 and 500 km.');
  if (errs.length) { msg(errs.join(' ')); return; }
  clearMsg(); cancelDraw(); state.aoi = { kind: 'circle', lat: la, lon: lo, r }; state.frameT = null; void refresh();
}
async function copyLink(): Promise<void> {
  writeHash();
  const b = $('copy-link'), url = location.href;
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch {
    const ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
  }
  b.textContent = ok ? 'Link copied' : 'Copy failed: use the address bar'; setTimeout(() => { b.textContent = 'Copy link'; }, 2200);
}
function setExp(t: string): void { $('exp-msg').textContent = t; }
async function exportPoints(): Promise<void> {
  const btn = $<HTMLButtonElement>('dl-points'), prog = $<HTMLProgressElement>('exp-progress');
  if (!aoiCells.length) { setExp('Nothing to export: the area has no cells.'); return; }
  btn.disabled = true; prog.hidden = false; prog.value = 0;
  try {
    const set = new Set(aoiCells.map((i) => cellIds[i]));
    const x = await import('./export');
    const r = await x.pointsCsv(set, meta.h3_res, state.y0, state.y1, (d: number, t: number, n: number) => { prog.value = d / t; setExp(`Reading year ${state.y0 + Math.min(d, t - 1)} of ${state.y0}–${state.y1}… ${n.toLocaleString('en-US')} rows so far`); });
    if (r.rows === 0) setExp(`No hotspot rows for this area and years${r.missing.length ? ` (no file for ${r.missing.join(', ')})` : ''}.`);
    else { x.download(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }), `firechronicle-hotspots-${state.y0}-${state.y1}.csv`); setExp(`Downloaded ${r.rows.toLocaleString('en-US')} rows${r.missing.length ? `. No point file for ${r.missing.join(', ')}` : ''}.`); }
  } catch (e) { setExp(`Export failed: ${(e as Error).message}. Try again.`); } finally { btn.disabled = false; prog.hidden = true; }
}
let briefingSi = false;
async function briefing(): Promise<void> {
  if (!series) return;
  const bm = await import('./briefing'), ex = await import('./export');
  const sp = { tFirst: meta.t_first, tLast: meta.t_last }, th = theme();
  const tm = thisMonthStats(series.harm, state.y0, state.y1, sp, pdays(), partialHist());
  const o = outlook(series.harm, sp);
  const cv = document.createElement('canvas');
  const pos: number[] = []; for (let t = meta.t_first; t <= meta.t_last; t++) if (series.harm[t] > 0) pos.push(series.harm[t]);
  bm.drawBriefing(cv, {
    name: aoiName, arr: series.harm, tLast: meta.t_last, y0: Math.max(state.y0, 2000), y1: state.y1, th, vmax: Math.max(1, percentile(pos, 98)), unit: 'harmonized detections per month', sample: !!meta.sample, si: briefingSi,
    headline: tm ? `${fmt(tm.value)}` : 'n/a',
    sub: tm ? `detections in ${MONTH_FULL[tm.month - 1]} ${tm.year} so far (${tm.days} days). ${Number.isFinite(tm.pctVsMedian) ? `${tm.pctVsMedian >= 0 ? '+' : '−'}${Math.abs(Math.round(tm.pctVsMedian))}% vs median, ` : ''}${ordinal(tm.rank)} percentile.` : 'Not enough history to compare this month.',
    critical: o.next ? `${MONTH_ABBR[o.next.from - 1]}${o.next.from === o.next.to ? '' : '–' + MONTH_ABBR[o.next.to - 1]} (${o.next.n} yr climatology)` : 'None in the next 12 months',
  });
  cv.toBlob((b) => { if (b) { ex.download(b, 'firechronicle-briefing.png'); setExp('Briefing card saved (1200×630 PNG).'); } }, 'image/png');
}

/* ---------- methodology ---------- */
function renderMethod(): void {
  const root = $('method-body'); root.textContent = '';
  const h = (t: string) => root.append(el('h3', undefined, t));
  const p = (t: string) => root.append(el('p', undefined, t));
  const ul = (items: (string | Node)[]) => { const u = el('ul'); items.forEach((i) => { const li = el('li'); li.append(i); u.append(li); }); root.append(u); };
  h('What a hotspot is'); p('A hotspot is a satellite pixel flagged as containing an active fire at the moment of overpass. It is not a burned area and not a fire size. One large fire can produce many hotspots, and a small fire can be missed if it is under cloud or smoke, or burns between overpasses.');
  h('Sensors and coverage');
  const sensors: [string, string, keyof Meta['sensors']][] = [['m', '', 'modis'], ['v', '', 'snpp'], ['v', '', 'n20'], ['v', '', 'n21']];
  ul(sensors.map(([c, , k]) => { const s = meta.sensors[k]; const f = document.createDocumentFragment(); f.append(el('span', `sensor ${c}`), `${s.label}: ${s.start} to ${s.end}`); return f; }));
  h('How the series is harmonized');
  p('Each VIIRS satellite (S-NPP, NOAA-20, NOAA-21) is calibrated directly against MODIS Terra+Aqua for every country and calendar month. The calibration uses a shrunk ratio plus a year trend in the ratio, which absorbs Terra/Aqua orbit drift. The harmonized value is the pooled estimate (M + \u03a3V) / (1 + \u03a3k), where M is the MODIS count, V each VIIRS count and k its calibration ratio, weighted by coverage. Before July 2002, when only Terra flew, Terra is scaled by a fitted factor. VIIRS sees about 3.5\u00d7 more detections than MODIS overall, and 2\u201315\u00d7 by country and month, so a calibration is unavoidable.');
  p('Each harmonized value carries an approximate 90% band: calibration uncertainty (bootstrap plus year-to-year drift) plus counting noise. For an area, calibration uncertainty adds up linearly across cells and counting noise adds in quadrature.');
  const t0 = num(pick(meta, 'cleaning', 'type0_removed_pct')), nrt = num(pick(meta, 'cleaning', 'nrt_removed_pct'));
  if (t0 !== null) p(`Cleaning: the static-source mask also removes about ${t0}% of vegetation detections${nrt !== null ? ` and is the only industrial-source filter for near-real-time rows (${nrt}% removed)` : ''}.`);
  h('Validation');
  const v = meta.validation, hl = headline(v), vi: string[] = [];
  const brk = (label: string, key: string) => { const r = pick(v, key); if (num(pick(r, 'jump_ratio')) !== null) vi.push(`${label}: mean annual total changes ${hl[key === 'naive_break_2012' ? 'naive' : key === 'modis_only_reference' ? 'modis' : 'harm']} after the break, change point ${str(pick(r, 'change_point')) ?? DASH} (${str(pick(r, 'test')) ?? 'Pettitt'}, approx. p ${fmtP(pick(r, 'p'))}).`); };
  brk('Naive splice', 'naive_break_2012'); brk('MODIS only', 'modis_only_reference'); brk('Harmonized', 'harmonized_break_2012');
  cvRows(v).forEach((r) => vi.push(`Leave-one-year-out, ${r.sensor} (${r.years}), region by month: bias ${r.bias}, MAE ${r.mae}, R\u00b2 ${r.r2}, n = ${r.n}.`));
  notes(v).forEach((n) => vi.push(n));
  if (!vi.length) vi.push('Validation numbers are not available in this data release.');
  ul(vi);
  h('Limitations');
  ul([`VIIRS S-NPP ended on ${meta.sensors.snpp.end}; NOAA-20 and NOAA-21 carry the record from there. The calibration of NOAA-21 rests on only a few years of overlap.`, 'Terra and Aqua (MODIS) begin shutting down in late 2026\u20132027 and their orbits are drifting, which shifts overpass times.', `Months from ${tLabel(meta.t_nrt_from)} use near-real-time data and are provisional.`, 'Cloud and smoke can hide fires; counts are not corrected for it.', 'Hotspot counts are not burned area, fire size or emissions.', 'Area totals use the H3 cells whose centre lies inside the area.']);
  const rf = parseRefresh(meta.refresh);
  h('Data freshness');
  p(`Data refresh automatically every day at ${rf.schedule_utc} UTC from NASA FIRMS (MODIS, VIIRS NOAA-20, NOAA-21). Recent months are provisional until science-quality data replace them. Automatic updates are scheduled until ${rf.auto_update_until}. After that the data stay available but are no longer refreshed. To extend updates, contact the team.`);
  if (rf.issues_url) { const pp = el('p'); const a = el('a', undefined, 'Contact the team (GitHub issues)') as HTMLAnchorElement; a.href = rf.issues_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; pp.append(a); root.append(pp); }
  h('Data access');
  p('All data are static files; reuse them without the UI.');
  { const pp = el('p'); const a = el('a', undefined, 'View source on GitHub') as HTMLAnchorElement; a.href = 'https://github.com/komilovsg/firechronicle'; a.target = '_blank'; a.rel = 'noopener noreferrer'; pp.append(a); root.append(pp); }
  ul([['meta.json', 'run metadata, sensor dates, validation numbers'], ['regions.json', 'monthly series per country and for the region (raw per sensor, naive, harmonized, band)'], ['cells.json', 'H3 resolution-5 cell ids; position = cellIdx'], ['monthly.json', 'sparse monthly rows per cell and month'], ['partial.json', 'same-days history for the current partial month (optional)'], ['countries.geojson', 'country boundaries'], ['points/{year}.csv.gz', 'cleaned hotspot detections for one year']].map(([f, d]) => { const fr = document.createDocumentFragment(); const a = el('a', undefined, new URL(`./data/${f}`, document.baseURI).href.replace('%7Byear%7D', '{year}')) as HTMLAnchorElement; if (!f.includes('{')) { a.href = `./data/${f}`; a.target = '_blank'; a.rel = 'noopener'; } fr.append(a, ` \u2013 ${d}`); return fr; }));
  h('Data sources');
  ul(meta.sources.map((s) => { const f = document.createDocumentFragment(); f.append(`${s.name} `); if (/^https:\/\//.test(s.url)) { const a = el('a', undefined, 'link') as HTMLAnchorElement; a.href = s.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; f.append(a); } if (s.doi && /^10\.\d{4,9}\/\S+$/.test(s.doi)) { f.append(' · DOI '); const a = el('a', undefined, s.doi) as HTMLAnchorElement; a.href = `https://doi.org/${s.doi}`; a.rel = 'noopener noreferrer'; a.target = '_blank'; f.append(a); } return f; }));
  const ack = el('div', 'ack');
  ack.append(el('p', undefined, "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/data/tools/firms), part of NASA's Earth Science Data and Information System (ESDIS)."), el('p', undefined, "Parts of this project's code and text were written with SI (AI) coding assistance."));
  root.append(ack);
}

/* ---------- boot ---------- */
function ensureVisuals(): Promise<void> {
  visuals ??= (async () => {
    const [c, m, r] = await Promise.all([import('./charts'), import('./map'), import('./replay')]);
    C = c;
    const desktop = window.innerWidth > 768;
    fireMap = new m.FireMap($('map'), prefersDark(), desktop);
    const tg = $('dim-toggle'); tg.setAttribute('aria-pressed', String(desktop)); tg.textContent = desktop ? '3D' : '2D';
    replay = new r.Replay($('replay'));
    if (new URLSearchParams(location.search).has('perf')) (window as unknown as { __fm: unknown }).__fm = fireMap;
    let raf = 0;
    replay.onFrame = (t) => { state.frameT = t; if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderMap(); if (!replay!.playing) renderCalendar(); }); };
    replay.onStop = () => { renderCalendar(); renderMap(); };
    fireMap.onResetClick = () => fitMap();
    setupBasemap();
    fireMap.onDrift = (d) => { document.querySelectorAll('[data-reset]').forEach((x) => x.classList.toggle('drifted', d)); };
    fireMap.onDrawClick = (p) => { if (draft.length >= MAX_VERTS) { msg(`At most ${MAX_VERTS} points.`); return; } draft.push(p); fireMap!.setDraft(draft); ($('draw-finish') as HTMLButtonElement).disabled = draft.length < 3; };
    fireMap.onDrawFinish = () => { if (draft.length > 3) draft.pop(); finishDraw(); };
  })();
  return visuals;
}
let explainerRender: (() => void) | null = null;
async function ensureExplainer(): Promise<void> {
  if (explainerRender) return;
  const x = await import('./explainer');
  explainerRender = x.mountExplainer($('why'), theme);
}
function trackHeader(): void {
  const top = $('top'), set = () => document.documentElement.style.setProperty('--hdr', `${Math.ceil(top.getBoundingClientRect().height)}px`);
  set(); new ResizeObserver(set).observe(top);
  const fit = () => { const h = top.getBoundingClientRect().height; document.documentElement.style.setProperty('--maph', `${Math.round(window.innerHeight - Math.max(0, h - window.scrollY))}px`); };
  fit(); addEventListener('scroll', fit, { passive: true }); addEventListener('resize', fit);
}

function renderHeroText(): void {
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meta.sensors.snpp.end), yrs = yearOf(meta.t_last) - yearOf(meta.t_first);
  const when = end ? `${+end[3]} ${MONTH_ABBR[+end[2] - 1]} ${end[1]}` : meta.sensors.snpp.end;
  document.querySelector('.context')!.textContent = `MODIS is retiring. Suomi NPP went dark on ${when}. FireChronicle keeps ${yrs} years of satellite fire records on one scale.`;
}
function buildHud(): HudData {
  const sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const tm = series ? thisMonthStats(series.harm, state.y0, state.y1, sp, pdays(), partialHist()) : null;
  const o = series ? outlook(series.harm, sp) : null, yt = series ? ytdStats(series.harm, sp, state.y0, state.y1) : null;
  const sgn = (v: number): string => `${v >= 0 ? '+' : '\u2212'}${Math.abs(Math.round(v))}%`;
  const dim = tm ? daysInMonth(tm.year, tm.month) : 30;
  return {
    aoiName,
    month: tm ? { big: Number.isFinite(tm.pctVsMedian) ? sgn(tm.pctVsMedian) : '\u2014', sub: `${ordinal(tm.rank)} percentile \u00b7 ${MONTH_ABBR[tm.month - 1]}${tm.days < dim ? ` so far (${tm.days} d)` : ''}` } : { big: '\u2014', sub: 'not enough history' },
    next: o?.next ? { big: o.next.from === o.next.to ? MONTH_ABBR[o.next.from - 1] : `${MONTH_ABBR[o.next.from - 1]}\u2013${MONTH_ABBR[o.next.to - 1]}`, sub: `based on ${o.next.n} years` } : { big: 'None', sub: 'in the next 12 months' },
    ytd: yt && Number.isFinite(yt.pct) ? { big: sgn(yt.pct), sub: `${fmt(yt.value)} detections, Jan\u2013${MONTH_ABBR[yt.months - 1]}` } : { big: '\u2014', sub: 'not enough history' },
    nrtNote: `Months from ${tLabel(meta.t_nrt_from)} are provisional (NRT).`,
    bars: tm ? { years: tm.histYears, values: tm.hist, curYear: tm.year, cur: tm.value, median: tm.median, title: `${MONTH_FULL[tm.month - 1]} across years` } : null,
    topEmpty: anom && !unusualRanked()!.list.length ? noUnusualText(anomT) : null,
    top: anom ? unusualRanked()!.list.slice(0, 3).map((u) => ({ label: `${cellCountryName(u.cell)}, ${hemi(lat[u.cell], 'N', 'S')} ${hemi(lon[u.cell], 'E', 'W')}`, pct: unusualBadge(u), lon: lon[u.cell], lat: lat[u.cell] })) : [],
  };
}
function fsApi(): FsApi {
  return {
    getHud: buildHud, mainSelect: $<HTMLSelectElement>('aoi-region'),
    flyTo: (lo, la) => { setMapMode('anomaly'); fireMap?.flyTo(lo, la, 7); },
    resetView: () => fitMap(), resize: () => fireMap?.map.resize(), pixelRatio: (r) => fireMap?.map.setPixelRatio(r),
    zoom: (d) => { if (d > 0) fireMap?.map.zoomIn(); else fireMap?.map.zoomOut(); },
    toggleTheme: () => $('theme-btn').click(), openStyle,
  };
}
async function toggleFs(): Promise<void> {
  try { await ensureVisuals(); const m = await import('./fullscreen'); await m.toggleFullscreen(fsApi()); } catch (e) { setStatus(`Could not open fullscreen (${(e as Error).message}).`); }
}
const hudPing = (): void => { window.dispatchEvent(new Event('fc-hud')); };
const bmKey = (): string => `${state.frameT ?? 'p'}|${mapMode}`;
/** Satellite day follows the calendar month / replay frame; throttled to one update per 1.5 s while playing. */
function syncImagery(force = false): void {
  if (bm !== 'sat' || !fireMap) return;
  const key = bmKey(); if (key !== imgKey) { imgKey = key; imgManual = null; }
  const run = (): void => { lastImgSync = performance.now(); fireMap?.setImageryDate(imageryDateFor(mapMode === 'anomaly' ? null : state.frameT, new Date(), imgManual)); refreshStylePanel(); };
  const wait = 1500 - (performance.now() - lastImgSync);
  if (force || !replay?.playing || wait <= 0) { clearTimeout(imgTimer); run(); } else { clearTimeout(imgTimer); imgTimer = window.setTimeout(run, wait); }
}
function setBm(id: BmId): void {
  bm = id; try { localStorage.setItem('fc-bm', id); } catch { /* private mode */ }
  imgKey = bmKey(); imgManual = null;
  fireMap?.setBasemap(id, imageryDateFor(mapMode === 'anomaly' ? null : state.frameT, new Date(), null));
  writeHash(); refreshStylePanel();
}
function bmApi(): BmApi {
  const cur = (): string => imageryDateFor(mapMode === 'anomaly' ? null : state.frameT, new Date(), imgManual);
  return {
    current: () => bm, select: setBm, imagery: () => fireMap?.imagery() ?? null,
    step: (d) => { imgManual = clampImageryDate(addDays(cur(), d), new Date()); fireMap?.setImageryDate(imgManual); },
    canStep: (d) => clampImageryDate(addDays(cur(), d), new Date()) !== cur(),
  };
}
const openStyle = (anchor: HTMLElement): void => openStylePanel(anchor, bmApi());
function setupBasemap(): void {
  const labels = { type: 'FeatureCollection', features: countries.features.map((f) => {
    const polys = geometryPolys(f.geometry as { type: string; coordinates: unknown }), ring = polys.map((p) => p[0]).reduce((x, y) => (y.length > x.length ? y : x));
    const b = bboxOf(ring); return { type: 'Feature', properties: { name: f.properties.name }, geometry: { type: 'Point', coordinates: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] } };
  }) };
  fireMap!.setCountries(countries, labels);
  fireMap!.onStyleClick = openStyle;
  fireMap!.onStyleChange = () => { renderMap(); hudPing(); };
  if (bm !== 'mono') setBm(bm);
}
function assistantFacts(): Record<string, unknown> {
  const sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const tm = series ? thisMonthStats(series.harm, state.y0, state.y1, sp, pdays(), partialHist()) : null;
  const o = series ? outlook(series.harm, sp) : null, yt = series ? ytdStats(series.harm, sp, state.y0, state.y1) : null;
  const cl = series ? climatology(series.harm, state.y0, state.y1, sp) : null, season = cl ? detectSeason(cl.median) : null;
  const at = series ? annualTotals(series.harm, state.y0, state.y1, sp) : [];
  const last = at[at.length - 1], med = at.length ? median(at.map((a) => a.total)) : NaN;
  const r1 = (v: number | undefined): number | null => (v !== undefined && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return {
    this_month: tm ? `${MONTH_FULL[tm.month - 1]} ${tm.year}` : null,
    this_month_vs_median_pct: tm ? r1(tm.pctVsMedian) : null,
    this_month_percentile: tm ? r1(tm.rank) : null,
    next_high_activity: o?.next ? `${MONTH_ABBR[o.next.from - 1]}${o.next.from === o.next.to ? '' : '-' + MONTH_ABBR[o.next.to - 1]}` : null,
    ytd_vs_median_pct: yt ? r1(yt.pct) : null,
    latest_year: last ? last.year : null,
    latest_year_total: last ? Math.round(last.total) : null,
    latest_year_vs_median_pct: last && med > 0 ? r1((last.total / med - 1) * 100) : null,
    season_months: season ? monthRanges(season.months).join(', ') : null,
    season_peak: season ? MONTH_ABBR[season.peak - 1] : null,
    years_from: state.y0, years_to: state.y1,
    data_through: meta.data_through ?? null,
  };
}
const MODES = ['harm', 'modis', 'viirs', 'naive', 'swipe'];
function assistantApply(a: import('./lib/assistant').NavAction): string {
  const parts: string[] = [];
  if (a.area) { state.aoi = { kind: 'region', id: a.area }; parts.push(`area ${regions.find((r) => r.id === a.area)?.name ?? a.area}`); }
  if (a.yearFrom !== undefined) state.y0 = a.yearFrom;
  if (a.yearTo !== undefined) state.y1 = a.yearTo;
  if (state.y0 > state.y1) { if (a.yearFrom !== undefined) state.y1 = Math.max(state.y0, state.y1); else state.y0 = state.y1; }
  if (a.yearFrom !== undefined || a.yearTo !== undefined) parts.push(`years ${state.y0}\u2013${state.y1}`);
  if (a.mode) { state.mode = a.mode as CalMode; parts.push(`calendar: ${MODE_LABEL[state.mode]}`); }
  if (a.compare !== undefined) { cmp = a.compare ? { kind: 'region', id: a.compare } : null; parts.push(a.compare ? `compare with ${regions.find((r) => r.id === a.compare)?.name ?? a.compare}` : 'compare off'); }
  state.frameT = null; void refresh(); syncControls();
  return `Applied: ${parts.join(', ')}.`;
}
const CITATION = 'Deep Space AI (2026). FireChronicle: harmonized MODIS\u2013VIIRS active fire calendar for Central Asia, 2000\u20132026. https://komilovsg.github.io/firechronicle/. Data: NASA FIRMS.';
async function copyText(t: string, btn: HTMLElement, ok: string, label: string): Promise<void> {
  let done = false;
  try { await navigator.clipboard.writeText(t); done = true; } catch {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { done = document.execCommand('copy'); } catch { done = false; } ta.remove();
  }
  btn.textContent = done ? ok : 'Copy failed'; setTimeout(() => { btn.textContent = label; }, 2200);
}
const THEME_UI: Record<ThemeMode, [string, string]> = { system: ['\u25d0', 'system'], light: ['\u2600', 'light'], dark: ['\u263e', 'dark'] };
function wireExtras(): void {
  document.querySelectorAll<HTMLElement>('#maplayers button').forEach((b) => b.addEventListener('click', () => setMapMode(b.dataset.layer as 'activity' | 'anomaly')));
  const tb = $('theme-btn'), showTheme = () => { const [ic, name] = THEME_UI[themeMode()]; tb.textContent = ic; tb.setAttribute('aria-label', `Theme: ${name}. Click to change.`); tb.title = `Theme: ${name}`; };
  showTheme();
  tb.addEventListener('click', () => { const order: ThemeMode[] = ['system', 'light', 'dark']; applyThemeMode(order[(order.indexOf(themeMode()) + 1) % 3]); showTheme(); });
  const tour = (): void => { void import('./tour').then((m) => m.startTour()); };
  $('tour-btn').addEventListener('click', tour);
  $('fs-btn').addEventListener('click', () => void toggleFs());
  $('cite-btn').addEventListener('click', (e) => void copyText(CITATION, e.currentTarget as HTMLElement, 'Citation copied', 'Cite'));
  $('cite-foot').addEventListener('click', (e) => void copyText(CITATION, e.currentTarget as HTMLElement, 'Citation copied', 'Cite'));
  $('dl-dataset').addEventListener('click', () => void import('./export').then((x) => { x.download(new Blob([x.regionsCsv(regions, meta, seriesFromRegion)], { type: 'text/csv;charset=utf-8' }), 'firechronicle-harmonized-regions.csv'); setExp('Harmonized monthly series for all regions downloaded.'); }));
  const raw = $('raw-links'); raw.textContent = 'Raw files: ';
  ['meta.json', 'regions.json', 'cells.json', 'monthly.json', 'countries.geojson'].forEach((f, i) => { if (i) raw.append(' \u00b7 '); const a = el('a', undefined, f) as HTMLAnchorElement; a.href = `./data/${f}`; a.target = '_blank'; a.rel = 'noopener'; raw.append(a); });
  // phones: ? / GitHub / theme / cite live in the overflow menu
  {
    const acts = document.querySelector('.hdr-actions')!, pop = $('more-pop'), more = $('more-btn');
    const items = ['ask-menu', 'gh-btn', 'tour-btn', 'theme-btn', 'cite-menu'].map((id) => $(id));
    const place = (phone: boolean): void => { for (const it of items) { if (phone) { pop.append(it); it.classList.add('in-menu'); } else { acts.insertBefore(it, more); it.classList.remove('in-menu'); } } if (!phone) closeMenu(); };
    const closeMenu = (): void => { pop.hidden = true; more.setAttribute('aria-expanded', 'false'); };
    more.addEventListener('click', () => { pop.hidden = !pop.hidden; more.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) (pop.querySelector('a, button') as HTMLElement | null)?.focus(); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && !more.contains(e.target as Node)) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { closeMenu(); more.focus(); } });
    pop.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button, a')) setTimeout(closeMenu, 0); });
    const mq = matchMedia('(max-width: 640px)'); place(mq.matches); mq.addEventListener('change', () => place(mq.matches));
    $('ask-menu').addEventListener('click', () => $('ask-btn').click());
    $('cite-menu').addEventListener('click', (e) => void copyText(CITATION, e.currentTarget as HTMLElement, '\u2713', '\u275e'));
  }
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null, tag = t?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    if (document.querySelector('.tour')) return;
    if (e.key === '?') { e.preventDefault(); tour(); }
    else if (e.key === '/') { e.preventDefault(); $('aoi-region').focus(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); fitMap(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); void toggleFs(); }
    else if (e.key === ' ' && !(t?.closest('button, a, summary, [role="slider"]')) && replay) { e.preventDefault(); replay.toggle(); }
  });
  void import('./glossary').then((g) => {
    const q = (s: string) => document.querySelector(s);
    g.addInfo(q('.context'), 'VIIRS', 'VIIRS'); g.addInfo(q('.context'), 'MODIS', 'MODIS');
    g.addInfo(q('.cal-hero .head h2'), 'MODIS-equivalent', 'MODIS-equivalent'); g.addInfo(q('.cal-hero .head h2'), 'hotspot', 'hotspot');
    g.addInfo(q('#h-month'), 'percentile'); g.addInfo(q('#h-anom'), 'robust z'); g.addInfo(q('#h-ba'), 'harmonized'); g.addInfo(q('#h-unusual'), 'H3 cell'); g.addInfo(q('#badge-nrt'), 'NRT');
  });
}
async function boot(): Promise<void> {
  applyThemeMode(themeMode(), false);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('ember-demo')) { void import('./ui/emberDemo').then((m) => m.showEmberDemo()); }
  enhanceAll();
  trackHeader();
  setStatus('Loading data\u2026');
  try {
    let cd: { cells: string[]; country: string[] | null };
    [meta, regions, countries, cd] = await Promise.all([loadMeta(), loadRegions(), loadCountries(), loadCells()]);
    cellIds = cd.cells; cellCountry = cd.country;
  } catch (e) { setStatus(`Could not load the data files (${(e as Error).message}).`, () => void boot()); return; }
  partial = await loadPartial();
  setStatus('');
  lastYear = yearOf(meta.t_last);
  state.y1 = lastYear;
  lat = new Float64Array(cellIds.length); lon = new Float64Array(cellIds.length);
  cellIds.forEach((id, i) => { const [a, b] = cellToLatLng(id); lat[i] = a; lon[i] = b; });
  $('badge-sample').hidden = !meta.sample;
  initFreshness(meta); $('badge-nrt').hidden = false;
  renderHeroText(); renderInsights(); renderProof();
  wireControls(); wireExtras(); renderMethod();
  initAssistant({
    areaName: () => aoiName, facts: assistantFacts, apply: assistantApply,
    areaId: () => ({ kind: state.aoi.kind, id: state.aoi.kind === 'region' ? state.aoi.id : undefined }),
    dataThrough: () => meta.data_through ?? meta.generated_at.slice(0, 10),
    limits: () => ({ regionIds: regions.map((r) => r.id), firstYear: 2000, lastYear, modes: MODES }),
    regionData: (iso) => {
      const sp = { tFirst: meta.t_first, tLast: meta.t_last };
      if (iso === null) return series ? { harm: series.harm, sp, y0: state.y0, y1: state.y1 } : null;
      const r = regions.find((x) => x.id === iso);
      return r ? { harm: seriesFromRegion(r, meta).harm, sp, y0: 2000, y1: lastYear } : null;
    },
    validation: () => meta.validation,
    openCalendar: (iso) => { assistantApply({ area: iso }); setTimeout(() => $('h-cal').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }), 500); },
    shareCard: async (iso) => { state.aoi = { kind: 'region', id: iso }; state.frameT = null; await refresh(); briefingSi = true; try { await briefing(); } finally { briefingSi = false; } },
  });
  $<HTMLDetailsElement>('method').addEventListener('toggle', () => { if ($<HTMLDetailsElement>('method').open) void ensureExplainer(); });
  applyHash(); syncControls();
  void ensureVisuals().catch((e) => setStatus(`Could not load the map and charts (${(e as Error).message}).`, () => { visuals = null; void refresh(); }));
  onThemeChange(() => { fireMap?.setDark(prefersDark()); explainerRender?.(); if (series && C) { renderCharts(); renderMap(); } });
  await refresh();
  let seen = true; try { seen = localStorage.getItem('fc-tour-done') === '1'; } catch { seen = true; }
  if (!seen) setTimeout(() => void import('./tour').then((m) => m.startTour()), 900);
}
void boot();
