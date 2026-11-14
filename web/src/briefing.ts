import type { Theme } from './theme';
import { SEQ } from './theme';
import { MONTH_ABBR, tFromYM } from './lib/time';

export interface Brief { name: string; arr: Float64Array; tLast: number; y0: number; y1: number; headline: string; sub: string; critical: string; th: Theme; vmax: number; unit: string; sample: boolean; si?: boolean }
export function drawBriefing(cv: HTMLCanvasElement, b: Brief): void {
  cv.width = 1200; cv.height = 630;
  const g = cv.getContext('2d')!, th = b.th;
  g.fillStyle = th.dark ? '#0b0f14' : '#f4f6f9'; g.fillRect(0, 0, 1200, 630);
  const ink = th.dark ? '#e9eef5' : '#121922', ink3 = th.dark ? '#8996a7' : '#5d6a7b', ember = th.dark ? '#ff7d33' : '#b94a07';
  g.fillStyle = ember; g.fillRect(0, 0, 10, 630);
  g.textBaseline = 'alphabetic';
  const f = (w: number, s: number, fam = "'Archivo', 'Arial Narrow', sans-serif") => { g.font = `${w} ${s}px ${fam}`; };
  f(500, 20, "'IBM Plex Mono', monospace"); g.fillStyle = ink3; g.fillText('FIRECHRONICLE · FIRE ACTIVITY BRIEFING' + (b.sample ? ' · SAMPLE DATA' : ''), 48, 60);
  f(800, 54); g.fillStyle = ink;
  let name = b.name; while (g.measureText(name).width > 1100 && name.length > 4) name = name.slice(0, -2);
  g.fillText(name === b.name ? name : name + '…', 48, 124);
  // mini calendar
  const years: number[] = []; for (let y = Math.max(b.y0, Math.floor(b.tLast / 12) + 2000 - 11); y <= Math.floor(b.tLast / 12) + 2000; y++) years.push(y);
  const x0 = 48, y0 = 168, cw = 38, ch = Math.min(26, 330 / years.length);
  f(500, 13, "'IBM Plex Mono', monospace"); g.fillStyle = ink3;
  MONTH_ABBR.forEach((m, i) => g.fillText(m, x0 + 48 + i * cw + 4, y0 - 6));
  years.forEach((y, yi) => {
    g.fillStyle = ink3; g.fillText(String(y), x0, y0 + yi * ch + ch * 0.7);
    for (let m = 1; m <= 12; m++) {
      const t = tFromYM(y, m), v = t <= b.tLast ? b.arr[t] : NaN;
      g.fillStyle = Number.isFinite(v) ? SEQ[Math.min(9, Math.floor((Math.max(0, v) / b.vmax) * 9.99))] : (th.dark ? '#1b222c' : '#dfe4ea');
      g.fillRect(x0 + 48 + (m - 1) * cw, y0 + yi * ch, cw - 2, ch - 2);
    }
  });
  // text column
  const tx = 640;
  f(500, 16, "'IBM Plex Mono', monospace"); g.fillStyle = ink3; g.fillText('THIS MONTH', tx, 190);
  f(800, 76); g.fillStyle = ember; g.fillText(b.headline, tx, 270);
  f(400, 24, "'IBM Plex Sans', sans-serif"); g.fillStyle = ink; wrap(g, b.sub, tx, 312, 520, 32);
  f(500, 16, "'IBM Plex Mono', monospace"); g.fillStyle = ink3; g.fillText('HIGH-ACTIVITY PERIOD AHEAD', tx, 430);
  f(700, 30); g.fillStyle = ink; g.fillText(b.critical, tx, 470);
  f(400, 14, "'IBM Plex Sans', sans-serif"); g.fillStyle = ink3; g.fillText(`Calendar: ${b.unit}, ${b.y0}–${Math.floor(b.tLast / 12) + 2000}. Climatology, not a forecast.`, 48, 560);
  f(400, b.si ? 12 : 14, "'IBM Plex Sans', sans-serif");
  g.fillText(`FireChronicle · Deep Space AI ${b.si ? '· SI-written · facts from NASA FIRMS data ' : ''}· NASA FIRMS · MODIS + VIIRS harmonized · generated ${new Date().toISOString().slice(0, 10)} · Not an official NASA product`, 48, 592);
}
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number): void {
  let line = '', yy = y;
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > w && line) { g.fillText(line, x, yy); line = word; yy += lh; } else line = t;
  }
  if (line) g.fillText(line, x, yy);
}
