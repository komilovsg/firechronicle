import { el } from './ui/dom';
import { sortRows, STATUS_LABEL, type CountryRow, type Delta, type SortKey, type SensorRow } from './lib/dashboard';
import { formatCountdown, nextRun, parseRefresh } from './lib/freshness';
import { nowDate } from './lib/clock';
import { anomalyBin } from './lib/anomalyNow';
import { MONTH_ABBR } from './lib/time';
import type { Meta } from './lib/series';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (t: string, a: Record<string, string>): SVGElement => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
function svgIcon(cls: string): SVGElement { const s = svgEl('svg', { viewBox: '0 0 10 10', width: '10', height: '10', 'aria-hidden': 'true' }); s.append(svgEl('rect', { width: '10', height: '10', rx: '2', class: cls })); return s; }
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export interface Kpi { key: string; label: string; value: string; unit?: string; delta: Delta | null; deltaNote?: string; sub: string; spark: number[] | null; tone?: 'ok' | 'mute' }
export interface DashModel {
  meta: Meta; areaName: string; dataThrough: string | null;
  kpis: Kpi[]; rows: CountryRow[]; tableTitle: string; activeId: string | null;
  sensors: SensorRow[];
}
export interface DashHandlers { openView: (v: string) => void; setArea: (id: string) => void }

