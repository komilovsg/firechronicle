/** Ember, the satellite face of the SI assistant: hand-built inline SVG, animated with CSS (see style.css). */
export type EmberState = 'idle' | 'thinking' | 'answered' | 'refused' | 'error';
export interface Ember { el: HTMLElement; setState(s: EmberState): void; state(): EmberState }
let uid = 0;
const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  kids.forEach((c) => e.append(c));
  return e;
}
/** size in px. staticPose = no animation at all (used for the tiny answer avatars). */
export function createEmber(size: number, staticPose = false): Ember {
  const id = `em${++uid}`;
  const stroke = { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const defs = svg('defs', {},
    svg('radialGradient', { id: `${id}-glow` }, svg('stop', { offset: '0', 'stop-color': 'var(--ember)', 'stop-opacity': '.9' }), svg('stop', { offset: '1', 'stop-color': 'var(--ember)', 'stop-opacity': '0' })),
    svg('linearGradient', { id: `${id}-beam`, x1: '0', y1: '0', x2: '0', y2: '1' }, svg('stop', { offset: '0', 'stop-color': 'var(--ember)', 'stop-opacity': '.55' }), svg('stop', { offset: '1', 'stop-color': 'var(--ember)', 'stop-opacity': '0' })));
  const grid = (x: number): SVGElement[] => [svg('path', { d: `M${x + 6} 25v14M${x + 12} 25v14`, ...stroke, 'stroke-width': 1 }), svg('path', { d: `M${x} 32h18`, ...stroke, 'stroke-width': 1 })];
  const wingL = svg('g', { class: 'em-wl' }, svg('rect', { x: 3, y: 25, width: 18, height: 14, rx: 3, ...stroke, fill: 'var(--surface)' }), ...grid(3));
  const wingR = svg('g', { class: 'em-wr' }, svg('rect', { x: 43, y: 25, width: 18, height: 14, rx: 3, ...stroke, fill: 'var(--surface)' }), ...grid(43));
  const orbit = svg('g', { class: 'em-orbit' }, svg('ellipse', { cx: 32, cy: 32, rx: 30, ry: 11, transform: 'rotate(-20 32 32)', ...stroke, 'stroke-width': 1.6, 'stroke-dasharray': '2 4', opacity: '.7' }));
  const arms = svg('path', { d: 'M21 32h5M38 32h5', ...stroke });
  const body = svg('rect', { x: 26, y: 20, width: 12, height: 24, rx: 6, ...stroke, fill: 'var(--surface)' });
  const eye = svg('g', { class: 'em-eye' }, svg('circle', { cx: 32, cy: 32, r: 9, fill: `url(#${id}-glow)` }), svg('circle', { cx: 32, cy: 32, r: 3.4, fill: 'var(--ember)' }));
  const beam = svg('path', { class: 'em-beam', d: 'M32 35 L19 62 H45 Z', fill: `url(#${id}-beam)` });
  const spark = svg('g', { class: 'em-spark' }, svg('circle', { cx: 56, cy: 15, r: 6, fill: 'var(--viirs)' }), svg('path', { d: 'M56 12v4.2', stroke: '#14100c', 'stroke-width': 1.8, 'stroke-linecap': 'round' }), svg('circle', { cx: 56, cy: 18.2, r: 1, fill: '#14100c' }));
  const all = svg('g', { class: 'em-all' }, orbit, beam, wingL, wingR, arms, body, eye);
  const root = svg('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' }, defs, all, spark);
  const host = document.createElement('span');
  host.className = 'ember' + (staticPose ? ' static' : ''); host.dataset.state = 'idle'; host.style.width = host.style.height = `${size}px`;
  host.append(root);
  let cur: EmberState = 'idle', timer = 0;
  const setState = (s: EmberState): void => {
    window.clearTimeout(timer); cur = s; host.dataset.state = s;
    if (staticPose) return;
    const back = s === 'answered' ? 700 : s === 'refused' ? 1000 : s === 'error' ? 3500 : 0;
    if (back) timer = window.setTimeout(() => { cur = 'idle'; host.dataset.state = 'idle'; }, back);
  };
  return { el: host, setState, state: () => cur };
}
