import './style.css';
import { cellToLatLng } from 'h3-js';
import { loadMeta, loadRegions, loadCountries, loadCells, loadMonthly, type Countries } from './data';
import { CellIndex, seriesFromRegion, sensorTs, type Meta, type Region, type Series } from './lib/series';
import { pointInPolygon, circlePolygon, bboxOf, type Pt } from './lib/geo';
import { encodeHash, parseHash, MAX_VERTS, type AoiSpec, type CalMode } from './lib/hash';
import { MONTH_FULL, MONTH_ABBR, daysInMonth, tFromYM, tLabel, yearOf } from './lib/time';
import { percentile } from './lib/stats';
import { anomalies, annualTotals, buildSummary, climatology, ordinal, outlook, outlookText, thisMonthStats, type Mode } from './lib/analytics';
import type * as ChartsMod from './charts';
import type { Chart } from './charts';
import type { FireMap } from './map';
import type { Replay } from './replay';
import { cpToX, cvRows, DASH, fmtNum, fmtP, headline, notes, pick, num, str } from './lib/validation';
import { SEQ, gradientCss, onThemeChange, prefersDark, theme } from './theme';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = (tag: string, cls?: string, text?: string): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (x: number): string => Math.round(x).toLocaleString('en-US');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface State { aoi: AoiSpec; y0: number; y1: number; mode: CalMode; frameT: number | null; seasonYear: number | null }
let meta: Meta, regions: Region[], countries: Countries, cellIds: string[] = [];
let lat: Float64Array, lon: Float64Array;
let index: CellIndex | null = null;
let monthlyPromise: Promise<void> | null = null;
let aoiCells: number[] = [], aoiName = '', aoiRing: Pt[] | null = null;
let series: Series | null = null;
let monthVmax = 1;
let fireMap: FireMap | undefined, replay: Replay | undefined;
let C: typeof ChartsMod | null = null;
let visuals: Promise<void> | null = null;
const charts: Record<string, Chart> = {};
const state: State = { aoi: { kind: 'region', id: 'central-asia' }, y0: 2000, y1: 2026, mode: 'harm', frameT: null, seasonYear: null };
let lastYear = 2026;

