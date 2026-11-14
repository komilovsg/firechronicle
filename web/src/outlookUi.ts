import { el } from './ui/dom';
import { openInfoSheet } from './ui/sheet';
import { MONTH_ABBR } from './lib/time';
import { outlook } from './lib/analytics';
import { fmtTh, hindcast, monthStats, lastCompleteYear, monthPhrase, nextMonths, pace, seasonShift, timingFromCurve, type Sp } from './lib/outlook2';
import type * as ChartsMod from './charts';
import type { Chart } from './charts';
import type { Theme } from './theme';

export interface OutlookCtx { arr: Float64Array; sp: Sp; tNrt: number; C: typeof ChartsMod; chart: (key: string, id: string) => Chart; th: Theme; base: string; baseFull: string }
const NOTE = 'Climatology, not a forecast.';

function card(cls: string, title: string, caption: string, info: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', `card ${cls}`); root.setAttribute('aria-label', title);
  const head = el('div', 'card-h'); head.append(el('h3', undefined, title));
  const i = el('button', 'ol-i', 'ⓘ') as HTMLButtonElement; i.type = 'button'; i.setAttribute('aria-label', `About: ${title}`);
  i.addEventListener('click', () => openInfoSheet(title, el('p', undefined, info), i));
  head.append(i); const body = el('div', 'ol-body');
  root.append(head, el('p', 'ol-cap', caption), body); return { root, body };
}
const chartBox = (id: string, label: string): HTMLElement => { const d = el('div', 'chart h260'); d.id = id; d.setAttribute('role', 'img'); d.setAttribute('aria-label', label); return d; };

