import { ask, buildAskBody, nav, detectLang, fillNavFallback, splitNumbers, type Answer, type Lang, type NavAction, type NavLimits } from './lib/assistant';
import { el } from './ui/dom';
import { openInfoSheet } from './ui/sheet';
import { mountPortal } from './ui/portal';
import { createEmber, type Ember, type EmberState } from './ui/ember';

/** API base of the SI assistant worker (its origin is in the CSP connect-src). */
export const ASSISTANT_URL = 'https://firechronicle-assistant.firechronicle-assistant.workers.dev';
const STARTERS: string[] = ['What is a hotspot?', 'Why do MODIS and VIIRS differ?', 'What does harmonized mean?', 'How accurate is this data?'];
const REASONS: Record<string, string> = { out_of_scope: 'I can only answer questions about fire data, satellites and this site.', not_in_base: 'This is not in the knowledge base.', unverified_number: 'I could not verify a number in that answer, so I will not give it.', limit: 'The question limit has been reached. Please try again later.', invalid: 'That question could not be used. Try rephrasing it.' };
const INTRO = 'Hi, I’m Ember. I watch NASA satellite fire data for Central Asia. I only answer from FireChronicle’s data and documents, and I’ll tell you when something isn’t there.';
const NOTE = 'Answers come from an SI model grounded in FireChronicle data; numbers are checked against sources.';
let fabEmber: Ember | null = null, panelEmber: Ember | null = null;
export const emberState = (s: EmberState): void => { fabEmber?.setState(s); panelEmber?.setState(s); };

export interface AssistantHost { areaName(): string; facts(): Record<string, unknown>; limits(): NavLimits; apply(a: NavAction): string }
type Msg = { role: 'user' | 'bot' | 'notice' | 'loading' | 'error'; text: string; answer?: Answer; retry?: { q: string; withArea: boolean } | null };

const state = { lang: 'en' as Lang, mode: 'ask' as 'ask' | 'go', msgs: [] as Msg[], busy: false, draft: '' };
let scrim: HTMLElement | null = null;
let host: AssistantHost, drawer: HTMLElement | null = null, closeSheet: (() => void) | null = null, opener: HTMLElement | null = null;
let active: { log: HTMLElement; input: HTMLTextAreaElement; send: HTMLButtonElement; sugs: HTMLElement; sugExplain: HTMLButtonElement; hello: HTMLElement; tabs: HTMLButtonElement[] } | null = null;

const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string> = {
  doc: 'M5 2.5h6.5L15 6v11.5H5zM11 2.5V6.5h4M7.5 10h5M7.5 13h5',
  copy: 'M7 7h8.5v9H7zM4.5 13V4H13',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9v5M10 6.4v.1',
  send: 'M10 16V5M5.5 9.5 10 5l4.5 4.5',
  retry: 'M15.5 10a5.5 5.5 0 1 1-1.8-4.1M15.5 3.5v3h-3',
  close: 'm5 5 10 10M15 5 5 15',
};
function icon(name: string, size = 16): SVGElement {
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s;
}
/** Text with numbers wrapped in <span class="num"> (DOM nodes only, no innerHTML). */
function rich(parent: HTMLElement, text: string): void {
  for (const part of splitNumbers(text)) { if (part.num) parent.append(el('span', 'num', part.t)); else parent.append(document.createTextNode(part.t)); }
}
async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); return ok;
  }
}
const avatar = (state_: EmberState = 'idle'): HTMLElement => { const e = createEmber(24, true); e.el.dataset.state = state_; e.el.classList.add('ec-av'); return e.el; };

