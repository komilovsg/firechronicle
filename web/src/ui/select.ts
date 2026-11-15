import { guardTouch } from './scrollGuard';
import { lockableBody, mountPortal } from './portal';
import { edgeIndex, nextIndex, snapDecision, typeaheadIndex, type Snap } from './selectLogic';

/**
 * Progressive enhancement: the native <select> stays in the DOM as the source of truth (visually hidden);
 * a button trigger plus a popover listbox (desktop) or bottom sheet (<= 640 px) replaces its UI.
 */
const MOBILE = '(max-width: 640px)';
const reduce = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 0;
interface Inst { sel: HTMLSelectElement; btn: HTMLButtonElement; sync: () => void; close: (focus?: boolean) => void }
const insts = new WeakMap<HTMLSelectElement, Inst>();
let openInst: Inst | null = null;

const labelOf = (sel: HTMLSelectElement): string => {
  const lab = sel.closest('label');
  const span = lab?.querySelector('span');
  return (span?.textContent ?? sel.getAttribute('aria-label') ?? sel.id ?? 'Options').trim();
};

export function refreshSelect(sel: HTMLSelectElement): void { insts.get(sel)?.sync(); }

export function enhanceSelect(sel: HTMLSelectElement): void {
  if (insts.has(sel)) { refreshSelect(sel); return; }
  const id = `csel-${++uid}`;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'csel-btn'; btn.id = `${id}-btn`;
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', `${id}-list`);
  const txt = document.createElement('span'); txt.className = 'csel-txt'; btn.append(txt);
  sel.before(btn);
  sel.classList.add('sel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  // forward programmatic focus() to the visible trigger
  sel.focus = () => btn.focus();
  // programmatic `sel.value = x` must refresh the trigger
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
  Object.defineProperty(sel, 'value', { configurable: true, get() { return desc.get!.call(sel); }, set(v: string) { desc.set!.call(sel, v); sync(); } });

  const lab = sel.closest('label'), labId = `${id}-lab`;
  const span = lab?.querySelector('span'); if (span) span.id = labId;
  btn.setAttribute('aria-labelledby', span ? `${labId} ${btn.id}` : btn.id);

  const opts = (): HTMLOptionElement[] => [...sel.options];
  function sync(): void {
    const o = sel.selectedOptions[0];
    txt.textContent = '';
    const pre = sel.dataset.prefix;
    if (pre) { const ps = document.createElement('span'); ps.className = 'pre'; ps.textContent = pre; txt.append(ps, ' '); }
    txt.append(o?.textContent ?? '');
    if (!sel.closest('label')) btn.setAttribute('aria-label', `${labelOf(sel)}: ${o?.textContent ?? ''}`);
    btn.disabled = sel.disabled;
    const longest = Math.max(0, ...opts().map((x) => (x.textContent ?? '').length));
    btn.style.minWidth = `${Math.min(longest, 30) + 5 + (pre ? pre.length + 1 : 0)}ch`;
  }
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sel.addEventListener('change', sync);

  let ui: { root: HTMLElement; list: HTMLElement; active: number; cleanup: () => void } | null = null;
  let buf = '', bufT = 0;
  const inst: Inst = { sel, btn, sync, close };
  insts.set(sel, inst);
  sync();

  function choose(i: number): void {
    const o = opts()[i]; if (!o || o.disabled) return;
    const changed = sel.selectedIndex !== i;
    desc.set!.call(sel, o.value); sync(); close(true);
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function setActive(i: number, scroll = true): void {
    if (!ui) return;
    const items = [...ui.list.children] as HTMLElement[];
    items.forEach((it, k) => it.classList.toggle('active', k === i));
    ui.active = i;
    const el = items[i]; if (!el) return;
    ui.list.setAttribute('aria-activedescendant', el.id); btn.setAttribute('aria-activedescendant', el.id);
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }
  function onKeys(e: KeyboardEvent): void {
    if (!ui) return;
    if (sel.dataset.quick === 'years' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = ({ a: 'all', t: '10', f: '5' } as Record<string, string>)[e.key.toLowerCase()];
      if (k) { e.preventDefault(); document.dispatchEvent(new CustomEvent('fc-years', { detail: { kind: k } })); close(true); return; }
    }
    const dis = opts().map((o) => o.disabled), labels = opts().map((o) => o.textContent ?? '');
    let a = ui.active, handled = true;
    if (e.key === 'ArrowDown') a = nextIndex(dis, a, 1);
    else if (e.key === 'ArrowUp') a = nextIndex(dis, a, -1);
    else if (e.key === 'Home') a = edgeIndex(dis, 'first');
    else if (e.key === 'End') a = edgeIndex(dis, 'last');
    else if (e.key === 'PageDown') a = Math.min(dis.length - 1, a + 8);
    else if (e.key === 'PageUp') a = Math.max(0, a - 8);
    else if (e.key === 'Enter' || (e.key === ' ' && !buf)) { e.preventDefault(); choose(a); return; }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    else if (e.key === 'Tab') { close(false); return; }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now(); buf = now - bufT > 700 ? e.key : buf + e.key; bufT = now;
      const m = typeaheadIndex(labels, dis, a, buf); if (m >= 0) a = m; handled = true;
    } else handled = false;
    if (handled) { e.preventDefault(); setActive(a); }
  }
  btn.addEventListener('keydown', (e) => {
    if (ui) { onKeys(e); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const dis = opts().map((o) => o.disabled), labels = opts().map((o) => o.textContent ?? '');
      const now = performance.now(); buf = now - bufT > 700 ? e.key : buf + e.key; bufT = now;
      const m = typeaheadIndex(labels, dis, sel.selectedIndex, buf);
      if (m >= 0) { e.preventDefault(); open(); setActive(m); }
    }
  });
  btn.addEventListener('click', () => (ui ? close(true) : open()));

  function buildList(list: HTMLElement): void {
    list.textContent = '';
    if (sel.dataset.quick === 'years') {
      const q = document.createElement('div'); q.className = 'csel-quick';
      for (const [k, t] of [['all', 'All years (A)'], ['10', 'Last 10 years (T)'], ['5', 'Last 5 years (F)']] as const) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('fc-years', { detail: { kind: k } })); close(true); });
        q.append(b);
      }
      list.append(q);
    }
    opts().forEach((o, i) => {
      const it = document.createElement('div');
      it.id = `${id}-o${i}`; it.className = 'csel-opt'; it.setAttribute('role', 'option');
      it.setAttribute('aria-selected', String(i === sel.selectedIndex));
      if (o.disabled) it.setAttribute('aria-disabled', 'true');
      const t = document.createElement('span'); t.textContent = o.textContent; it.append(t);
      it.addEventListener('click', () => choose(i));
      it.addEventListener('pointermove', () => { if (ui && ui.active !== i && !o.disabled) setActive(i, false); });
      list.append(it);
    });
  }
  function open(): void {
    if (openInst && openInst !== inst) openInst.close(false);
    if (ui || sel.disabled) return;
    openInst = inst;
    const mobile = matchMedia(MOBILE).matches;
    const list = document.createElement('div'); list.className = 'csel-list'; list.id = `${id}-list`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', labelOf(sel));
    buildList(list);
    btn.setAttribute('aria-expanded', 'true');
    ui = mobile ? openSheet(list) : openPopover(list);
    setActive(Math.max(0, sel.selectedIndex));
    buf = '';
  }
  function close(focus = false): void {
    if (!ui) return;
    const u = ui; ui = null; if (openInst === inst) openInst = null;
    btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-activedescendant');
    u.cleanup();
    if (focus) btn.focus();
  }

  /* ---------- desktop popover ---------- */
  function openPopover(list: HTMLElement) {
    const root = document.createElement('div'); root.className = 'csel-pop'; root.append(list); mountPortal(root);
    const place = (): void => {
      const r = btn.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const w = Math.max(r.width, 160); root.style.minWidth = `${w}px`;
      const natural = Math.min(320, list.scrollHeight + 8);
      const below = vh - r.bottom - 12, above = r.top - 12;
      const up = below < Math.min(natural, 200) && above > below;
      const maxH = Math.max(120, Math.min(320, up ? above : below));
      root.style.maxHeight = `${maxH}px`;
      const h = Math.min(natural, maxH);
      root.style.top = `${up ? r.top - h - 4 : r.bottom + 4}px`;
      root.style.left = `${Math.max(8, Math.min(vw - Math.max(w, root.offsetWidth) - 8, r.left))}px`;
      root.classList.toggle('up', up);
    };
    place(); requestAnimationFrame(() => root.classList.add('open'));
    const onDoc = (e: Event): void => { if (!root.contains(e.target as Node) && !btn.contains(e.target as Node)) close(false); };
    const onScroll = (e: Event): void => { if (!root.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', onDoc, true); addEventListener('scroll', onScroll, true); addEventListener('resize', place);
    return { root, list, active: 0, cleanup: () => {
      document.removeEventListener('pointerdown', onDoc, true); removeEventListener('scroll', onScroll, true); removeEventListener('resize', place);
      root.classList.remove('open'); if (reduce()) root.remove(); else setTimeout(() => root.remove(), 130);
    } };
  }

  /* ---------- mobile bottom sheet ---------- */
  function openSheet(list: HTMLElement) {
    const root = document.createElement('div'); root.className = 'csel-sheetroot';
    const backdrop = document.createElement('div'); backdrop.className = 'csel-backdrop';
    const sheet = document.createElement('div'); sheet.className = 'csel-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', labelOf(sel));
    const head = document.createElement('div'); head.className = 'csel-head';
    const grab = document.createElement('div'); grab.className = 'csel-grab'; grab.setAttribute('aria-hidden', 'true');
    const row = document.createElement('div'); row.className = 'csel-title';
    const title = document.createElement('span'); title.textContent = labelOf(sel);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'csel-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    row.append(title, x); head.append(grab, row);
    list.tabIndex = 0;
    sheet.append(head, list); root.append(backdrop, sheet); mountPortal(root); guardTouch(root);

    // lock body scroll
    const lock = lockableBody(); const scrollY = scrollY_(); const b = document.body.style;
    const prev = { pos: b.position, top: b.top, w: b.width }; if (lock) { b.position = 'fixed'; b.top = `-${scrollY}px`; b.width = '100%'; }

    const H = sheet.offsetHeight;
    const defaultVisible = Math.min(innerHeight * 0.6, list.scrollHeight + head.offsetHeight + 24);
    const defaultY = Math.max(0, H - defaultVisible);
    let y = H, state: Snap = 'default';
    const apply = (ty: number, animate: boolean): void => { y = ty; sheet.style.transition = animate && !reduce() ? 'transform 200ms cubic-bezier(.23,1,.32,1)' : 'none'; sheet.style.transform = `translateY(${ty}px)`; backdrop.style.opacity = String(Math.max(0, Math.min(1, 1 - (ty - 0) / H * 0.9))); };
    sheet.style.transform = `translateY(${H}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => apply(defaultY, true)));
    const snapTo = (s: Snap): void => { if (s === 'close') { close(true); return; } state = s; apply(s === 'expanded' ? 0 : defaultY, true); };

    // drag from header (pointer events) or from the list (touch events)
    let drag: { startY: number; startTy: number; lastY: number; lastT: number; v: number } | null = null;
    const begin = (cy: number): void => { drag = { startY: cy, startTy: y, lastY: cy, lastT: performance.now(), v: 0 }; sheet.style.transition = 'none'; };
    const move = (cy: number): void => {
      if (!drag) return;
      const now = performance.now(), dt = Math.max(1, now - drag.lastT);
      drag.v = 0.8 * drag.v + 0.2 * ((cy - drag.lastY) / dt); drag.lastY = cy; drag.lastT = now;
      apply(Math.max(0, Math.min(H, drag.startTy + (cy - drag.startY))), false);
    };
    const end = (): void => {
      if (!drag) return; const v = drag.v; drag = null;
      snapTo(snapDecision({ y, defaultY, closedY: H, velocity: v }));
    };
    const onPD = (e: PointerEvent): void => { if ((e.target as HTMLElement).closest('.csel-x')) return; e.preventDefault(); begin(e.clientY); addEventListener('pointermove', onPM); addEventListener('pointerup', onPU); addEventListener('pointercancel', onPU); };
    const onPM = (e: PointerEvent): void => move(e.clientY);
    const onPU = (): void => { removeEventListener('pointermove', onPM); removeEventListener('pointerup', onPU); removeEventListener('pointercancel', onPU); end(); };
    head.addEventListener('pointerdown', onPD);
    let tStart = 0, tMode: 'none' | 'sheet' | 'scroll' = 'none';
    list.addEventListener('touchstart', (e) => { tStart = e.touches[0].clientY; tMode = 'none'; }, { passive: true });
    list.addEventListener('touchmove', (e) => {
      const cy = e.touches[0].clientY, dy = cy - tStart;
      if (tMode === 'none') {
        if (dy > 6 && list.scrollTop <= 0) { tMode = 'sheet'; begin(tStart); }
        else if (dy < -6 && state === 'default') { tMode = 'sheet'; begin(tStart); }
        else if (Math.abs(dy) > 6) tMode = 'scroll';
      }
      if (tMode === 'sheet') { e.preventDefault(); move(cy); }
    }, { passive: false });
    list.addEventListener('touchend', () => { if (tMode === 'sheet') end(); tMode = 'none'; });
    list.addEventListener('touchcancel', () => { if (tMode === 'sheet') end(); tMode = 'none'; });

    backdrop.addEventListener('click', () => close(true));
    x.addEventListener('click', () => close(true));
    // focus trap: listbox <-> close button; arrows and typeahead act on the listbox
    list.addEventListener('keydown', (e) => onKeys(e));
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') { const f = [x, list]; const i = f.indexOf(document.activeElement as HTMLElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    });
    list.focus({ preventScroll: true });
    return { root, list, active: 0, cleanup: () => {
      removeEventListener('pointermove', onPM); removeEventListener('pointerup', onPU);
      const done = (): void => { root.remove(); };
      sheet.style.transition = reduce() ? 'none' : 'transform 200ms cubic-bezier(.23,1,.32,1)'; sheet.style.transform = `translateY(${H}px)`; backdrop.style.opacity = '0';
      // restore scroll right away so the page does not jump while the sheet leaves
      if (lock) { b.position = prev.pos; b.top = prev.top; b.width = prev.w; scrollTo(0, scrollY); }
      if (reduce()) done(); else setTimeout(() => root.remove(), 210);
    } };
  }
}
const scrollY_ = (): number => window.scrollY || document.documentElement.scrollTop || 0;

export function enhanceAll(): void {
  document.querySelectorAll('select').forEach((s) => enhanceSelect(s as HTMLSelectElement));
  // selects created later
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof HTMLSelectElement) enhanceSelect(n); else if (n instanceof HTMLElement) n.querySelectorAll('select').forEach((s) => enhanceSelect(s as HTMLSelectElement)); });
  }).observe(document.body, { childList: true, subtree: true });
}
