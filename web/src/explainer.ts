import type { Theme } from './theme';

type P = [number, number];
/** Irregular fire outline: radial noise around a centre, in km. */
function outline(size: number): P[] {
  const pts: P[] = [], n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = size * (1 + 0.28 * Math.sin(3 * a + 0.7) + 0.16 * Math.sin(5 * a + 2.1) + 0.1 * Math.sin(9 * a));
    pts.push([Math.cos(a) * r * 1.35, Math.sin(a) * r * 0.85]);
  }
  return pts;
}
function inside(p: P, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const SPAN = 8; // km shown across the canvas
function draw(cv: HTMLCanvasElement, cell: number, color: string, poly: P[], th: Theme): number {
  const W = cv.width, k = W / SPAN, g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, W);
  const c = W / 2; let count = 0;
  const half = Math.ceil(SPAN / 2 / cell) + 1;
  for (let ix = -half; ix <= half; ix++) for (let iy = -half; iy <= half; iy++) {
    const cx = (ix + 0.5) * cell, cy = (iy + 0.5) * cell;
    const hit = inside([cx, cy], poly); if (hit) count++;
    const x = c + (cx - cell / 2) * k, y = c + (cy - cell / 2) * k;
    if (hit) { g.fillStyle = color + 'cc'; g.fillRect(x, y, cell * k, cell * k); }
    g.strokeStyle = th.ink3 + '55'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cell * k - 1, cell * k - 1);
  }
  g.beginPath(); poly.forEach(([px, py], i) => (i ? g.lineTo(c + px * k, c + py * k) : g.moveTo(c + px * k, c + py * k))); g.closePath();
  g.strokeStyle = th.ember; g.lineWidth = 2.5; g.stroke();
  return count;
}
export function mountExplainer(root: HTMLElement, getTheme: () => Theme): () => void {
  root.textContent = '';
  const h = document.createElement('h3'); h.textContent = 'Why harmonize?';
  const p = document.createElement('p'); p.textContent = 'A MODIS pixel covers about 1 km; a VIIRS pixel about 375 m. A pixel with fire inside it counts as one detection, so the finer sensor records the same fire many times over. Drag the slider to change the fire size.';
  const box = document.createElement('div'); box.className = 'px';
  const mk = (label: string) => { const f = document.createElement('figure'); const cv = document.createElement('canvas'); cv.width = 420; cv.height = 420; cv.setAttribute('role', 'img'); const cap = document.createElement('figcaption'); f.append(cv, cap); box.append(f); return { cv, cap, label }; };
  const a = mk('MODIS 1 km'), b = mk('VIIRS 375 m');
  const ctl = document.createElement('label'); ctl.className = 'px-ctl';
  const sp = document.createElement('span'); sp.textContent = 'Fire size';
  const rng = document.createElement('input'); rng.type = 'range'; rng.min = '0.3'; rng.max = '3'; rng.step = '0.05'; rng.value = '1.4';
  ctl.append(sp, rng);
  const cap = document.createElement('p'); cap.className = 'note'; cap.textContent = 'Same fire. Two sensors. Different counts. FireChronicle converts every sensor to one scale.';
  root.append(h, p, box, ctl, cap);
  const render = () => {
    const th = getTheme(), poly = outline(+rng.value);
    const na = draw(a.cv, 1, th.modis, poly, th), nb = draw(b.cv, 0.375, th.viirs, poly, th);
    a.cap.textContent = `${a.label}: ${na} detection${na === 1 ? '' : 's'}`;
    b.cap.textContent = `${b.label}: ${nb} detections${na > 0 ? ` (${(nb / na).toFixed(1)}x)` : ''}`;
    a.cv.setAttribute('aria-label', `MODIS grid, ${na} detections for this fire`); b.cv.setAttribute('aria-label', `VIIRS grid, ${nb} detections for the same fire`);
  };
  rng.addEventListener('input', render); render();
  return render;
}
