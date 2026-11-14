import { el } from './ui/dom';

const NS = 'http://www.w3.org/2000/svg';
const KEY = 'fc-hero-seen';
const sv = (t: string, a: Record<string, string>): SVGElement => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

export interface HeroData {
  sentence: string; naiveText: string; harmText: string; r2: string;
  years: number[]; naive: number[]; harm: number[]; switchYear: number;
  footer: string; yrs: number;
}
export interface HeroHandlers { explore: () => void; watch: () => void }

/** Pure: shared-scale polyline points for two annual series in a w x h box. */
export function linePoints(vals: number[], max: number, w: number, h: number, pad = 6): string {
  const n = vals.length; if (n < 2 || !(max > 0)) return '';
  return vals.map((v, i) => `${(pad + (i / (n - 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - (Math.max(0, v) / max) * (h - 2 * pad)).toFixed(1)}`).join(' ');
}
export const heroSeen = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = (): void => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };
export const heroForced = (): boolean => new URLSearchParams(location.search).get('hero') === '1';

/** Builds the hero and its collapsed strip inside `root`; returns reopen() and a promise that resolves when the first-visit hero is done. */
export function mountHero(root: HTMLElement, d: HeroData, h: HeroHandlers): { reopen: () => void; done: Promise<void> } {
  root.textContent = '';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const full = el('section', 'hero2'); full.setAttribute('aria-labelledby', 'hero-h');
  const strip = el('button', 'hero-strip') as HTMLButtonElement; strip.type = 'button'; strip.setAttribute('aria-expanded', 'false');
  strip.append(el('b', undefined, 'FireChronicle'), el('span', 'hs-t', ' — one fire history, before and after MODIS'), el('span', 'hs-a', 'About ↓'));
  const copy = el('div', 'h2-copy');
  const title = el('h2', 'h2-title', 'One fire history, before and after MODIS'); title.id = 'hero-h';
  const lede = el('p', 'h2-lede', d.sentence);
  const btns = el('div', 'h2-btns');
  const go = el('button', 'btn primary big', 'Explore the dashboard ↓') as HTMLButtonElement; go.type = 'button';
  const watch = el('button', 'btn big', 'Watch 26 years →') as HTMLButtonElement; watch.type = 'button';
  btns.append(go, watch);
  const foot = el('p', 'h2-foot', d.footer);
  copy.append(title, lede, btns, foot);
  // animated proof
  const proof = el('div', 'h2-proof'); proof.setAttribute('role', 'img');
  proof.setAttribute('aria-label', `Annual fire detections for Central Asia. Naive stitching shows ${d.naiveText}, a false rise at the sensor switch. Harmonized shows ${d.harmText}, a real decline. Independent check R squared ${d.r2}.`);
  const W = 420, H = 170, max = Math.max(...d.naive, ...d.harm, 1);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'h2-svg', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  const sx = 6 + ((d.switchYear - d.years[0]) / Math.max(1, d.years.length - 1)) * (W - 12);
  svg.append(sv('line', { x1: sx.toFixed(1), x2: sx.toFixed(1), y1: '4', y2: String(H - 4), class: 'h2-sw' }));
  const mk = (cls: string, vals: number[]): SVGElement => sv('polyline', { points: linePoints(vals, max, W, H), class: cls, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: '1' });
  const pn = mk('h2-naive', d.naive), ph = mk('h2-harm', d.harm);
  svg.append(pn, ph);
  const labels = el('div', 'h2-labels');
  const ln = el('div', 'h2-lab naive'); ln.append(el('span', 'k', 'Naive stitching'), el('b', undefined, d.naiveText), el('span', 'tag bad', '✗ false rise'));
  const lh = el('div', 'h2-lab harm'); lh.append(el('span', 'k', 'Harmonized'), el('b', undefined, d.harmText), el('span', 'tag ok', '✓ real decline'));
  const lc = el('div', 'h2-lab chk'); lc.append(el('span', 'k', 'Independent check'), el('b', undefined, `R² ${d.r2}`));
  labels.append(ln, lh, lc);
  proof.append(svg, labels);
  full.append(copy, proof);
  root.append(full, strip);

  const show = (open: boolean): void => { full.hidden = !open; strip.hidden = open; strip.setAttribute('aria-expanded', String(open)); };
  const play = (): void => {
    for (const p of [pn, ph]) { p.style.transition = 'none'; p.style.strokeDasharray = '1'; p.style.strokeDashoffset = reduce ? '0' : '1'; }
    for (const l of [ln, lh, lc]) l.classList.toggle('on', reduce);
    if (reduce) return;
    void svg.getBoundingClientRect();
    requestAnimationFrame(() => {
      pn.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.23,1,.32,1)'; pn.style.strokeDashoffset = '0';
      setTimeout(() => ln.classList.add('on'), 1000);
      setTimeout(() => { ph.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.23,1,.32,1)'; ph.style.strokeDashoffset = '0'; }, 1300);
      setTimeout(() => lh.classList.add('on'), 2300);
      setTimeout(() => lc.classList.add('on'), 2600);
    });
  };
  const first = (!heroSeen() || heroForced());
  let finish: () => void = () => undefined;
  const done = new Promise<void>((r) => { finish = r; });
  show(first); if (first) { play(); markSeen(); } else finish();
  const dismiss = (): void => { finish(); };
  go.addEventListener('click', () => { dismiss(); h.explore(); });
  watch.addEventListener('click', () => { dismiss(); h.watch(); });
  strip.addEventListener('click', () => { show(true); play(); full.scrollIntoView({ block: 'nearest' }); title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); });
  if (first) new IntersectionObserver((e, o) => { if (!e[0].isIntersecting && e[0].boundingClientRect.bottom < 0) { dismiss(); o.disconnect(); } }).observe(full);
  return { reopen: () => { show(true); play(); full.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }, done };
}