function renderLog(): void {
  if (!active) return;
  const { log, hello, sugs } = active; log.textContent = '';
  const empty = state.msgs.length === 0; hello.hidden = !empty; log.hidden = empty;
  active.sugExplain.textContent = `Explain ${host.areaName()}`;
  sugs.hidden = false;
  for (const m of state.msgs) {
    if (m.role === 'user') { const r = el('div', 'ec-row user'); r.append(el('div', 'ec-bubble', m.text)); log.append(r); continue; }
    if (m.role === 'notice') { const n = el('div', 'ec-line'); n.append(icon('check', 14), el('span', undefined, m.text)); log.append(n); continue; }
    const row = el('div', 'ec-row bot');
    if (m.role === 'loading') {
      row.append(avatar('thinking')); const c = el('div', 'ec-card'); c.setAttribute('aria-busy', 'true'); const d = el('span', 'ec-dots'); d.append(el('i'), el('i'), el('i')); c.append(d); const sr = el('span', 'sr', 'Ember is thinking'); c.append(sr); row.append(c); log.append(row); continue;
    }
    if (m.role === 'error') {
      row.append(avatar('error')); const c = el('div', 'ec-card err'); c.append(el('p', undefined, m.text));
      if (m.retry) { const b = el('button', 'ec-retry'); b.type = 'button'; b.append(icon('retry', 14), document.createTextNode('Retry')); const rq = m.retry; b.addEventListener('click', () => { state.msgs = state.msgs.filter((x) => x !== m); const i = state.msgs.length - 1; if (state.msgs[i]?.role === 'user') state.msgs.pop(); void send(rq.q, rq.withArea); }); c.append(b); }
      row.append(c); log.append(row); continue;
    }
    const a = m.answer!;
    row.append(avatar(a.refused ? 'refused' : 'idle'));
    const col = el('div', 'ec-col'), card = el('div', 'ec-card' + (a.refused ? ' refused' : ''));
    if (a.refused) {
      const top = el('div', 'ec-ref'); top.append(icon('info', 16), el('span', undefined, REASONS[a.reason ?? ''] ?? (a.reason || 'This is not in the knowledge base.')));
      card.append(top);
      const tryB = el('button', 'ec-try'); tryB.type = 'button'; tryB.append(document.createTextNode('Try: '), el('u', undefined, 'When is the fire season here?'));
      tryB.addEventListener('click', () => { state.mode = 'ask'; void send('When is the fire season here?'); }); card.append(tryB);
    } else {
      for (const para of a.answer.split(/\n{2,}/)) { const p = el('p'); rich(p, para.trim()); card.append(p); }
      const cp = el('button', 'ec-copy'); cp.type = 'button'; cp.setAttribute('aria-label', 'Copy answer'); cp.title = 'Copy'; cp.append(icon('copy', 15));
      cp.addEventListener('click', () => { void copyText(a.answer).then((ok) => { cp.textContent = ''; cp.append(icon(ok ? 'check' : 'copy', 15)); cp.title = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { cp.textContent = ''; cp.append(icon('copy', 15)); cp.title = 'Copy'; }, 1500); }); });
      card.append(cp);
    }
    col.append(card);
    if (a.sources.length) {
      const ul = el('ul', 'ec-srcs'); ul.setAttribute('aria-label', 'Sources');
      for (const s of a.sources) {
        const li = el('li'); const label = s.section || s.title, tip = s.section ? `${s.title} – ${s.section}` : s.title;
        if (s.url) { const link = el('a', 'ec-src') as HTMLAnchorElement; link.href = s.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = tip; link.append(icon('doc', 13), el('span', undefined, label)); li.append(link); }
        else { const sp = el('span', 'ec-src'); sp.title = tip; sp.append(icon('doc', 13), el('span', undefined, label)); li.append(sp); }
        ul.append(li);
      }
      col.append(ul);
    }
    if (new URLSearchParams(location.search).has('debug') && (a.model || a.cached)) col.append(el('p', 'ec-meta', [a.cached ? 'cached' : '', a.model ?? ''].filter(Boolean).join(' · ')));
    row.append(col); log.append(row);
  }
  log.scrollTop = log.scrollHeight;
}
function setBusy(v: boolean): void { state.busy = v; if (active) syncSend(); }
function syncSend(): void { if (active) active.send.disabled = state.busy || !ASSISTANT_URL || !active.input.value.trim(); active?.sugExplain && (active.sugExplain.disabled = state.busy); }
function errText(kind: string, retry: number | null): string {
  if (kind === 'rate') return `Too many questions right now. Please try again ${retry ? `in ${retry} seconds` : 'in a minute'}.`;
  if (kind === 'network') return 'Could not reach Ember. Check your connection and try again.';
  if (kind === 'unconfigured') return 'The assistant is not connected yet.';
  return 'Ember returned an unexpected answer. Please try again.';
}
const fetchImpl = (u: string, i: { method: string; headers: Record<string, string>; body: string }) => fetch(u, i);