export function renderOutlook2(host: HTMLElement, c: OutlookCtx): void {
  const { arr, sp } = c, ly = lastCompleteYear(sp);
  const fresh = !host.firstChild;
  if (fresh) {
    const mk = (k: string, ...a: Parameters<typeof card> extends [string, ...infer R] ? R : never): HTMLElement => { const x = card(`ol-${k}`, ...(a as [string, string, string])); x.root.dataset.k = k; host.append(x.root); return x.body; };
    mk('timing', 'Season timing', 'When the next busy period is likely, and what a typical season looks like.', 'Built from the last 10 complete years of monthly harmonized detections for this area. The next period is the run of months with a 50 % or higher chance of being above the area\'s 75th percentile. Season start, peak and end are where the cumulative median reaches 10 %, the largest month and 90 %. ' + NOTE);
    mk('next3', 'Next 3 months in numbers', 'Typical value, range and chance of a high-activity month.', 'Median and P10–P90 range of that calendar month over the last 10 complete years; the chance is the share of those years above the area\'s 75th percentile, Laplace-smoothed. ' + NOTE);
    mk('pace', "This year's pace", 'The cumulative total so far against the last 10 years.', 'Solid line: the cumulative harmonized total for the current year (dashed months are provisional). Dotted line and band: median and P10–P90 of the cumulative curves of the last 10 complete years. The projection adds the year to date (complete months) to what remained in each earlier year. ' + NOTE);
    mk('shift', 'Is the season shifting?', 'Season start, middle and end for every complete year since 2001.', 'For each year the day where the cumulative monthly total reaches 10 %, 50 % and 90 %, interpolated inside the month. Trend: Theil–Sen slope; significance: Mann–Kendall test (normal approximation). Monthly data limits the timing precision to about 1–2 weeks.');
    mk('rel', 'How reliable is this outlook?', 'A hindcast: what the strip would have said in 2016–2025.', 'For every year from 2016 the chance was computed from only the 10 years before it. Months with a chance of 50 % or more were flagged, then checked: was that month actually above the P75 of that earlier window?');
  }
  const body = (k: string): HTMLElement => host.querySelector<HTMLElement>(`[data-k="${k}"] .ol-body`)!;
  // 1 timing
  {
    const b = body('timing'); b.textContent = '';
    const o = outlook(arr, sp), i = o.months.findIndex((x) => x.critical);
    const med = monthStats(arr, sp, ly).median, t = timingFromCurve(med), peak = med.indexOf(Math.max(...med.filter(Number.isFinite)));
    if (o.next && i >= 0) { const a = MONTH_ABBR[o.next.from - 1], z = MONTH_ABBR[o.next.to - 1]; b.append(el('p', 'ol-big', `Next high-activity period: ${a === z ? a : `${a}–${z}`}`), el('p', 'ol-sub', i === 0 ? 'starts next month' : `in ${i + 1} months`)); }
    else b.append(el('p', 'ol-big', 'No month in the next 12 is likely to be high-activity'));
    if (t) b.append(el('p', 'ol-text', `In a typical year (${c.base}) activity starts in ${monthPhrase(t.start, MONTH_ABBR)}, peaks in ${MONTH_ABBR[peak]} and ends in ${monthPhrase(t.end, MONTH_ABBR)}. ${NOTE}`));
  }
  // 2 next 3 months
  {
    const b = body('next3'); b.textContent = '';
    const tbl = el('table', 'dtbl ol-tbl'), hr = el('tr'); for (const h of ['Month', 'Typical', 'Range P10–P90', 'Chance high']) { const th = el('th', h === 'Month' ? 'l' : 'r', h); th.scope = 'col'; hr.append(th); }
    const th = el('thead'); th.append(hr); const tb = el('tbody');
    for (const r of nextMonths(arr, sp)) { const tr = el('tr'); const m = el('th', 'l', `${MONTH_ABBR[r.m - 1]} ${r.year}`); m.scope = 'row'; tr.append(m, el('td', 'r mono', fmtTh(r.median)), el('td', 'r mono', `${fmtTh(r.p10)}–${fmtTh(r.p90)}`), el('td', 'r mono', `${Math.round(r.chance * 100)}%`)); tb.append(tr); }
    tbl.append(el('caption', 'sr', 'Next three months'), th, tb); b.append(tbl);
  }
  // 3 pace
  {
    const b = body('pace'), p = pace(arr, sp);
    let tx = host.querySelector<HTMLElement>('.ol-pace-text'); if (!tx) { tx = el('div', 'ol-pace-text'); b.append(tx, chartBox('ol-pace-chart', 'Cumulative total this year against the median of the last 10 years')); }
    tx.textContent = '';
    if (p.proj && p.status) { tx.append(el('p', 'ol-big sm', `Projected year total: ${fmtTh(p.proj.lo)}–${fmtTh(p.proj.hi)} (median ${fmtTh(p.proj.med)})`), el('p', 'ol-sub', `On track for ${p.status === 'normal' ? 'a normal' : p.status === 'below' ? 'a below-normal' : 'an above-normal'} year (vs ${c.base})`)); }
    else tx.append(el('p', 'ol-text', 'Not enough complete years for a projection.'));
    const nrtM = c.tNrt >= sp.tFirst && Math.floor(c.tNrt / 12) === Math.floor(sp.tLast / 12) ? (c.tNrt % 12) + 1 : c.tNrt < Math.floor(sp.tLast / 12) * 12 ? 1 : 13;
    c.chart('olpace', 'ol-pace-chart').setOption(c.C.paceOption(p, nrtM, c.th, c.base), true);
  }
  // 4 shift
  {
    const b = body('shift'), s = seasonShift(arr, sp);
    let tx = host.querySelector<HTMLElement>('.ol-shift-text'); if (!tx) { tx = el('div', 'ol-shift-text'); b.append(chartBox('ol-shift-chart', 'Season start, middle and end by year'), tx); }
    tx.textContent = '';
    if (s) {
      const d = s.slope.start, sig = s.p.start < 0.05;
      tx.append(el('p', 'ol-text', sig ? `Season start has moved ${Math.round(Math.abs(d))} days ${d < 0 ? 'earlier' : 'later'} per decade (p=${s.p.start.toFixed(3)}).` : `No significant shift in season timing since ${s.years[0]}.`), el('p', 'ol-cap', `Theil–Sen slope of the start: ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} days per decade. Monthly data — timing precision ≈ 1–2 weeks.`));
      c.chart('olshift', 'ol-shift-chart').setOption(c.C.shiftOption(s, c.th), true);
    } else tx.append(el('p', 'ol-text', 'Not enough complete years to judge the timing.'));
  }
  // 5 reliability
  {
    const b = body('rel'); b.textContent = '';
    const h = hindcast(arr, sp), pc = (x: number | null): string => (x === null ? '—' : `${Math.round(x)}%`);
    if (h.hitPct !== null && h.basePct !== null) b.append(el('p', 'ol-text', `Months flagged high-activity were actually high in ${pc(h.hitPct)} of cases, vs ${pc(h.basePct)} for any month (base rate).`));
    const tbl = el('table', 'dtbl ol-tbl'); const hr = el('tr'); for (const x of ['', 'Months', 'Actually high']) { const th = el('th', x ? 'r' : 'l', x); th.scope = 'col'; hr.append(th); }
    const th = el('thead'); th.append(hr); const tb = el('tbody');
    for (const [n, cnt, pct] of [['Flagged (≥ 50 %)', h.flaggedN, h.hitPct], ['Not flagged', h.unflaggedN, h.unflaggedPct], ['Any month', h.allN, h.basePct]] as [string, number, number | null][]) { const tr = el('tr'); const r = el('th', 'l', n); r.scope = 'row'; tr.append(r, el('td', 'r mono', String(cnt)), el('td', 'r mono', pc(pct))); tb.append(tr); }
    tbl.append(el('caption', 'sr', 'Hindcast reliability'), th, tb); b.append(tbl);
    b.append(el('p', 'ol-skill ' + h.skill, h.skill === 'good' ? 'The flags carry real signal for this area.' : h.skill === 'weak' ? 'Weak skill for this area — use as a rough guide.' : 'Too few flagged months to judge skill for this area.'));
  }
}
