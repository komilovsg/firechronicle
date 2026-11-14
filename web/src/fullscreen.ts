import { fsLayout } from './lib/fsLayout';
import { snapDecision } from './ui/selectLogic';
import { onFreshTick } from './freshnessUi';

export interface HudData {
  aoiName: string;
  month: { big: string; sub: string };
  next: { big: string; sub: string };
  ytd: { big: string; sub: string };
  nrtNote: string;
  bars: { years: number[]; values: number[]; curYear: number; cur: number; median: number; title: string } | null;
  top: { label: string; pct: string; lon: number; lat: number }[];
}
export interface FsApi {
  getHud(): HudData; flyTo(lon: number, lat: number): void; resetView(): void; zoom(d: 1 | -1): void; resize(): void;
  mainSelect: HTMLSelectElement; toggleTheme(): void; openStyle(anchor: HTMLElement): void;
}
const KEY = 'fc-fs-collapsed';
const loadCollapsed = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const saveCollapsed = (a: string[]): void => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ } };
const reduce = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const $ = (id: string): HTMLElement => document.getElementById(id)!;

let overlay: HTMLElement | null = null, active = false, apiRef: FsApi | null = null;
const undo: (() => void)[] = [];
let hudEls: ReturnType<typeof build> | null = null;
let returnFocus: HTMLElement | null = null;

function move(node: Element, parent: Element, before: Node | null = null): void {
  const p = node.parentNode, n = node.nextSibling;
  undo.push(() => { p?.insertBefore(node, n); });
  parent.insertBefore(node, before);
}
function panel(id: string, title: string, collapsed: string[], opts: { titleEl?: HTMLElement } = {}): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', `fs-panel fs-${id}`); root.dataset.panel = id;
  const head = el('div', 'fs-phead'); const t = opts.titleEl ?? el('span', 'fs-ptitle', title);
  const btn = el('button', 'fs-chev'); btn.type = 'button'; btn.setAttribute('aria-label', `Collapse ${title}`); btn.setAttribute('aria-expanded', 'true'); btn.textContent = '⌃';
  const body = el('div', 'fs-pbody'); body.id = `fs-body-${id}`; btn.setAttribute('aria-controls', body.id);
  const set = (c: boolean): void => { body.hidden = c; root.classList.toggle('collapsed', c); btn.setAttribute('aria-expanded', String(!c)); btn.setAttribute('aria-label', `${c ? 'Expand' : 'Collapse'} ${title}`); };
  set(collapsed.includes(id));
  btn.addEventListener('click', () => { const c = !body.hidden; set(c); const cur = loadCollapsed().filter((x) => x !== id); if (c) cur.push(id); saveCollapsed(cur); });
  head.append(t, btn); root.append(head, body);
  return { root, body };
}
function icon(label: string, text: string, fn: () => void): HTMLButtonElement {
  const b = el('button', 'fs-ic', text); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); return b;
}

