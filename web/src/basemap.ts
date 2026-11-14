import type { BmId } from './lib/gibs';
import { openInfoSheet } from './ui/sheet';
import { mountPortal } from './ui/portal';

export interface BmApi { current(): BmId; select(id: BmId): void; imagery(): { date: string; label: string } | null; step(days: number): void; canStep(days: number): boolean }
const CARDS: { id: BmId; label: string; note: string; bg: string }[] = [
  { id: 'mono', label: 'Monochrome', note: 'Follows the theme', bg: 'linear-gradient(135deg,#e9ecef 0 45%,#c8cdd3 45% 60%,#f4f6f8 60%)' },
  { id: 'color', label: 'Colour map', note: 'OpenStreetMap detail', bg: 'linear-gradient(135deg,#cfe8c5 0 35%,#a9d3f0 35% 55%,#f2e8cf 55% 80%,#e0c9a6 80%)' },
  { id: 'sat', label: 'Satellite', note: 'NASA imagery of the day', bg: 'radial-gradient(circle at 30% 35%,#d9e3ea 0 14%,transparent 15%),linear-gradient(135deg,#2f4a2a,#5b6b3a 45%,#8a7a55 70%,#243c5a)' },
  { id: 'relief', label: 'Relief', note: 'Shaded terrain', bg: 'linear-gradient(135deg,#355f3a,#86a15b 30%,#c9b27a 55%,#8e6b4a 75%,#f2efe9)' },
  { id: 'night', label: 'Night lights', note: 'VIIRS Black Marble', bg: 'radial-gradient(circle at 25% 60%,#ffd27a 0 3%,transparent 4%),radial-gradient(circle at 60% 40%,#ffe9a8 0 2.5%,transparent 3.5%),radial-gradient(circle at 75% 70%,#ffc15a 0 3%,transparent 4%),#05070b' },
];
let close: (() => void) | null = null;

function content(api: BmApi): { root: HTMLElement; refresh: () => void } {
  const root = document.createElement('div'); root.className = 'bm-panel';
  const grid = document.createElement('div'); grid.className = 'bm-grid'; grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', 'Map style');
  const btns = new Map<BmId, HTMLButtonElement>();
  for (const c of CARDS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bm-card'; b.setAttribute('role', 'radio');
    const th = document.createElement('span'); th.className = 'bm-thumb'; th.style.background = c.bg; th.setAttribute('aria-hidden', 'true');
    const l = document.createElement('span'); l.className = 'bm-label'; l.textContent = c.label;
    const n = document.createElement('span'); n.className = 'bm-note'; n.textContent = c.note;
    b.append(th, l, n); b.addEventListener('click', () => { api.select(c.id); refresh(); });
    btns.set(c.id, b); grid.append(b);
  }
  const sat = document.createElement('div'); sat.className = 'bm-sat';
  const prev = document.createElement('button'); prev.type = 'button'; prev.className = 'btn'; prev.textContent = '‹'; prev.setAttribute('aria-label', 'Previous day');
  const nextB = document.createElement('button'); nextB.type = 'button'; nextB.className = 'btn'; nextB.textContent = '›'; nextB.setAttribute('aria-label', 'Next day');
  const info = document.createElement('span'); info.className = 'bm-info'; info.setAttribute('aria-live', 'polite');
  const hint = document.createElement('p'); hint.className = 'bm-hint'; hint.textContent = 'Step by day to find a cloud-free view. Imagery follows the selected month or replay frame.';
  prev.addEventListener('click', () => { api.step(-1); refresh(); }); nextB.addEventListener('click', () => { api.step(1); refresh(); });
  const row = document.createElement('div'); row.className = 'bm-row'; row.append(prev, info, nextB); sat.append(row, hint);
  root.append(grid, sat);
  function refresh(): void {
    const cur = api.current();
    btns.forEach((b, id) => b.setAttribute('aria-checked', String(id === cur)));
    const im = api.imagery(); sat.hidden = cur !== 'sat';
    if (im) { info.textContent = `Imagery: ${im.date} (${im.label})`; prev.disabled = !api.canStep(-1); nextB.disabled = !api.canStep(1); }
  }
  refresh();
  return { root, refresh };
}
/** Keep an open panel's date text in sync when the imagery date changes elsewhere. */
let live: (() => void) | null = null;
export const refreshStylePanel = (): void => { live?.(); };

export function openStylePanel(anchor: HTMLElement, api: BmApi): void {
  if (close) { const c = close; close = null; c(); return; }
  const { root, refresh } = content(api); live = refresh;
  if (matchMedia('(max-width: 640px)').matches) {
    const c = openInfoSheet('Map style', root, anchor);
    close = () => { c(); live = null; close = null; };
    return;
  }
  const pop = document.createElement('div'); pop.className = 'bm-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Map style'); pop.append(root); mountPortal(pop);
  const place = (): void => { const r = anchor.getBoundingClientRect(), w = Math.min(420, innerWidth - 16); pop.style.width = `${w}px`; pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left - w - 8))}px`; pop.style.top = `${Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.top))}px`; };
  place();
  const onDoc = (e: Event): void => { if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeIt(true); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeIt(true); } };
  const closeIt = (focus: boolean): void => { document.removeEventListener('pointerdown', onDoc, true); window.removeEventListener('keydown', onKey, true); pop.remove(); live = null; close = null; if (focus) anchor.focus(); };
  document.addEventListener('pointerdown', onDoc, true); window.addEventListener('keydown', onKey, true);
  close = () => closeIt(false);
  (root.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
}
