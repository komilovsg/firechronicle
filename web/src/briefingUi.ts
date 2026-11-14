import { SEQ } from './theme';
import type { DataModule } from './lib/briefing';
import { el } from './ui/dom';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
export function chipRow(chips: { k: string; v: string }[]): HTMLElement {
  const row = el('div', 'mc-kpis');
  for (const c of chips) { const s = el('span', 'mc-kpi'); s.append(el('b', undefined, c.k), el('span', 'num', c.v)); row.append(s); }
  return row;
}
function stripEl(d: DataModule, large: boolean): HTMLElement {
  const g = el('div', `mc-mgrid${large ? ' large' : ''}`); g.setAttribute('role', 'img');
  g.setAttribute('aria-label', `Typical month by month: ${d.months.filter((m) => m.inSeason).map((m) => m.label).join(', ') || 'no clear season'} are in season`);
  d.months.forEach((m) => {
    const cell = el('div', 'mc-mcell'), c = el('div', 'mc-mbox' + (m.inSeason ? ' in' : ''));
    c.style.background = SEQ[Math.min(SEQ.length - 1, Math.floor(m.share * (SEQ.length - 0.01)))]; c.title = `${m.label}: ${Math.round(m.share * 100)}% of the peak month${m.inSeason ? ' (season)' : ''}`;
    cell.append(c, el('span', 'mc-ml', large ? m.label : m.label[0])); g.append(cell);
  });
  return g;
}
export function sparkEl(d: DataModule, h = 28, large = false): SVGElement {
  const sp = d.spark!, n = sp.totals.length, w = large ? 360 : 196, H = large ? 130 : h, padL = large ? 34 : 3, padB = large ? 18 : 4, padT = 6;
  const max = Math.max(1, ...sp.totals), px = (i: number): number => padL + (i / Math.max(1, n - 1)) * (w - padL - 8), py = (v: number): number => H - padB - (v / max) * (H - padB - padT);
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${H}`, class: large ? 'mc-spark large' : 'mc-spark', role: 'img', preserveAspectRatio: 'none' });
  svg.setAttribute('aria-label', `Annual totals ${sp.years[0]} to ${sp.years[n - 1]}; latest ${Math.round(sp.latest)}`);
  if (large) {
    for (const f of [0, 0.5, 1]) { const y = py(max * f); svg.append(svgEl('line', { x1: padL, x2: w - 8, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': 1 })); const t = svgEl('text', { x: padL - 4, y: y + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--ink-3)', 'font-family': 'IBM Plex Mono, monospace' }); t.textContent = Math.round(max * f).toLocaleString('en-US').replace(/,/g, '\u2009'); svg.append(t); }
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i) => { const t = svgEl('text', { x: px(i), y: H - 4, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', 'font-size': 9, fill: 'var(--ink-3)', 'font-family': 'IBM Plex Mono, monospace' }); t.textContent = String(sp.years[i]); svg.append(t); });
  }
  svg.append(svgEl('polyline', { points: sp.totals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' '), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': large ? 1.8 : 1.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  svg.append(svgEl('circle', { cx: px(n - 1), cy: py(sp.totals[n - 1]), r: large ? 4 : 3, fill: 'var(--ember)', stroke: 'var(--surface-2)', 'stroke-width': 1.5 }));
  return svg;
}
/** Full data module: all chips, a 12-month climatology strip (cividis by median share, season outlined) and the annual chart. */
export function dataModuleEl(d: DataModule, large = false): HTMLElement {
  const box = el('div', 'mc-data'); box.append(chipRow(d.chips), stripEl(d, large));
  if (d.spark) { box.append(sparkEl(d, 40, large)); box.append(el('p', 'mc-cap', `ANNUAL HARMONIZED TOTAL ${d.spark.years[0]}\u2013${d.spark.years[d.spark.years.length - 1]}`)); }
  return box;
}