function build(api: FsApi) {
  const collapsed = loadCollapsed();
  const ov = el('div', 'fs-overlay'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Fullscreen map'); ov.hidden = true;
  const hud = el('div', 'fs-hud');
  // top-left: area card
  const brand = el('span', 'fs-brand'); const mark = document.querySelector('.mark')?.cloneNode(true) as SVGElement | undefined; if (mark) { mark.setAttribute('width', '22'); mark.setAttribute('height', '22'); brand.append(mark); } brand.append(el('span', undefined, 'FireChronicle'));
  const tl = panel('area', 'Area', collapsed, { titleEl: brand });
  const name = el('h2', 'fs-name');
  const lab = el('label', 'fld'); lab.append(el('span', undefined, 'Area'));
  const sel = el('select'); sel.id = 'fs-area'; lab.append(sel);
  const figs = el('ul', 'fs-figs');
  const fig = (): { li: HTMLElement; k: HTMLElement; v: HTMLElement; s: HTMLElement } => { const li = el('li'); const k = el('div', 'k'), v = el('div', 'v'), s = el('div', 's'); li.append(k, v, s); figs.append(li); return { li, k, v, s }; };
  const f1 = fig(), f2 = fig(), f3 = fig(); f1.k.textContent = 'This month vs median'; f2.k.textContent = 'Next high-activity'; f3.k.textContent = 'Year to date vs median';
  const fresh = el('div', 'fs-fresh'); fresh.setAttribute('aria-live', 'off');
  tl.body.append(name, lab, figs, fresh);
  // top-right: controls
  const tr = panel('controls', 'Map', collapsed);
  const stack = el('div', 'fs-stack');
  const exit = icon('Exit fullscreen map (Esc)', '✕', () => void exitFs());
  stack.append(icon('Zoom in', '+', () => api.zoom(1)), icon('Zoom out', '−', () => api.zoom(-1)), icon('Reset view', '⟲', () => api.resetView()), icon('Switch theme', '◐', () => api.toggleTheme()));
  const layersHome = el('div', 'fs-layers'); const btn3dHome = el('div', 'fs-3d');
  tr.body.append(layersHome, btn3dHome, stack, exit);
  // bottom row
  const bottom = el('div', 'fs-bottom');
  const bl = panel('legend', 'Legend', collapsed); const legendHome = el('div', 'fs-legend'); const nrt = el('p', 'fs-nrt'); bl.body.append(legendHome, nrt, el('p', 'fs-credit', 'FireChronicle \u00b7 Deep Space AI'));
  const tm = panel('timeline', 'Timeline', collapsed); const replayHome = el('div', 'fs-replay'); tm.body.append(replayHome);
  const br = panel('context', 'This month vs history', collapsed);
  const spark = el('canvas', 'fs-spark'); spark.setAttribute('role', 'img'); const sparkCap = el('p', 'fs-cap');
  const unH = el('h3', 'fs-sub', 'Where is it unusual now?'); const top = el('ol', 'fs-top');
  const ctx = el('div', 'fs-ctx'); ctx.append(spark, sparkCap, unH, top); br.body.append(ctx);
  bottom.append(bl.root, tm.root, br.root);
  // mobile sheet
  const sheetWrap = el('div', 'fs-sheetwrap'); const sheet = el('div', 'fs-sheet'); const sh = el('div', 'fs-sheadhead'); sh.append(el('div', 'csel-grab'), el('div', 'fs-stitle', 'Details')); const sbody = el('div', 'fs-sbody'); sheet.append(sh, sbody); sheetWrap.append(sheet);
  hud.append(tl.root, tr.root, bottom, sheetWrap);
  ov.append(hud); document.body.append(ov);
  return { sheetWrap, ov, hud, name, sel, figs, f1, f2, f3, fresh, tl, tr, bl, tm, br, stack, exit, layersHome, btn3dHome, legendHome, replayHome, nrt, spark, sparkCap, top, ctx, sheet, sh, sbody, unH, panels: [tl.root, tr.root, bl.root, tm.root, br.root] };
}

function drawBars(c: HTMLCanvasElement, b: NonNullable<HudData['bars']>): void {
  const dpr = devicePixelRatio || 1, w = c.clientWidth || 240, h = c.clientHeight || 70;
  c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement), ink3 = cs.getPropertyValue('--ink-3').trim(), ember = cs.getPropertyValue('--ember').trim(), ink = cs.getPropertyValue('--ink').trim();
  const vals = [...b.values, b.cur], n = vals.length, max = Math.max(1, ...vals, b.median), bw = Math.max(2, (w - (n - 1) * 1.5) / n);
  const Y = (v: number): number => h - 2 - (v / max) * (h - 8);
  vals.forEach((v, i) => { g.fillStyle = i === n - 1 ? ember : ink3 + 'aa'; const y = Y(v); g.fillRect(i * (bw + 1.5), y, bw, h - 2 - y); });
  g.strokeStyle = ink; g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(b.median)); g.lineTo(w, Y(b.median)); g.stroke();
}