const MODE_LABEL: Record<CalMode, string> = { harm: 'Harmonized', modis: 'Raw MODIS', viirs: 'Raw VIIRS', naive: 'Naive splice', swipe: 'Swipe: naive vs harmonized' };
const MODE_NOTE: Record<CalMode, string> = {
  harm: 'MODIS-equivalent detections per month, all sensors calibrated to one scale.',
  modis: 'Raw Terra + Aqua detections, no calibration. Empty before November 2000.',
  viirs: 'Raw VIIRS detections, averaged over the VIIRS satellites active that month. Empty before 2012.',
  naive: 'MODIS before 2012, then S-NPP (NOAA-20 once S-NPP ended), stitched without calibration. Note the step in 2012.',
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
function ringForAoi(a: AoiSpec): Pt[] | null {
  if (a.kind === 'polygon') return a.pts;
  if (a.kind === 'circle') return circlePolygon(a.lat, a.lon, a.r);
  if (a.id === 'central-asia') return null;
  const f = countries.features.find((x) => x.properties.id === a.id);
  return f ? (f.geometry.coordinates[0] as Pt[]) : null;
}
function computeAoi(): void {
  const a = state.aoi;
  aoiRing = ringForAoi(a);
  aoiCells = [];
  for (let i = 0; i < cellIds.length; i++) if (!aoiRing || pointInPolygon(lon[i], lat[i], aoiRing)) aoiCells.push(i);
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
  const fm = fireMap; if (fm) void fm.ready.then(() => fm.fit(b));
}
function valuesFor(mode: Mode): Float64Array { return series![mode]; }

function renderText(): void {
  const s = series!;
  const sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const harm = s.harm;
  // summary + outlook
  const sum = $('summary'); sum.textContent = '';
  const lines = buildSummary({ arr: harm, y0: state.y0, y1: state.y1, sp, partialDays: meta.current_month_partial_days });
  const o = outlook(harm, sp);
  [...lines, outlookText(o)].forEach((t) => sum.append(el('p', undefined, t)));
  const strip = $('outlook'); strip.textContent = '';
  for (const m of o.months) {
    const c = el('div', 'cellm' + (m.critical ? ' crit' : ''));
    c.setAttribute('role', 'listitem');
    c.setAttribute('aria-label', `${MONTH_FULL[m.m - 1]} ${m.year}: ${Math.round(m.p * 100)}% chance of a high-activity month${m.critical ? ', critical' : ''}`);
    c.append(el('span', undefined, MONTH_ABBR[m.m - 1]), el('b', undefined, `${Math.round(m.p * 100)}%`));
    const bar = el('i'); bar.style.width = `${Math.round(m.p * 100)}%`; c.append(bar);
    strip.append(c);
  }
  const nMax = Math.max(...o.months.map((m) => m.n));
  $('outlook-note').textContent = `Share of past years in which that calendar month exceeded the area's long-term monthly 75th percentile (${fmt(o.threshold)} detections), (k+1)/(n+2) with n = ${nMax} years. Months at 50% or more are marked critical. This is climatology, not a forecast.`;

}
function renderCharts(): void {
  const s = series!, th = theme(), { monthOption, seasonOption, anomalyOption, beforeAfterOption } = C!;
  const sp = { tFirst: meta.t_first, tLast: meta.t_last };
  const harm = s.harm;
  renderCalendar();
  // this month
  const tm = thisMonthStats(harm, state.y0, state.y1, sp, meta.current_month_partial_days);
  if (tm) {
    const pct = Number.isFinite(tm.pctVsMedian) ? `${tm.pctVsMedian >= 0 ? '+' : '−'}${Math.abs(Math.round(tm.pctVsMedian))}% vs median` : 'no median to compare';
    const part = tm.fraction < 1 ? ` so far (${tm.days} of ${daysInMonth(tm.year, tm.month)} days; history pro-rated to the same share of the month)` : '';
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
  chart('ba', 'ba-chart').setOption(beforeAfterOption(s, state.y0, state.y1, meta.t_first, meta.t_last, snppEnd, th, { harm: cpToX(hl.harmCp), naive: cpToX(hl.naiveCp), harmLabel: hl.harmCp ?? '', naiveLabel: hl.naiveCp ?? '' }), true);
  const tot = (a: Float64Array, y: number) => { let x = 0; for (let t = tFromYM(y, 1); t <= tFromYM(y, 12); t++) x += a[t]; return x; };
  $('ba-chart').setAttribute('aria-label', `Annual totals, naive splice versus harmonized. 2011: naive ${fmt(tot(s.naive, 2011))}, harmonized ${fmt(tot(s.harm, 2011))}. 2012: naive ${fmt(tot(s.naive, 2012))}, harmonized ${fmt(tot(s.harm, 2012))}.`);
  replay?.setData(harm, meta.t_first, meta.t_last, th);
}

function renderCalendar(): void {
  if (!C) return;
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

function renderProof(): void {
  const v = meta.validation, h = headline(v);
  const trio = $('trio'); trio.textContent = '';
  const add = (cls: string, k: string, val: string, sub: string) => { const li = el('li', cls); li.append(el('div', 'k', k), el('div', 'v', val), el('div', 's', sub)); trio.append(li); };
  add('bad', 'Naive stitching', h.naive, h.naiveCp ? `change point ${h.naiveCp}, the sensor switch` : 'sensors joined without calibration');
  add('', 'MODIS only', h.modis, h.modisCp ? `change point ${h.modisCp}` : 'one sensor, no splice');
  add('', 'Harmonized', h.harm, h.harmCp ? `change point ${h.harmCp}` : 'all sensors, one scale');
  const why = h.harmCp ? `The harmonized change point (${h.harmCp}) matches MODIS alone and is a real decline, not the sensor switch${h.naiveCp ? ` (${h.naiveCp})` : ''}.` : 'The harmonized series follows MODIS alone.';
  $('ba-why').textContent = `Stitching raw sensors says activity rose; MODIS alone and the harmonized series both say it fell. ${why}`;
  // validation panel
  const box = $('valid'); box.textContent = '';
  const rows = cvRows(v), head = rows[0];
  box.append(el('h3', undefined, 'Leave-one-year-out check, region by month'));
  if (head) {
    const big = el('div', 'big');
    for (const [k, val] of [['Bias', head.bias], ['MAE', head.mae], ['R\u00b2', head.r2]]) { const d = el('div'); d.append(el('b', undefined, val), el('span', undefined, k)); big.append(d); }
    box.append(big, el('p', 'cap', `Headline: ${head.sensor}, ${head.years}. A VIIRS sensor predicts monthly MODIS totals in years left out of calibration.`));
    const tb = el('table'); const hd = el('tr');
    ['Sensor', 'Bias', 'MAE', 'R\u00b2', 'n'].forEach((t) => hd.append(el('th', undefined, t))); tb.append(hd);
    rows.forEach((r) => { const tr = el('tr'); [r.sensor, r.bias, r.mae, r.r2, r.n].forEach((t) => tr.append(el('td', undefined, t))); tb.append(tr); });
    box.append(tb);
  } else box.append(el('p', 'cap', 'Cross-validation numbers are not available in this data release.'));
  const chain = pick(v, 'chain_check_noaa20');
  if (num(pick(chain, 'direct')) !== null && num(pick(chain, 'via_snpp')) !== null) box.append(el('p', 'cap', `Chain check, NOAA-20 ratio: ${fmtNum(pick(chain, 'direct'), 2)} direct vs ${fmtNum(pick(chain, 'via_snpp'), 2)} via S-NPP.`));
  if (meta.sample) box.append(el('p', 'cap', 'Sample data: placeholder numbers.'));
}
function renderInsights(): void {
  const v = meta.validation, h = headline(v), cv = cvRows(v)[0];
  const ul = $('insights'); ul.textContent = '';
  const add = (k: string, val: string, cls: string, sub: string) => { const li = el('li'); li.append(el('div', 'k', k), el('div', `v ${cls}`.trim(), val), el('div', 's', sub)); ul.append(li); };
  add('Naive stitching', h.naive, 'bad', 'wrong: reverses the trend');
  add('Harmonized', h.harm, '', h.modis !== DASH && h.modis === h.harm ? 'matches MODIS alone' : 'change in mean annual total');
  const r2 = cv ? num(Number(cv.r2)) : null, bias = cv ? num(Number(cv.bias.replace('\u2212', '-').replace('%', ''))) : null;
  add('Cross-validated', r2 !== null && bias !== null ? `Bias ${Math.abs(bias).toFixed(1)}%\nR\u00b2 ${r2.toFixed(2)}` : DASH, 'small', cv ? `leave-one-year-out, ${cv.sensor} vs MODIS` : 'not available');
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
  renderMap();
}
function renderMap(): void {
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
  [...$('cal-modes').children].forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.mode === state.mode)));
  if (state.aoi.kind === 'circle') { $<HTMLInputElement>('c-lat').value = String(state.aoi.lat); $<HTMLInputElement>('c-lon').value = String(state.aoi.lon); $<HTMLInputElement>('c-r').value = String(state.aoi.r); }
}
function writeHash(): void {
  try { history.replaceState(null, '', encodeHash({ aoi: state.aoi, y0: state.y0, y1: state.y1, mode: state.mode })); } catch { /* sandboxed */ }
}
function applyHash(): void {
  const h = parseHash(location.hash);
  if (h.aoi) {
    if (h.aoi.kind === 'region' && !regions.some((r) => r.id === (h.aoi as { id: string }).id)) { /* unknown region: ignore */ }
    else state.aoi = h.aoi;
  }
  if (h.y0 !== undefined && h.y1 !== undefined) { state.y0 = Math.max(2000, h.y0); state.y1 = Math.min(lastYear, h.y1); if (state.y0 > state.y1) { state.y0 = 2000; state.y1 = lastYear; } }
  if (h.mode) state.mode = h.mode;
}
function wireControls(): void {
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
async function briefing(): Promise<void> {
  if (!series) return;
  const bm = await import('./briefing'), ex = await import('./export');
  const sp = { tFirst: meta.t_first, tLast: meta.t_last }, th = theme();
  const tm = thisMonthStats(series.harm, state.y0, state.y1, sp, meta.current_month_partial_days);
  const o = outlook(series.harm, sp);
  const cv = document.createElement('canvas');
  const pos: number[] = []; for (let t = meta.t_first; t <= meta.t_last; t++) if (series.harm[t] > 0) pos.push(series.harm[t]);
  bm.drawBriefing(cv, {
    name: aoiName, arr: series.harm, tLast: meta.t_last, y0: Math.max(state.y0, 2000), y1: state.y1, th, vmax: Math.max(1, percentile(pos, 98)), unit: 'harmonized detections per month', sample: !!meta.sample,
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
  p('Every sensor is converted to MODIS-equivalent units, the longest consistent record. The chain runs NOAA-21 → NOAA-20 → S-NPP → Aqua MODIS using overlap years of same-orbit pairs; a count model per month and region maps VIIRS detections onto the MODIS scale. Each harmonized value carries an approximate 90% band. For areas, bands are summed over cells, so they are approximate.');
  h('Validation');
  const v = meta.validation, hl = headline(v), vi: string[] = [];
  const brk = (label: string, key: string) => { const r = pick(v, key); if (num(pick(r, 'jump_ratio')) !== null) vi.push(`${label}: mean annual total changes ${hl[key === 'naive_break_2012' ? 'naive' : key === 'modis_only_reference' ? 'modis' : 'harm']} after the break, change point ${str(pick(r, 'change_point')) ?? DASH} (${str(pick(r, 'test')) ?? 'Pettitt'}, p ${fmtP(pick(r, 'p'))}).`); };
  brk('Naive splice', 'naive_break_2012'); brk('MODIS only', 'modis_only_reference'); brk('Harmonized', 'harmonized_break_2012');
  cvRows(v).forEach((r) => vi.push(`Leave-one-year-out, ${r.sensor} (${r.years}), region by month: bias ${r.bias}, MAE ${r.mae}, R\u00b2 ${r.r2}, n = ${r.n}.`));
  notes(v).forEach((n) => vi.push(n));
  if (!vi.length) vi.push('Validation numbers are not available in this data release.');
  ul(vi);
  h('Limitations');
  ul([`VIIRS S-NPP ended on ${meta.sensors.snpp.end}; NOAA-20 and NOAA-21 carry the record from there.`, 'Terra and Aqua (MODIS) are due to shut down in 2027 and their orbits are drifting, which shifts overpass times.', `Months from ${tLabel(meta.t_nrt_from)} use near-real-time data and are provisional.`, 'Cloud and smoke can hide fires; counts are not corrected for it.', 'Hotspot counts are not burned area, fire size or emissions.', 'Area totals use the H3 cells whose centre lies inside the area.']);
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
    replay.onFrame = (t) => { state.frameT = t; renderMap(); if (!replay!.playing) renderCalendar(); };
    replay.onStop = () => { renderCalendar(); renderMap(); };
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

async function boot(): Promise<void> {
  trackHeader();
  setStatus('Loading data\u2026');
  try {
    [meta, regions, countries, cellIds] = await Promise.all([loadMeta(), loadRegions(), loadCountries(), loadCells()]);
  } catch (e) { setStatus(`Could not load the data files (${(e as Error).message}).`, () => void boot()); return; }
  setStatus('');
  lastYear = yearOf(meta.t_last);
  state.y1 = lastYear;
  lat = new Float64Array(cellIds.length); lon = new Float64Array(cellIds.length);
  cellIds.forEach((id, i) => { const [a, b] = cellToLatLng(id); lat[i] = a; lon[i] = b; });
  $('badge-sample').hidden = !meta.sample;
  const fb = $('badge-fresh'); fb.hidden = false;
  fb.textContent = `Updated ${meta.generated_at.slice(0, 10)}${meta.data_through ? ` \u00b7 data through ${meta.data_through}` : ''}`; $('badge-nrt').hidden = false;
  renderInsights(); renderProof();
  wireControls(); renderMethod();
  $<HTMLDetailsElement>('method').addEventListener('toggle', () => { if ($<HTMLDetailsElement>('method').open) void ensureExplainer(); });
  applyHash(); syncControls();
  void ensureVisuals().catch((e) => setStatus(`Could not load the map and charts (${(e as Error).message}).`, () => { visuals = null; void refresh(); }));
  onThemeChange(() => { fireMap?.setDark(prefersDark()); explainerRender?.(); if (series && C) { renderCharts(); renderMap(); } });
  await refresh();
}
void boot();