async function send(q: string, withArea = false): Promise<void> {
  q = q.trim(); if (!q || state.busy) return;
  state.msgs.push({ role: 'user', text: q }, { role: 'loading', text: '' }); state.draft = ''; if (active) { active.input.value = ''; autosize(); }
  setBusy(true); renderLog(); emberState('thinking');
  const fail = (kind: string, retryAfter: number | null): void => done({ role: 'error', text: errText(kind, retryAfter), retry: kind === 'unconfigured' ? null : { q, withArea } });
  const done = (m: Msg): void => { state.msgs = state.msgs.filter((x) => x.role !== 'loading'); state.msgs.push(m); setBusy(false); renderLog(); emberState(m.role === 'bot' ? (m.answer?.refused ? 'refused' : 'answered') : m.role === 'notice' ? 'answered' : 'error'); };
  if (state.mode === 'go' && !withArea) {
    const r = await nav(fetchImpl, ASSISTANT_URL, q, host.limits());
    if (!r.ok) return fail(r.error.kind, r.error.kind === 'rate' ? r.error.retryAfter : null);
    const act = fillNavFallback(r.value.action, q, host.limits());
    if (!act || (r.value.refused && !r.value.action)) return done({ role: 'error', text: 'I could not turn that into a view. Try naming an area, years or a calendar mode.', retry: null });
    return done({ role: 'notice', text: host.apply(act) });
  }
  if (!withArea) state.lang = detectLang(q); // 'Explain' reuses the language of the last typed question
  const body = buildAskBody(q, state.lang, withArea ? { name: host.areaName(), facts: host.facts() } : undefined);
  const r = await ask(fetchImpl, ASSISTANT_URL, body);
  if (!r.ok) return fail(r.error.kind, r.error.kind === 'rate' ? r.error.retryAfter : null);
  done({ role: 'bot', text: r.value.answer, answer: r.value });
}
function autosize(): void {
  if (!active) return; const t = active.input; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 22 * 4 + 20)}px`;
}

function build(): HTMLElement {
  const root = el('div', 'ec');
  const head = el('div', 'ec-head'); panelEmber = createEmber(32);
  const id = el('div', 'ec-id'); id.append(el('h2', undefined, 'Ember'), el('p', undefined, 'SI assistant · answers only from FireChronicle data'));
  const x = el('button', 'ec-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close assistant'); x.append(icon('close', 18)); x.addEventListener('click', closeAssistant);
  head.append(panelEmber.el, id, x);
  const tabs = el('div', 'ec-tabs'); tabs.setAttribute('role', 'tablist');
  const tabBtns: HTMLButtonElement[] = [];
  for (const [mid, label] of [['ask', 'Ask'], ['go', 'Go to a view']] as const) {
    const b = el('button', 'ec-tab', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(state.mode === mid));
    b.addEventListener('click', () => { state.mode = mid; tabBtns.forEach((t, i) => t.setAttribute('aria-selected', String((i === 0) === (mid === 'ask')))); input.placeholder = mid === 'ask' ? 'Ask about fire, sensors or this page' : 'e.g. Show Tajikistan, 2015 to 2025, naive splice'; });
    tabBtns.push(b); tabs.append(b);
  }
  const log = el('div', 'ec-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-label', 'Conversation');
  log.addEventListener('scroll', () => log.classList.toggle('scrolled', log.scrollTop > 4));
  const hello = el('div', 'ec-hello'); hello.append(createEmber(80).el, el('p', undefined, INTRO));
  const starters = el('div', 'ec-starters'); STARTERS.forEach((c) => { const b = el('button', 'ec-sug', c); b.type = 'button'; b.addEventListener('click', () => { state.mode = 'ask'; tabBtns[0].click(); void send(c); }); starters.append(b); }); hello.append(starters);
  const sugs = el('div', 'ec-sugs'); const sugExplain = el('button', 'ec-sug strong', 'Explain this area'); sugExplain.type = 'button'; sugExplain.addEventListener('click', () => { state.mode = 'ask'; tabBtns[0].click(); void send('Explain this area for a non-expert.', true); }); sugs.append(sugExplain);
  for (const q of ['Is this month normal here?', 'When is the fire season here?']) { const b = el('button', 'ec-sug', q); b.type = 'button'; b.addEventListener('click', () => { state.mode = 'ask'; tabBtns[0].click(); void send(q); }); sugs.append(b); }
  const form = el('form', 'ec-comp'); const input = el('textarea'); input.rows = 1; input.maxLength = 500; input.placeholder = 'Ask about fire, sensors or this page'; input.setAttribute('aria-label', 'Your question'); input.value = state.draft;
  const count = el('span', 'ec-count'); count.hidden = true;
  const sendB = el('button', 'ec-send'); sendB.type = 'submit'; sendB.setAttribute('aria-label', 'Send'); sendB.append(icon('send', 18));
  input.addEventListener('input', () => { state.draft = input.value; autosize(); syncSend(); count.hidden = input.value.length < 400; count.textContent = `${input.value.length}/500`; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.append(input, count, sendB); form.addEventListener('submit', (e) => { e.preventDefault(); void send(input.value); });
  const note = el('p', 'ec-note', NOTE);
  root.append(head, tabs, hello, log, sugs, form, note);
  active = { log, input, send: sendB, sugs, sugExplain, hello, tabs: tabBtns };
  setBusy(state.busy); renderLog(); autosize(); syncSend();
  return root;
}
export function isAssistantOpen(): boolean { return !!drawer || !!closeSheet; }
export function closeAssistant(): void {
  document.documentElement.classList.remove('assist-open');
  if (drawer) { drawer.remove(); scrim?.remove(); scrim = null; drawer = null; active = null; opener?.focus(); }
  if (closeSheet) { closeSheet(); closeSheet = null; active = null; }
}
export function toggleAssistant(from?: HTMLElement | null): void {
  if (isAssistantOpen()) { closeAssistant(); return; }
  opener = from ?? (document.activeElement as HTMLElement | null);
  const root = build();
  document.documentElement.classList.add('assist-open');
  if (matchMedia('(max-width: 640px)').matches) {
    closeSheet = openInfoSheet('Ember', root, opener, { tall: true, bare: true });
    const vv = window.visualViewport; // keep the composer above the on-screen keyboard
    if (vv) { const fit = (): void => { const r = document.querySelector<HTMLElement>('.csel-sheetroot'); if (!r) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); return; } r.style.bottom = 'auto'; r.style.height = `${vv.height}px`; r.style.top = `${vv.offsetTop}px`; }; vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  } else {
    scrim = el('div', 'assist-scrim'); scrim.addEventListener('click', closeAssistant); mountPortal(scrim);
    drawer = el('aside', 'assist-drawer'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Ember, the FireChronicle SI assistant');
    drawer.append(root); mountPortal(drawer);
    drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAssistant(); } });
  }
  active?.input.focus({ preventScroll: true });
}
export function initAssistant(h: AssistantHost): void {
  host = h; fabEmber = createEmber(32); document.getElementById('ask-ember')?.append(fabEmber.el);
  setupHello();
  document.getElementById('ask-btn')?.addEventListener('click', (e) => toggleAssistant(e.currentTarget as HTMLElement));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'a' && e.key !== 'A')) return;
    const t = e.target as HTMLElement | null, tag = t?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable || document.querySelector('.tour')) return;
    e.preventDefault(); toggleAssistant(null);
  });
}

/** One-time "hello": Ember floats in with a speech bubble above the button, after the tour (or at once if it was seen). */
function setupHello(): void {
  const KEY = 'fc-ember-hello';
  let seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch { seen = true; }
  if (seen) return;
  let tourSeen = true; try { tourSeen = localStorage.getItem('fc-tour-done') === '1'; } catch { /* ignore */ }
  const run = (): void => {
    const btn = document.getElementById('ask-btn'); if (!btn || document.querySelector('.ember-bubble')) return;
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    fabEmber?.el.classList.add('hello'); fabEmber?.setState('answered');
    const b = el('div', 'ember-bubble fab', 'Ask me about fires in your area'); b.setAttribute('role', 'status'); mountPortal(b);
    const r = btn.getBoundingClientRect(); b.style.top = 'auto'; b.style.left = 'auto'; b.style.bottom = `${innerHeight - r.top + 12}px`; b.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    const off = (): void => { b.remove(); fabEmber?.el.classList.remove('hello'); document.removeEventListener('click', off, true); };
    setTimeout(off, 5000); setTimeout(() => document.addEventListener('click', off, true), 300);
  };
  if (tourSeen) setTimeout(run, 2500); else window.addEventListener('fc-tour-end', () => setTimeout(run, 600), { once: true });
}