/** Tiny line sparkline; no axes. The last point is marked. */
export function spark(vals: number[], cls = 'dspark'): SVGElement {
  const w = 96, h = 26, n = vals.length, ok = vals.filter(Number.isFinite);
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: cls, 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  if (n < 2 || !ok.length) return svg;
  const mn = Math.min(...ok), mx = Math.max(...ok), rng = mx - mn || 1;
  const x = (i: number): number => 2 + (i / (n - 1)) * (w - 4), y = (v: number): number => h - 3 - ((v - mn) / rng) * (h - 8);
  const pts = vals.map((v, i) => (Number.isFinite(v) ? [x(i), y(v)] : null)).filter((p): p is number[] => !!p);
  svg.append(svgEl('polyline', { points: pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const l = pts[pts.length - 1]; svg.append(svgEl('circle', { cx: l[0].toFixed(1), cy: l[1].toFixed(1), r: '2.2', fill: 'var(--ember)' }));
  return svg;
}

const SORTS: [SortKey, string, string][] = [['name', 'Country', 'l'], ['value', 'This month', 'r'], ['pct', 'vs median', 'r'], ['ytd', 'YTD vs median', 'r'], ['rank', 'Percentile', 'r']];
let sortKey: SortKey = 'value', sortDir: 1 | -1 = -1, timer = 0;

export function buildDash(root: HTMLElement): void {
  root.textContent = '';
  const head = el('header', 'vhead'); head.append(el('h2', undefined, "What's happening here?"), el('p', undefined, ''));
  head.lastElementChild!.id = 'd-sub';
  const status = el('div', 'd-status'); status.id = 'd-status'; status.setAttribute('role', 'status');
  const proof = el('div', 'd-proof'); proof.id = 'd-proof';
  const kpis = el('div', 'd-kpis'); kpis.id = 'd-kpis';
  const main = el('section', 'card d-main'); main.setAttribute('aria-labelledby', 'd-main-h');
  const mh = el('div', 'card-h'); const h3 = el('h3', undefined, 'Last 24 months vs normal'); h3.id = 'd-main-h'; mh.append(h3, el('span', 'muted', 'Harmonized monthly detections; the band is the P10–P90 range of earlier years'));
  const chartBox = el('div', 'chart h300'); chartBox.id = 'dash-chart'; chartBox.setAttribute('role', 'img');
  main.append(mh, chartBox);
  const tbl = el('section', 'card d-table'); tbl.setAttribute('aria-labelledby', 'd-tbl-h');
  const th3 = el('h3', undefined, 'Countries'); th3.id = 'd-tbl-h'; const tw = el('div', 'tbl-wrap'); tw.id = 'd-tbl';
  tbl.append(el('div', 'card-h'), tw); tbl.firstElementChild!.append(th3, el('span', 'muted', 'This month against the same month of earlier years'));
  const bottom = el('div', 'd-bottom');
  const un = el('section', 'card'); un.setAttribute('aria-labelledby', 'd-un-h');
  const uh = el('h3', undefined, 'Where is it unusual now?'); uh.id = 'd-un-h';
  const note = el('p', 'lede2', 'Loading cell data…'); note.id = 'dash-note';
  const ol = el('ol', 'toplist'); ol.id = 'dash-top';
  un.append(el('div', 'card-h'), note, ol); un.firstElementChild!.append(uh);
  const mm = el('section', 'card'); mm.setAttribute('aria-labelledby', 'd-mm-h');
  const mmh = el('h3', undefined, 'Anomaly map'); mmh.id = 'd-mm-h';
  const mmb = el('button', 'mm-btn') as HTMLButtonElement; mmb.type = 'button'; mmb.id = 'dash-minimap'; mmb.setAttribute('aria-label', 'Anomaly map of this area. Open the Anomalies section.');
  const leg = el('ul', 'mm-leg'); for (const [c, t] of legendItems()) { const li = el('li'); li.append(svgIcon(c), t); leg.append(li); }
  mm.append(el('div', 'card-h'), mmb, leg, el('p', 'note', '')); mm.firstElementChild!.append(mmh); mm.lastElementChild!.id = 'dash-mm-note';
  void 0;
  bottom.append(un, mm);
  root.append(head, status, proof, kpis, main, tbl, bottom);
}

function chip(delta: Delta | null, note?: string): HTMLElement {
  const c = el('span', `dchip ${delta?.dir ?? 'none'}`, delta ? delta.text : 'no baseline');
  if (note && delta) c.append(el('span', 'dnote', ` ${note}`));
  return c;
}
export function renderStatus(m: DashModel): void {
  const box = document.getElementById('d-status')!; box.textContent = '';
  const fr = el('span', 'ds-item'); const left = el('span', undefined, m.dataThrough ? `Data through ${fmtDate(m.dataThrough)}` : 'Data date unknown');
  const cd = el('span', 'digits'); cd.id = 'd-cd'; fr.append(left, ' · next update in ', cd); box.append(fr);
  for (const s of m.sensors) {
    const amber = s.state === 'active' && !!s.note, cls = s.state === 'ended' ? 'off' : amber ? 'warn' : 'ok';
    const c = el('span', 'ds-item'); c.append(el('span', `sdot ${cls}`), `${s.label} `, el('b', undefined, s.text + (s.note ? ` · ${s.note}` : '')));
    c.querySelector('.sdot')!.setAttribute('aria-hidden', 'true'); box.append(c);
  }
  clearInterval(timer);
  const refresh = m.meta.refresh ? parseRefresh(m.meta.refresh) : null;
  const tick = (): void => { if (document.hidden || !refresh) return; const d = document.getElementById('d-cd'); if (d) d.textContent = formatCountdown(nextRun(nowDate(), refresh.schedule_utc).getTime() - nowDate().getTime()); };
  tick(); timer = window.setInterval(tick, 1000);
}
function fmtDate(iso: string): string { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${+m[3]} ${MONTH_ABBR[+m[2] - 1]} ${m[1]}` : iso; }

export function renderKpis(m: DashModel): void {
  const box = document.getElementById('d-kpis')!; box.textContent = '';
  for (const k of m.kpis) {
    const t = el('div', 'kpi'); t.dataset.kpi = k.key;
    t.append(el('div', 'kpi-l', k.label), el('div', 'kpi-v', k.value));
    if (k.delta || k.key === 'tm' || k.key === 'ytd') t.append(chip(k.delta, k.deltaNote));
    t.append(el('div', 'kpi-s', k.sub));
    if (k.spark) t.append(spark(k.spark));
    box.append(t);
  }
}
export function renderTable(m: DashModel, h: DashHandlers): void {
  const host = document.getElementById('d-tbl')!; host.textContent = '';
  document.getElementById('d-tbl-h')!.textContent = m.tableTitle;
  const tbl = el('table', 'dtbl'), cap = el('caption', 'sr', `${m.tableTitle}: this month against earlier years`);
  const thead = el('thead'), hr = el('tr');
  for (const [key, label, al] of SORTS) {
    const th = el('th', al); th.scope = 'col'; th.setAttribute('aria-sort', sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
    const b = el('button', 'sortbtn', label) as HTMLButtonElement; b.type = 'button';
    b.append(el('span', 'arr', sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''));
    b.addEventListener('click', () => { if (sortKey === key) sortDir = (sortDir * -1) as 1 | -1; else { sortKey = key; sortDir = key === 'name' ? 1 : -1; } renderTable(m, h); (host.querySelector(`th:nth-child(${SORTS.findIndex((s) => s[0] === key) + 1}) button`) as HTMLElement | null)?.focus(); });
    th.append(b); hr.append(th);
    if (key === 'ytd') { const t2 = el('th', 'l', '12-month trend'); t2.scope = 'col'; hr.append(t2); }
  }
  const st = el('th', 'l', 'Status'); st.scope = 'col'; hr.append(st);
  thead.append(hr); const body = el('tbody');
  const pct = (p: number): string => (Number.isFinite(p) ? `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%` : '—');
  for (const r of sortRows(m.rows, sortKey, sortDir)) {
    const tr = el('tr'); if (r.id === m.activeId) tr.className = 'cur';
    const nm = el('th', 'l'); nm.scope = 'row';
    if (r.id) { const b = el('button', 'rowbtn', r.name) as HTMLButtonElement; b.type = 'button'; b.setAttribute('aria-label', `Show ${r.name}`); b.addEventListener('click', () => h.setArea(r.id)); nm.append(b); tr.addEventListener('click', (e) => { if (e.target === tr || (e.target as HTMLElement).tagName === 'TD') h.setArea(r.id); }); tr.classList.add('click'); } else nm.append(r.name);
    const td = (t: string, c = 'r'): HTMLElement => el('td', c, t);
    const sp = el('td', 'l'); if (r.trend.length) sp.append(spark(r.trend, 'dspark t'));
    const badge = el('td', 'l'); if (r.status) badge.append(el('span', `sbadge ${r.status}`, `${r.status === 'extreme' ? '▲▲' : r.status === 'above' ? '▲' : r.status === 'below' ? '▼' : '●'} ${STATUS_LABEL[r.status]}`)); else badge.append('—');
    tr.append(nm, td(fmt(r.value)), td(pct(r.pct)), td(pct(r.ytd)), sp, td(Number.isFinite(r.rank) ? String(Math.round(r.rank)) : '—'), badge);
    body.append(tr);
  }
  tbl.append(cap, thead, body); host.append(tbl);
}

export interface MiniCell { lon: number; lat: number; pct: number; ring: [number, number][] }
/** Static SVG hex map coloured by the percentile bin. Cells without enough history are not drawn. */
export function renderMiniMap(host: HTMLElement, cells: MiniCell[], outlines: [number, number][][], onClick: () => void, noteEl: HTMLElement | null): void {
  host.textContent = '';
  const drawn = cells.filter((c) => anomalyBin(c.pct) >= 0);
  const src = drawn.length ? drawn : cells;
  if (!src.length) { host.append(el('span', 'muted', 'No cells in this area')); return; }
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const c of cells) { x0 = Math.min(x0, c.lon); x1 = Math.max(x1, c.lon); y0 = Math.min(y0, c.lat); y1 = Math.max(y1, c.lat); }
  const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180), pad = 0.6, W = (x1 - x0 + 2 * pad) * k, H = y1 - y0 + 2 * pad;
  const X = (lo: number): number => (lo - x0 + pad) * k, Y = (la: number): number => y1 + pad - la;
  const svg = svgEl('svg', { viewBox: `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`, class: 'minimap', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  const path = (rings: [number, number][][]): string => rings.map((r) => 'M' + r.map(([lo, la]) => `${X(lo).toFixed(2)} ${Y(la).toFixed(2)}`).join('L') + 'Z').join('');
  const oc = outlines.filter((r) => r.some(([lo, la]) => lo >= x0 - pad && lo <= x1 + pad && la >= y0 - pad && la <= y1 + pad));
  if (oc.length) svg.append(svgEl('path', { d: path(oc), class: 'mm-out', fill: 'none' }));
  for (let b = 0; b <= 4; b++) {
    const g = src.filter((c) => anomalyBin(c.pct) === b); if (!g.length) continue;
    svg.append(svgEl('path', { d: path(g.map((c) => c.ring)), class: `mm-b${b}` }));
  }
  const n = [0, 0, 0, 0, 0]; for (const c of drawn) n[anomalyBin(c.pct)]++;
  const hi = n[3] + n[4], lo = n[0] + n[1];
  svg.setAttribute('aria-label', `Anomaly map: ${drawn.length} cells with enough history, ${hi} above normal (${n[4]} extreme), ${lo} below normal.`);
  host.append(svg);
  host.onclick = onClick;
  if (noteEl) noteEl.textContent = `${hi} cells above normal (${n[4]} extreme), ${lo} below, of ${drawn.length} with enough history. Colour is the percentile against the same month of earlier years.`;
}
export function fillLegend(ul: HTMLElement): void { for (const [c, t] of legendItems()) { const li = el('li'); li.append(svgIcon(c), t); ul.append(li); } }
export function legendItems(): [string, string][] { return [['mm-b0', 'Well below'], ['mm-b1', 'Below'], ['mm-b2', 'Normal'], ['mm-b3', 'Above'], ['mm-b4', 'Extreme']]; }
