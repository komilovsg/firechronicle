import { snapDecision } from './selectLogic';
import { lockableBody, mountPortal } from './portal';
const reduce = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Simple bottom sheet for short content (phones). Drag the header down (or flick) to close; Esc and backdrop also close. */
export function openInfoSheet(title: string, body: HTMLElement, returnFocus?: HTMLElement | null, opts: { tall?: boolean; bare?: boolean } = {}): () => void {
  const root = document.createElement('div'); root.className = 'csel-sheetroot';
  const backdrop = document.createElement('div'); backdrop.className = 'csel-backdrop';
  const sheet = document.createElement('div'); sheet.className = 'csel-sheet info' + (opts.tall ? ' tall' : '') + (opts.bare ? ' bare' : ''); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', title);
  const head = document.createElement('div'); head.className = 'csel-head';
  const grab = document.createElement('div'); grab.className = 'csel-grab'; grab.setAttribute('aria-hidden', 'true');
  const row = document.createElement('div'); row.className = 'csel-title';
  const t = document.createElement('span'); t.textContent = title;
  const x = document.createElement('button'); x.type = 'button'; x.className = 'csel-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
  row.append(t, x); head.append(grab, row);
  const content = document.createElement('div'); content.className = 'sheet-body'; content.append(body);
  sheet.append(head, content); root.append(backdrop, sheet); mountPortal(root);
  const lock = lockableBody(), scrollY = window.scrollY, b = document.body.style, prev = { p: b.position, t: b.top, w: b.width };
  if (lock) { b.position = 'fixed'; b.top = `-${scrollY}px`; b.width = '100%'; }
  const H = sheet.offsetHeight; let y = H, closed = false;
  const apply = (ty: number, anim: boolean): void => { y = ty; sheet.style.transition = anim && !reduce() ? 'transform 200ms cubic-bezier(.23,1,.32,1)' : 'none'; sheet.style.transform = `translateY(${ty}px)`; backdrop.style.opacity = String(Math.max(0, 1 - ty / H)); };
  sheet.style.transform = `translateY(${H}px)`; requestAnimationFrame(() => requestAnimationFrame(() => apply(0, true)));
  const close = (): void => {
    if (closed) return; closed = true;
    apply(H, true); if (lock) { b.position = prev.p; b.top = prev.t; b.width = prev.w; scrollTo(0, scrollY); }
    setTimeout(() => root.remove(), reduce() ? 0 : 210); removeEventListener('keydown', onKey, true); returnFocus?.focus();
  };
  let drag: { sy: number; st: number; ly: number; lt: number; v: number } | null = null;
  const pm = (e: PointerEvent): void => { if (!drag) return; const now = performance.now(), dt = Math.max(1, now - drag.lt); drag.v = 0.8 * drag.v + 0.2 * ((e.clientY - drag.ly) / dt); drag.ly = e.clientY; drag.lt = now; apply(Math.max(0, drag.st + e.clientY - drag.sy), false); };
  const pu = (): void => { removeEventListener('pointermove', pm); removeEventListener('pointerup', pu); removeEventListener('pointercancel', pu); if (!drag) return; const v = drag.v; drag = null; if (snapDecision({ y, defaultY: 0, closedY: H, velocity: v }) === 'close') close(); else apply(0, true); };
  head.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('.csel-x')) return; e.preventDefault(); drag = { sy: e.clientY, st: y, ly: e.clientY, lt: performance.now(), v: 0 }; addEventListener('pointermove', pm); addEventListener('pointerup', pu); addEventListener('pointercancel', pu); });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { const f = [...sheet.querySelectorAll<HTMLElement>('a[href], button')]; const i = f.indexOf(document.activeElement as HTMLElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus(); }
  };
  addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', close); x.addEventListener('click', close);
  x.focus({ preventScroll: true });
  return close;
}