export function refreshHud(): void {
  if (!active || !hudEls || !apiRef) return;
  const d = apiRef.getHud(), h = hudEls;
  h.name.textContent = d.aoiName;
  const drifted = document.querySelector('.ctrl-reset')?.classList.contains('drifted') ?? false; h.stack.querySelectorAll('[data-reset]').forEach((x) => x.classList.toggle('drifted', drifted));
  h.f1.v.textContent = d.month.big; h.f1.s.textContent = d.month.sub; h.f2.v.textContent = d.next.big; h.f2.s.textContent = d.next.sub; h.f3.v.textContent = d.ytd.big; h.f3.s.textContent = d.ytd.sub;
  h.nrt.textContent = d.nrtNote; h.nrt.hidden = !d.nrtNote;
  if (d.bars) { h.br.root.classList.remove('empty'); drawBars(h.spark, d.bars); h.sparkCap.textContent = d.bars.title; h.spark.setAttribute('aria-label', `${d.bars.title}. Current ${Math.round(d.bars.cur)}, median ${Math.round(d.bars.median)}.`); } else { h.sparkCap.textContent = 'Not enough history yet.'; }
  h.top.textContent = '';
  d.top.slice(0, 3).forEach((u, i) => {
    const li = el('li'), b = el('button'); b.type = 'button'; b.append(el('span', 'rk', String(i + 1)), el('span', 'lb', u.label), el('span', 'pc', u.pct));
    b.addEventListener('click', () => apiRef!.flyTo(u.lon, u.lat)); li.append(b); h.top.append(li);
  });
  if (!d.top.length) h.top.append(el('li', 'fs-cap', 'Loading…'));
  // mirror the area select options
  const main = apiRef.mainSelect;
  if (h.sel.options.length !== main.options.length || h.sel.value !== main.value) {
    h.sel.textContent = ''; [...main.options].forEach((o) => { const n = new Option(o.textContent ?? '', o.value); n.disabled = o.disabled; h.sel.append(n); });
    h.sel.value = main.value;
  }
}

function applyLayout(): void {
  if (!hudEls || !overlay) return;
  const h = hudEls, l = fsLayout(innerWidth); overlay.dataset.layout = l;
  const mobile = l === 'mobile';
  const legend = $('maplegend'), layers = $('maplayers'), dim = $('dim-toggle'), replay = $('replay');
  void replay;
  if (mobile) {
    h.sbody.append(layers, h.figs, legend, h.nrt, h.ctx);
    h.tl.root.querySelector('.fs-phead')!.prepend(h.sel.closest('label')!); h.tl.root.querySelector('.fs-phead')!.append(h.exit);
    h.stack.prepend(dim);
  } else {
    h.layersHome.append(layers); h.btn3dHome.append(dim);
    h.tl.body.insertBefore(h.sel.closest('label')!, h.fresh); h.tl.body.insertBefore(h.figs, h.fresh); h.legendHome.append(legend); h.bl.body.append(h.nrt); h.br.body.append(h.ctx);
    h.tr.body.append(h.exit);
  }
  if (mobile) setupSheet();
  apiRef?.resize();
  refreshHud();
}

/* mobile bottom sheet: peeks at 72 px, drag up to expand */
let sheetCleanup: (() => void) | null = null;
function setupSheet(): void {
  const h = hudEls!; sheetCleanup?.();
  const sheet = h.sheet, head = h.sh;
  const tmEl = h.tm.root;
  const wrap = h.sheetWrap;
  const H = (): number => Math.min(innerHeight * 0.62, 520);
  const place = (): void => { wrap.style.bottom = `${tmEl.offsetHeight + 36}px`; wrap.style.height = `${H()}px`; };
  place();
  const peekY = (): number => H() - 72;
  let y = peekY(), drag: { sy: number; st: number; ly: number; lt: number; v: number } | null = null;
  const apply = (ty: number, anim: boolean): void => { y = ty; sheet.style.transition = anim && !reduce() ? 'transform 200ms cubic-bezier(.23,1,.32,1)' : 'none'; sheet.style.transform = `translateY(${ty}px)`; };
  apply(peekY(), false);
  const pm = (e: PointerEvent): void => { if (!drag) return; const now = performance.now(), dt = Math.max(1, now - drag.lt); drag.v = 0.8 * drag.v + 0.2 * ((e.clientY - drag.ly) / dt); drag.ly = e.clientY; drag.lt = now; apply(Math.max(0, Math.min(peekY(), drag.st + e.clientY - drag.sy)), false); };
  const pu = (): void => { removeEventListener('pointermove', pm); removeEventListener('pointerup', pu); if (!drag) return; const v = drag.v; drag = null; const s = snapDecision({ y, defaultY: peekY(), closedY: H() + 200, velocity: v }); apply(s === 'expanded' ? 0 : peekY(), true); };
  const pd = (e: PointerEvent): void => { e.preventDefault(); drag = { sy: e.clientY, st: y, ly: e.clientY, lt: performance.now(), v: 0 }; addEventListener('pointermove', pm); addEventListener('pointerup', pu); };
  head.addEventListener('pointerdown', pd);
  head.addEventListener('click', () => { if (!drag) apply(y > 8 ? 0 : peekY(), true); });
  const ro = new ResizeObserver(place); ro.observe(tmEl);
  sheetCleanup = () => { head.removeEventListener('pointerdown', pd); ro.disconnect(); sheetCleanup = null; };
}

