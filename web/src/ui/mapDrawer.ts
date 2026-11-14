/** Phones: the Map section is the map at full height plus a bottom drawer (peek / half / full) that holds everything else. */
import { el } from './dom';
import type { HudData } from '../fullscreen';

export type Snap = 'peek' | 'half' | 'full';
const PEEK = 112;
/** Pure: snap heights for a given available height. */
export function snapHeights(avail: number): Record<Snap, number> {
  return { peek: PEEK, half: Math.max(PEEK + 80, Math.min(Math.round(avail * 0.5), 440)), full: Math.max(PEEK + 160, avail - 8) };
}
const ORDER: Snap[] = ['peek', 'half', 'full'];
/** Pure: where a release lands. Flick (px/ms, negative = up) moves one snap; otherwise nearest height. */
export function pickSnap(h: number, hs: Record<Snap, number>, v: number, from: Snap): Snap {
  const i = ORDER.indexOf(from);
  if (v < -0.5) return ORDER[Math.min(2, i + 1)];
  if (v > 0.5) return ORDER[Math.max(0, i - 1)];
  return ORDER.reduce((b, s) => (Math.abs(hs[s] - h) < Math.abs(hs[b] - h) ? s : b), 'peek' as Snap);
}

export function initMapDrawer(hud: () => HudData | null): void {
  const mq = matchMedia('(max-width: 640px)');
  const col = document.querySelector<HTMLElement>('#v-map .mapcol')!, wrap = col.querySelector<HTMLElement>('.mapwrap')!;
  const id = (s: string): HTMLElement => document.getElementById(s)!;
  const root = document.documentElement;
  const dr = el('div', 'mdrawer'); dr.id = 'mdrawer'; dr.setAttribute('role', 'region'); dr.setAttribute('aria-label', 'Map controls');
  const grab = el('button', 'md-grab') as HTMLButtonElement; grab.type = 'button'; grab.setAttribute('aria-label', 'Resize the map panel'); grab.append(el('span'));
  const tl = el('div', 'md-time'); const body = el('div', 'md-body');
  const card = el('div', 'md-card'); const figs = [0, 1, 2].map(() => el('div', 'md-fig')); card.append(...figs);
  const hint = el('p', 'md-hint', 'Tip: choose a country or draw an area to start.'); hint.id = 'md-hint';
  const unusual = el('section', 'md-un'); unusual.append(el('h3', undefined, 'Where is it unusual now?'), el('ol', 'toplist')); unusual.querySelector('ol')!.id = 'drawer-top';
  const tools = el('div', 'md-tools');
  const half = el('div', 'md-half'); const full = el('div', 'md-full');
  half.append(card, hint); const legendBox = el('div', 'md-legend'); half.append(legendBox, unusual);
  full.append(tools); body.append(half, full); dr.append(grab, tl, body);
  let snap: Snap = 'peek', h = PEEK, placed = false, drag: { y: number; h: number; t: number; v: number; ly: number } | null = null;
  const avail = (): number => col.getBoundingClientRect().height;
  const apply = (hh: number, anim: boolean): void => { h = hh; dr.style.transition = anim ? '' : 'none'; dr.style.height = `${hh}px`; root.style.setProperty('--md-h', `${hh}px`); };
  const go = (s: Snap, anim = true): void => { snap = s; root.dataset.msnap = s; apply(snapHeights(avail())[s], anim); dr.dataset.snap = s; if (s !== 'full') body.scrollTop = 0; };
  const fillHud = (): void => {
    const d = hud(); if (!d) return;
    [['This month', d.month], ['Next high', d.next], ['Year to date', d.ytd]].forEach(([k, v], i) => { const f = figs[i], o = v as { big: string; sub: string }; f.textContent = ''; f.append(el('span', 'k', k as string), el('b', undefined, o.big), el('small', undefined, o.sub)); });
  };
  const place = (on: boolean): void => {
    if (on === placed) return; placed = on;
    const rp = id('replay'), tb = col.querySelector<HTMLElement>('.toolbar')!, lg = id('maplegend'), ly = id('maplayers');
    if (on) {
      tl.append(rp); legendBox.append(ly, lg); tools.append(tb); col.append(dr); go('peek', false); fillHud();
    } else {
      col.append(rp); col.insertBefore(tb, wrap); wrap.append(lg, ly); dr.remove(); root.style.removeProperty('--md-h'); delete root.dataset.msnap;
    }
  };
  grab.addEventListener('pointerdown', (e) => { grab.setPointerCapture(e.pointerId); drag = { y: e.clientY, h, t: performance.now(), v: 0, ly: e.clientY }; });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return; const hs = snapHeights(avail()), now = performance.now(), dt = Math.max(1, now - drag.t);
    drag.v = 0.7 * drag.v + 0.3 * ((e.clientY - drag.ly) / dt); drag.ly = e.clientY; drag.t = now;
    apply(Math.max(hs.peek, Math.min(hs.full, drag.h + (drag.y - e.clientY))), false);
  });
  const end = (): void => { if (!drag) return; const hs = snapHeights(avail()); const s = pickSnap(h, hs, drag.v, snap); drag = null; go(s); };
  grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
  grab.addEventListener('click', (e) => { if (e.detail === 0) go(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek'); });
  grab.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { go(snap === 'peek' ? 'half' : 'full'); e.preventDefault(); } else if (e.key === 'ArrowDown') { go(snap === 'full' ? 'half' : 'peek'); e.preventDefault(); } });
  new MutationObserver(() => { hint.hidden = id('maphint').hidden; }).observe(id('maphint'), { attributes: true, attributeFilter: ['hidden'] });
  hint.hidden = id('maphint').hidden;
  window.addEventListener('fc-hud', fillHud);
  window.addEventListener('resize', () => { if (placed) go(snap, false); });
  place(mq.matches); mq.addEventListener('change', () => place(mq.matches));
}
