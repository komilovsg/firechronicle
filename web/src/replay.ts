import { tLabel, MONTH_ABBR, yearOf, monthOf } from './lib/time';
import type { Theme } from './theme';

export class Replay {
  t = 0; playing = false; speed = 1;
  private tFirst = 0; private tLast = 0; private arr: Float64Array = new Float64Array(0);
  private lastSpark = 0;
  private acc = 0; private last = 0; private raf = 0;
  private clock!: HTMLElement; private range!: HTMLInputElement; private spark!: HTMLCanvasElement; private playBtn!: HTMLButtonElement;
  private reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  th: Theme | null = null;
  onFrame: (t: number) => void = () => {};
  onStop: () => void = () => {};

  constructor(root: HTMLElement) {
    root.textContent = '';
    const top = document.createElement('div'); top.className = 'rp-top';
    this.clock = document.createElement('div'); this.clock.className = 'rp-clock'; this.clock.setAttribute('aria-live', 'off');
    this.playBtn = this.btn('Play', 'Play time-lapse', () => this.toggle());
    const prev = this.btn('‹', 'Previous month', () => this.step(-1)), next = this.btn('›', 'Next month', () => this.step(1));
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Replay speed');
    [1, 2, 4].forEach((s) => { const b = this.btn(`${s}x`, `Speed ${s}x`, () => { this.speed = s; [...seg.children].forEach((c, i) => c.setAttribute('aria-pressed', String([1, 2, 4][i] === s))); }); b.setAttribute('aria-pressed', String(s === 1)); seg.append(b); });
    top.append(this.clock, this.playBtn, prev, next, seg);
    const scrub = document.createElement('div'); scrub.className = 'rp-scrub';
    this.range = document.createElement('input'); this.range.type = 'range'; this.range.setAttribute('aria-label', 'Month scrubber');
    this.range.addEventListener('input', () => { this.pause(); this.setT(+this.range.value, true); });
    this.spark = document.createElement('canvas'); this.spark.className = 'rp-spark'; this.spark.setAttribute('aria-hidden', 'true');
    scrub.append(this.spark, this.range);
    root.append(top, scrub);
    if (this.reduce) { this.playBtn.disabled = true; this.playBtn.title = 'Autoplay is off because reduced motion is requested. Use the step buttons or the scrubber.'; }
    new ResizeObserver(() => this.drawSpark()).observe(this.spark);
  }
  private btn(text: string, label: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = text; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b;
  }
  setData(arr: Float64Array, tFirst: number, tLast: number, th: Theme): void {
    this.arr = arr; this.tFirst = tFirst; this.tLast = tLast; this.th = th;
    this.range.min = String(tFirst); this.range.max = String(tLast); this.range.step = '1';
    if (this.t < tFirst || this.t > tLast) this.t = tFirst;
    this.setT(this.t, false);
  }
  setT(t: number, emit: boolean): void {
    this.t = Math.max(this.tFirst, Math.min(this.tLast, Math.round(t)));
    this.range.value = String(this.t);
    this.range.setAttribute('aria-valuetext', tLabel(this.t));
    this.clock.textContent = '';
    this.clock.append(`${MONTH_ABBR[monthOf(this.t) - 1]} ${yearOf(this.t)}`);
    const now = performance.now();
    if (!this.playing || now - this.lastSpark > 100) { this.lastSpark = now; this.drawSpark(); } // the cursor redraws at most 10 Hz while playing
    if (emit) this.onFrame(this.t);
  }
  step(d: number): void { this.pause(); this.setT(this.t + d, true); }
  toggle(): void { this.playing ? this.pause() : this.play(); }
  play(): void {
    if (this.reduce) return;
    if (this.t >= this.tLast) this.setT(this.tFirst, true);
    this.playing = true; this.playBtn.textContent = 'Pause'; this.playBtn.setAttribute('aria-label', 'Pause time-lapse');
    this.last = performance.now(); this.acc = 0;
    const tick = (now: number) => {
      if (!this.playing) return;
      this.acc += ((now - this.last) / 1000) * 8 * this.speed; this.last = now;
      const whole = Math.floor(this.acc);
      if (whole >= 1) { this.acc -= whole; this.setT(this.t + whole, true); if (this.t >= this.tLast) { this.pause(); return; } }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  pause(): void {
    if (!this.playing) return;
    this.playing = false; cancelAnimationFrame(this.raf); this.playBtn.textContent = 'Play'; this.playBtn.setAttribute('aria-label', 'Play time-lapse'); this.onStop();
  }
  drawSpark(): void {
    const c = this.spark, dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h || !this.th) return;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const n = this.tLast - this.tFirst; if (n <= 0) return;
    let max = 0; for (let t = this.tFirst; t <= this.tLast; t++) if (this.arr[t] > max) max = this.arr[t];
    if (max <= 0) return;
    const X = (t: number) => ((t - this.tFirst) / n) * w, Y = (v: number) => h - 3 - (v / max) * (h - 8);
    g.beginPath(); g.moveTo(0, h);
    for (let t = this.tFirst; t <= this.tLast; t++) g.lineTo(X(t), Y(this.arr[t] || 0));
    g.lineTo(w, h); g.closePath(); g.fillStyle = this.th.ink3 + '40'; g.fill();
    g.beginPath(); for (let t = this.tFirst; t <= this.tLast; t++) { const x = X(t), y = Y(this.arr[t] || 0); t === this.tFirst ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.strokeStyle = this.th.ink2; g.lineWidth = 1.2; g.stroke();
    const x = X(this.t); g.fillStyle = this.th.ember; g.fillRect(x - 1, 0, 2, h);
    g.beginPath(); g.arc(x, Y(this.arr[this.t] || 0), 3.5, 0, 7); g.fill();
  }
}