function onKey(e: KeyboardEvent): void {
  if (!active) return;
  const t = e.target as HTMLElement | null, tag = t?.tagName ?? '';
  if (e.key === 'Escape' && !document.querySelector('.csel-pop, .csel-sheetroot, .gloss-pop')) { e.preventDefault(); void exitFs(); return; }
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') { overlay!.classList.toggle('fs-clean'); }
}
function onFsChange(): void { if (active && !document.fullscreenElement && overlay?.dataset.native === '1') void exitFs(true); }
const onResize = (): void => { if (active) { applyLayout(); } };

export const isFullscreen = (): boolean => active;
export async function toggleFullscreen(api: FsApi): Promise<void> { if (active) await exitFs(); else await enterFs(api); }

async function enterFs(api: FsApi): Promise<void> {
  if (active) return;
  apiRef = api; returnFocus = document.activeElement as HTMLElement | null;
  if (!hudEls) { hudEls = build(api); overlay = hudEls.ov; hudEls.sel.addEventListener('change', () => { api.mainSelect.value = hudEls!.sel.value; api.mainSelect.dispatchEvent(new Event('change', { bubbles: true })); }); api.mainSelect.addEventListener('change', () => { if (hudEls && hudEls.sel.value !== api.mainSelect.value) hudEls.sel.value = api.mainSelect.value; refreshHud(); }); window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize); window.addEventListener('fc-hud', refreshHud); document.addEventListener('fullscreenchange', onFsChange); onFreshTick((t) => { if (hudEls) hudEls.fresh.textContent = t.state === 'fresh' ? (t.updating ? 'Updating…' : t.countdown ? `Next update in ${t.countdown}` : '') : t.short; }); }
  const h = hudEls, ov = overlay!;
  const wrap = document.querySelector('.mapwrap')!, replay = $('replay');
  move(wrap, ov, h.hud);
  move(replay, h.replayHome); move($('maplegend'), h.legendHome); move($('maplayers'), h.layersHome); move($('dim-toggle'), h.btn3dHome);
  ov.hidden = false; ov.classList.remove('fs-clean'); ov.classList.add('fs-enter');
  document.documentElement.classList.add('fs-on');
  active = true;
  h.panels.forEach((p, i) => p.style.setProperty('--i', String(i)));
  applyLayout();
  try { if (ov.requestFullscreen) { await ov.requestFullscreen(); ov.dataset.native = '1'; } } catch { /* iOS Safari: stay in the overlay */ }
  requestAnimationFrame(() => { api.resize(); requestAnimationFrame(() => { api.resize(); api.resetView(); }); });
  setTimeout(() => ov.classList.remove('fs-enter'), 600);
  h.exit.focus({ preventScroll: true });
}
async function exitFs(fromBrowser = false): Promise<void> {
  if (!active || !overlay) return;
  active = false; sheetCleanup?.();
  if (!fromBrowser && document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* ignore */ } }
  overlay.dataset.native = '0'; overlay.hidden = true;
  // put moved nodes back (reverse order)
  const h = hudEls!;
  h.legendHome.append($('maplegend')); // keep nodes inside the overlay while restoring order
  while (undo.length) undo.pop()!();
  document.documentElement.classList.remove('fs-on');
  requestAnimationFrame(() => { apiRef?.resize(); requestAnimationFrame(() => { apiRef?.resize(); apiRef?.resetView(); }); });
  returnFocus?.focus?.(); document.getElementById('fs-btn')?.focus?.();
}
