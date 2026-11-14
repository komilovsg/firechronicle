interface Step { target: string; title: string; body: string; view?: string }
const STEPS: Step[] = [
  { target: '#top', view: 'overview', title: 'What this is', body: 'One fire history for Central Asia, from 2000 to today. Two satellite families, MODIS and VIIRS, count fires differently. FireChronicle puts them on one scale so any two years can be compared fairly.' },
  { target: '.tb-ctrl', view: 'overview', title: 'Pick an area', body: 'Choose a country here, or draw a polygon or a point and radius in the Map section. Every number and chart follows your area and the years you select.' },
  { target: '#d-kpis', view: 'overview', title: 'Read the dashboard', body: 'The Overview shows the last 7 days, this month, the year so far and the season, each against what is normal for the same period.' },
  { target: '#cal-stage', view: 'calendar', title: 'Read the calendar', body: 'Each row is a year and each column a month. Brighter means more fire detections. Hatched cells are provisional recent data. Click a cell to see that month on the map.' },
  { target: '[aria-labelledby="h-month"]', view: 'calendar', title: 'Is this month normal?', body: 'The current month is compared with the same month in earlier years: how far above or below the median it is, and where it ranks.' },
  { target: '#outlook-wrap', view: 'outlook', title: 'High-activity months ahead', body: 'For each of the next 12 months, how often that month was unusually busy in recent years. It is climatology, not a forecast.' },
  { target: '#before-after', view: 'data', title: 'Why harmonize?', body: 'Joining the two sensors without calibration flips the sign of the change. This panel puts the naive result next to the calibrated one.' },
  { target: '[aria-labelledby="h-exp"]', view: 'data', title: 'Export', body: 'Download hotspots as CSV, the monthly series, or a briefing card image to share.' },
  { target: '#ask-btn', title: 'Meet Ember', body: 'Ask questions, or say "show Kazakhstan, August 2021" and the map follows.' },
];
let intro = '';
/** Adds the live MODIS-retirement sentence (dates from meta) to the first tour step. */
export function setTourIntro(t: string): void { intro = t; }
const KEY = 'fc-tour-done';
export const tourSeen = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = (): void => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };

let active = false;
export function startTour(): void {
  if (active) return;
  active = true;
  const returnTo = document.activeElement as HTMLElement | null;
  const root = document.createElement('div'); root.className = 'tour';
  const ring = document.createElement('div'); ring.className = 'tour-ring';
  const card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tour-title');
  const count = document.createElement('div'); count.className = 'tour-count';
  const title = document.createElement('h2'); title.id = 'tour-title';
  const body = document.createElement('p');
  const btns = document.createElement('div'); btns.className = 'tour-btns';
  const mk = (t: string, cls: string): HTMLButtonElement => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = t; return b; };
  const skip = mk('Skip tour', 'ghost'), back = mk('Back', ''), next = mk('Next', 'primary');
  btns.append(skip, back, next); card.append(count, title, body, btns); root.append(ring, card); document.body.append(root);
  let i = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const place = (): void => {
    const el = document.querySelector<HTMLElement>(STEPS[i].target); if (!el) return;
    const mobile = innerWidth < 700, vw = innerWidth, vh = innerHeight, cw = Math.min(340, vw - 16);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight;
    let r = el.getBoundingClientRect();
    // card position first, then clip the ring so it never goes under the card
    let cx: number, cy: number;
    if (mobile) { cx = 8; cy = vh - ch - 8; card.classList.add('dock'); card.style.width = `${vw - 16}px`; }
    else {
      card.classList.remove('dock');
      const gap = 14, fit = (x: number, y: number) => x >= 8 && y >= 8 && x + cw <= vw - 8 && y + ch <= vh - 8;
      const cands: [number, number][] = [[r.right + gap, Math.max(8, r.top)], [r.left - gap - cw, Math.max(8, r.top)], [Math.max(8, r.left), r.bottom + gap], [Math.max(8, r.left), r.top - gap - ch]];
      const hit = cands.find(([x, y]) => fit(x, Math.min(y, vh - ch - 8)));
      if (hit) { cx = hit[0]; cy = Math.min(hit[1], vh - ch - 8); } else { cx = vw - cw - 8; cy = vh - ch - 8; }
    }
    card.style.left = `${cx}px`; card.style.top = `${cy}px`;
    const cardRect = { l: cx, t: cy, r: cx + cw, b: cy + ch };
    let top = Math.max(r.top, 4), bottom = Math.min(r.bottom, vh - 4);
    const overlapsX = r.left < cardRect.r && r.right > cardRect.l;
    if (overlapsX && bottom > cardRect.t - 8 && top < cardRect.b) bottom = Math.max(top + 24, cardRect.t - 8);
    r = new DOMRect(r.left, top, r.width, Math.max(0, bottom - top));
    ring.style.cssText = `left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`;
  };
  const show = (n: number): void => {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const st = STEPS[i];
    if (st.view) window.dispatchEvent(new CustomEvent('fc-view', { detail: { view: st.view, push: false } }));
    const el = document.querySelector<HTMLElement>(st.target);
    count.textContent = `Step ${i + 1} of ${STEPS.length}`; title.textContent = st.title; body.textContent = i === 0 && intro ? `${st.body} ${intro}` : st.body;
    back.disabled = i === 0; next.textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
    if (el) { el.style.scrollMarginTop = innerWidth < 700 ? '70px' : '90px'; el.scrollIntoView({ block: 'start', behavior: 'auto' }); }
    place(); (i === STEPS.length - 1 ? next : next).focus({ preventScroll: true });
    requestAnimationFrame(place);
  };
  const close = (): void => {
    active = false; markSeen(); root.remove(); window.dispatchEvent(new Event('fc-tour-end')); removeEventListener('keydown', onKey, true); removeEventListener('scroll', place); removeEventListener('resize', place);
    returnTo?.focus?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (i === STEPS.length - 1) close(); else show(i + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); return; }
    if (e.key === 'Tab') {
      const f = [skip, back, next].filter((b) => !b.disabled), first = f[0], last = f[f.length - 1];
      if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  skip.addEventListener('click', close); back.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => { if (i === STEPS.length - 1) close(); else show(i + 1); });
  addEventListener('keydown', onKey, true); addEventListener('scroll', place, { passive: true }); addEventListener('resize', place);
  void reduce;
  show(0);
}
