import { ask, buildAskBody, nav, detectLang, fillNavFallback, splitNumbers, type Answer, type Lang, type NavAction, type NavLimits } from './lib/assistant';
import { firstSentence, areaCode, buildDataModule, isValidationCited, numberCitations, regionOf, topicOf, validationChips, type DataModule } from './lib/briefing';
import { chipRow, dataModuleEl, sparkEl } from './briefingUi';
import type { Span } from './lib/analytics';
import { el } from './ui/dom';
import { openInfoSheet } from './ui/sheet';
import { mountPortal } from './ui/portal';
import { addInfo } from './glossary';
import { createEmber, type Ember, type EmberState } from './ui/ember';

/** API base of the SI assistant worker (its origin is in the CSP connect-src). */
export const ASSISTANT_URL = 'https://firechronicle-assistant.firechronicle-assistant.workers.dev';
const REASONS: Record<string, string> = { out_of_scope: 'I can only answer questions about fire data, satellites and this site.', not_in_base: 'This is not in the knowledge base.', unverified_number: 'I could not verify a number in that answer, so I will not give it.', limit: 'The question limit has been reached. Please try again later.', invalid: 'That question could not be used. Try rephrasing it.' };
const INTRO = 'Hi, I’m Ember. I watch NASA satellite fire data for Central Asia. I only answer from FireChronicle’s data and documents, and I’ll tell you when something isn’t there.';
const NOTE = 'SI-written \u00b7 facts from NASA FIRMS data';
/** One short disclosure line with an info button (popover through the portal). */
function siNote(): HTMLElement { const p = el('p', 'mc-note'); const t = el('span', undefined, NOTE); p.append(t); addInfo(t, 'SI-note'); return p; }
const CONTEXTUAL = ['Is this month normal here?', 'When is the fire season here?', 'What is a hotspot?', 'Why harmonize MODIS and VIIRS?'];
let fabEmber: Ember | null = null, panelEmber: Ember | null = null;
export const emberState = (s: EmberState): void => { fabEmber?.setState(s); panelEmber?.setState(s); };

export interface RegionData { harm: ArrayLike<number>; sp: Span; y0: number; y1: number }
export interface AssistantHost {
  areaName(): string; areaId(): { kind: 'region' | 'polygon' | 'circle'; id?: string }; dataThrough(): string;
  facts(): Record<string, unknown>; limits(): NavLimits; apply(a: NavAction): string;
  /** harmonized series for a region id (null id = the current area); null when unavailable */
  regionData(iso: string | null): RegionData | null; validation(): unknown;
  openCalendar(iso: string): void; shareCard(iso: string): Promise<void>;
}
type Msg = { role: 'user' | 'bot' | 'notice' | 'loading' | 'error'; text: string; answer?: Answer; dm?: DataModule | null; vchips?: { k: string; v: string }[]; iso?: string | null; topic?: string; retry?: { q: string; withArea: boolean } | null };

const state = { lang: 'en' as Lang, mode: 'ask' as 'ask' | 'go', msgs: [] as Msg[], busy: false, draft: '', link: 'ok' as 'ok' | 'err' };
let scrim: HTMLElement | null = null;
let host: AssistantHost, drawer: HTMLElement | null = null, closeSheet: (() => void) | null = null, opener: HTMLElement | null = null;
let active: { root: HTMLElement; log: HTMLElement; input: HTMLTextAreaElement; send: HTMLButtonElement; sugs: HTMLElement; hello: HTMLElement; tabs: HTMLButtonElement[]; prompt: HTMLElement; tel: HTMLElement; starters: HTMLElement } | null = null;

const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string> = {
  doc: 'M5 2.5h6.5L15 6v11.5H5zM11 2.5V6.5h4M7.5 10h5M7.5 13h5', check: 'm4.5 10.5 3.5 3.5 7.5-8',
  send: 'M10 16V5M5.5 9.5 10 5l4.5 4.5', retry: 'M15.5 10a5.5 5.5 0 1 1-1.8-4.1M15.5 3.5v3h-3', close: 'm5 5 10 10M15 5 5 15',
};
function icon(name: string, size = 16): SVGElement {
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s;
}
function rich(parent: HTMLElement, text: string): void {
  for (const part of splitNumbers(text)) { if (part.num) parent.append(el('span', 'num', part.t)); else parent.append(document.createTextNode(part.t)); }
}
async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); return ok;
  }
}
const avatar = (st: EmberState = 'idle'): HTMLElement => { const e = createEmber(24, true); e.el.dataset.state = st; return e.el; };
const areaCodeNow = (): string => { const a = host.areaId(); return areaCode(a.kind, a.id); };
const mcBtn = (label: string, fn: () => void, cls = ''): HTMLButtonElement => { const b = el('button', `mc-act ${cls}`.trim(), label); b.type = 'button'; b.addEventListener('click', fn); return b; };

function renderTelemetry(): void {
  if (!active) return;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const link = offline ? 'off' : state.link, t = active.tel; t.textContent = '';
  const dot = el('span', `mc-dot ${link}`); dot.setAttribute('aria-hidden', 'true');
  t.append(dot, el('span', undefined, link === 'ok' ? 'LINK OK' : link === 'err' ? 'LINK ISSUE' : 'OFFLINE'), el('span', 'sep', '·'), el('span', undefined, 'SRC NASA FIRMS'), el('span', 'sep', '·'), el('span', undefined, `DATA ${host.dataThrough()}`), el('span', 'sep', '·'), el('span', undefined, `AREA ${areaCodeNow()}`));
}

/** Prose with numbers styled and numbered [n] citations that highlight and focus their row in `scope`. */
function proseEl(a: Answer, cites: ReturnType<typeof numberCitations>, scope: () => ParentNode | null): HTMLElement {
  const body = el('div', 'mc-body');
  const paras = a.answer.split(/\n{2,}/).filter((p) => p.trim());
  paras.forEach((para, i) => {
    const p = el('p'); rich(p, para.trim());
    if (i === paras.length - 1 && cites.length) for (const c of cites) {
      const sup = el('sup'); const b = el('button', 'mc-cite', `[${c.n}]`); b.type = 'button'; b.setAttribute('aria-label', `Source ${c.n}: ${c.label}`);
      const hl = (on: boolean): void => { scope()?.querySelectorAll(`[data-cite="${c.n}"]`).forEach((r) => r.classList.toggle('hl', on)); };
      b.addEventListener('mouseenter', () => hl(true)); b.addEventListener('mouseleave', () => hl(false)); b.addEventListener('focus', () => hl(true)); b.addEventListener('blur', () => hl(false));
      b.addEventListener('click', (e) => { e.stopPropagation(); scope()?.querySelector<HTMLElement>(`[data-cite="${c.n}"] a`)?.focus(); });
      sup.append(document.createTextNode(' '), b); p.append(sup);
    }
    body.append(p);
  });
  return body;
}
function sourcesEl(cites: ReturnType<typeof numberCitations>): HTMLElement {
  const foot = el('div', 'mc-srcs'); foot.append(el('div', 'mc-clabel', 'SOURCES'));
  const ul = el('ul'); ul.setAttribute('aria-label', 'Sources');
  for (const c of cites) {
    const li = el('li'); li.dataset.cite = String(c.n); li.append(el('span', 'mc-n', `[${c.n}]`));
    if (c.url) { const link = el('a', undefined, c.label) as HTMLAnchorElement; link.href = c.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = c.label; li.append(link, el('span', 'mc-ext', '↗')); } else li.append(el('span', undefined, c.label));
    ul.append(li);
  }
  foot.append(ul); return foot;
}
function actionsEl(m: Msg, closeFirst: (() => void) | null): HTMLElement {
  const a = m.answer!, acts = el('div', 'mc-acts');
  if (m.iso) {
    const iso = m.iso;
    acts.append(mcBtn('[SHOW ON MAP]', () => { closeFirst?.(); host.apply({ area: iso }); if (matchMedia('(max-width: 640px)').matches) closeAssistant(); }), mcBtn('[OPEN CALENDAR]', () => { closeFirst?.(); closeAssistant(); host.openCalendar(iso); }));
  }
  const cp = mcBtn('[COPY]', () => { void copyText(a.answer).then((ok) => { cp.textContent = ok ? '[COPIED]' : '[FAILED]'; setTimeout(() => { cp.textContent = '[COPY]'; }, 1500); }); });
  acts.append(cp);
  if (m.iso) { const iso = m.iso; const sh = mcBtn('[SHARE CARD]', () => { sh.textContent = '[RENDERING…]'; void host.shareCard(iso).finally(() => { sh.textContent = '[SHARE CARD]'; }); }); acts.append(sh); }
  return acts;
}

/** The full briefing: a centred modal on desktop, a full-height sheet on phones. Renders through the portal, so it also works in fullscreen. */
function openBriefing(m: Msg, trigger: HTMLElement): void {
  const a = m.answer!, cites = numberCitations(a.sources);
  const root = el('div', 'mc-full');
  const head = el('div', 'mc-fhead'); head.append(el('span', 'mc-ftopic', `◐ BRIEFING · ${m.topic ?? 'GENERAL'}`), el('span', 'mc-fmeta', `DATA ${host.dataThrough()} · AREA ${m.iso ?? areaCodeNow()}`));
  const body = proseEl(a, cites, () => root);
  root.append(head, body);
  if (m.dm) root.append(dataModuleEl(m.dm, true)); else if (m.vchips?.length) root.append(chipRow(m.vchips));
  if (cites.length) root.append(sourcesEl(cites));
  if (matchMedia('(max-width: 640px)').matches) {
    const close = openInfoSheet(`Briefing · ${m.topic ?? ''}`, root, trigger, { tall: true, full: true });
    root.append(actionsEl(m, close), siNote()); return;
  }
  const scr = el('div', 'mc-mscrim'), modal = el('div', 'mc-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', `Briefing ${m.topic ?? ''}`);
  const x = el('button', 'mc-x mc-mx'); x.type = 'button'; x.setAttribute('aria-label', 'Close briefing'); x.append(icon('close', 18));
  const close = (): void => { scr.remove(); modal.remove(); window.removeEventListener('keydown', onKey, true); trigger.focus(); };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { const f = [...modal.querySelectorAll<HTMLElement>('button, a[href]')]; if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
  };
  x.addEventListener('click', close); scr.addEventListener('click', close);
  root.append(actionsEl(m, close), siNote()); modal.append(x, root); mountPortal(scr); mountPortal(modal);
  window.addEventListener('keydown', onKey, true); x.focus({ preventScroll: true });
}

function answerCard(m: Msg): HTMLElement {
  const a = m.answer!, col = el('div', 'mc-col');
  const cites = numberCitations(a.sources);
  if (m.dm || m.vchips?.length) {
    // compact preview; the whole card opens the full briefing
    const card = el('div', 'mc-card preview'); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Open briefing: ${m.topic ?? ''}`);
    card.append(el('div', 'mc-chead', `◐ BRIEFING · ${m.topic ?? 'GENERAL'}`));
    card.append(el('p', 'mc-first', firstSentence(a.answer)));
    const chips = (m.dm ? m.dm.chips : m.vchips ?? []).slice(0, 2);
    if (chips.length) { const w = el('div', 'mc-pchips'); w.append(chipRow(chips)); card.append(w); }
    if (m.dm?.spark) card.append(sparkEl(m.dm, 28));
    const foot = el('div', 'mc-pfoot'); foot.append(el('span', undefined, `${cites.length} source${cites.length === 1 ? '' : 's'}`), el('span', 'mc-open', 'OPEN BRIEFING ↗'));
    card.append(foot);
    const open = (): void => openBriefing(m, card);
    card.addEventListener('click', open); card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    col.append(card); return col;
  }
  const card = el('div', 'mc-card');
  card.append(el('div', 'mc-chead', `◐ BRIEFING · ${m.topic ?? 'GENERAL'}`));
  const body = proseEl(a, cites, () => card); card.append(body);
  if (a.answer.length > 320) {
    body.classList.add('clamp'); const more = mcBtn('[READ MORE]', () => { const open = body.classList.toggle('clamp'); more.textContent = open ? '[READ MORE]' : '[READ LESS]'; }); more.classList.add('mc-more'); card.append(more);
  }
  card.append(actionsEl(m, null));
  if (cites.length) card.append(sourcesEl(cites));
  col.append(card);
  if (new URLSearchParams(location.search).has('debug') && (a.model || a.cached)) col.append(el('p', 'mc-meta', [a.cached ? 'cached' : '', a.model ?? ''].filter(Boolean).join(' · ')));
  return col;
}

function renderLog(): void {
  if (!active) return;
  const { log, hello, sugs } = active; log.textContent = '';
  const empty = state.msgs.length === 0; hello.hidden = !empty; log.hidden = empty;
  buildSugs(sugs);
  for (const m of state.msgs) {
    if (m.role === 'user') { const r = el('div', 'mc-row user'); const w = el('div'); w.append(el('div', 'mc-qlabel', '> QUERY'), el('div', 'mc-bubble', m.text)); r.append(w); log.append(r); continue; }
    if (m.role === 'notice') { const n = el('div', 'mc-line'); n.append(el('span', 'mc-tag', 'EXEC'), el('span', undefined, m.text)); log.append(n); continue; }
    const row = el('div', 'mc-row bot');
    if (m.role === 'loading') {
      row.append(avatar('thinking')); const col = el('div', 'mc-col'); const c = el('div', 'mc-card scan'); c.setAttribute('aria-busy', 'true'); c.append(el('div', 'mc-chead', '◐ SCANNING…'), el('div', 'mc-skel')); col.append(c); row.append(col); log.append(row); continue;
    }
    if (m.role === 'error') {
      row.append(avatar('error')); const col = el('div', 'mc-col'); const c = el('div', 'mc-card err'); c.append(el('div', 'mc-chead', '▲ LINK ISSUE'), el('p', 'mc-body', m.text));
      if (m.retry) { const rq = m.retry; c.append(mcBtn('[RETRY]', () => { state.msgs = state.msgs.filter((x) => x !== m); const i = state.msgs.length - 1; if (state.msgs[i]?.role === 'user') state.msgs.pop(); void send(rq.q, rq.withArea); })); }
      col.append(c); row.append(col); log.append(row); continue;
    }
    const a = m.answer!;
    if (a.refused) {
      row.append(avatar('refused')); const col = el('div', 'mc-col'), c = el('div', 'mc-card refused');
      c.append(el('div', 'mc-chead', '○ NO DATA'), el('p', 'mc-body', REASONS[a.reason ?? ''] ?? (a.reason || 'This is not in the knowledge base.')));
      const tr = el('div', 'mc-try'); tr.append(el('span', 'mc-clabel', 'TRY'));
      for (const q of CONTEXTUAL.filter((x) => x.toLowerCase() !== (m.text || '').toLowerCase()).slice(0, 2)) { const b = el('button', 'mc-chip', q); b.type = 'button'; b.addEventListener('click', () => { state.mode = 'ask'; syncMode(); void send(q); }); tr.append(b); }
      c.append(tr); col.append(c); row.append(col); log.append(row); continue;
    }
    row.append(avatar('idle')); row.append(answerCard(m)); log.append(row);
  }
  log.scrollTop = log.scrollHeight;
}
function buildSugs(sugs: HTMLElement): void {
  sugs.textContent = '';
  const add = (label: string, fn: () => void, strong = false): void => { const b = el('button', `mc-chip${strong ? ' strong' : ''}`, label); b.type = 'button'; b.disabled = state.busy; b.addEventListener('click', fn); sugs.append(b); };
  if (state.mode === 'ask') {
    add(`EXPLAIN ${areaCodeNow()}`, () => { void send('Explain this area for a non-expert.', true); }, true);
    add('Is this month normal here?', () => { void send('Is this month normal here?'); });
    add('When is the fire season here?', () => { void send('When is the fire season here?'); });
  } else {
    add('Kazakhstan 2015–2020 swipe', () => { void send('Kazakhstan 2015 to 2020 swipe'); }, true);
    add('Tajikistan vs Kyrgyzstan', () => { void send('Tajikistan vs Kyrgyzstan'); });
  }
}
function syncMode(): void {
  if (!active) return;
  active.tabs.forEach((t, i) => t.setAttribute('aria-selected', String((i === 0) === (state.mode === 'ask'))));
  active.prompt.textContent = state.mode === 'ask' ? '›' : 'GO ›';
  active.input.placeholder = state.mode === 'ask' ? 'Ask about fire, sensors or this page' : 'e.g. Show Tajikistan, 2015 to 2025, naive splice';
  buildSugs(active.sugs);
}
function setBusy(v: boolean): void { state.busy = v; if (active) { syncSend(); buildSugs(active.sugs); } }
function syncSend(): void { if (active) active.send.disabled = state.busy || !ASSISTANT_URL || !active.input.value.trim(); }
function errText(kind: string, retry: number | null): string {
  if (kind === 'rate') { const at = retry ? new Date(Date.now() + retry * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null; return `Question limit reached. ${at ? `It resets at ${at}.` : 'Try again in a minute.'}`; }
  if (kind === 'network') return 'Could not reach Ember. Check your connection and try again.';
  if (kind === 'unconfigured') return 'The assistant is not connected yet.';
  return 'Ember returned an unexpected answer. Please try again.';
}
const fetchImpl = (u: string, i: { method: string; headers: Record<string, string>; body: string }) => fetch(u, i);

async function send(q: string, withArea = false): Promise<void> {
  q = q.trim(); if (!q || state.busy) return;
  state.msgs.push({ role: 'user', text: q }, { role: 'loading', text: '' }); state.draft = ''; if (active) { active.input.value = ''; autosize(); }
  setBusy(true); renderLog(); emberState('thinking');
  const done = (m: Msg): void => { state.msgs = state.msgs.filter((x) => x.role !== 'loading'); state.msgs.push(m); state.link = m.role === 'error' ? 'err' : 'ok'; setBusy(false); renderLog(); renderTelemetry(); emberState(m.role === 'bot' ? (m.answer?.refused ? 'refused' : 'answered') : m.role === 'notice' ? 'answered' : 'error'); };
  const fail = (kind: string, retryAfter: number | null): void => done({ role: 'error', text: errText(kind, retryAfter), retry: kind === 'unconfigured' ? null : { q, withArea } });
  if (state.mode === 'go' && !withArea) {
    const r = await nav(fetchImpl, ASSISTANT_URL, q, host.limits());
    if (!r.ok) return fail(r.error.kind, r.error.kind === 'rate' ? r.error.retryAfter : null);
    const act = fillNavFallback(r.value.action, q, host.limits());
    if (!act || (r.value.refused && !r.value.action)) return done({ role: 'error', text: 'I could not turn that into a view. Try naming an area, years or a calendar mode.', retry: null });
    return done({ role: 'notice', text: host.apply(act) });
  }
  if (!withArea) state.lang = detectLang(q);
  const body = buildAskBody(q, state.lang, withArea ? { name: host.areaName(), facts: host.facts() } : undefined);
  const r = await ask(fetchImpl, ASSISTANT_URL, body);
  if (!r.ok) return fail(r.error.kind, r.error.kind === 'rate' ? r.error.retryAfter : null);
  const ans = r.value;
  // everything visual is built from local data, never from the model's text
  let iso: string | null = regionOf(ans.sources), dm: DataModule | null = null;
  if (!ans.refused) {
    const regionRd = iso ? host.regionData(iso) : null;
    if (iso && regionRd) dm = buildDataModule(regionRd.harm, regionRd.sp, regionRd.y0, regionRd.y1);
    else if (withArea) { const rd = host.regionData(null); if (rd) dm = buildDataModule(rd.harm, rd.sp, rd.y0, rd.y1); const a = host.areaId(); iso = a.kind === 'region' ? (a.id ?? null) : null; }
    else iso = null;
  }
  const topic = iso ? iso : withArea ? areaCodeNow() : topicOf(ans.sources);
  done({ role: 'bot', text: q, answer: ans, dm, iso, topic, vchips: !dm && isValidationCited(ans.sources) ? validationChips(host.validation()) : [] });
}
function autosize(): void {
  if (!active) return; const t = active.input; t.style.height = 'auto'; t.style.height = `${Math.max(34, Math.min(t.scrollHeight, 22 * 4 + 12))}px`;
}

function build(): HTMLElement {
  const root = el('div', 'mc');
  const head = el('div', 'mc-head'); panelEmber = createEmber(32);
  const id = el('div', 'mc-id'); const h2 = el('h2', undefined, 'EMBER'); const si = el('span', 'mc-si', 'SI'); si.title = 'SI assistant'; si.setAttribute('aria-label', 'SI assistant'); h2.append(si); id.append(h2, el('p', undefined, 'SI assistant'));
  const x = el('button', 'mc-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close assistant'); x.append(icon('close', 18)); x.addEventListener('click', closeAssistant);
  head.append(panelEmber.el, id, x);
  const tel = el('div', 'mc-tel'); tel.setAttribute('aria-label', 'Link status');
  const tabs = el('div', 'mc-tabs'); tabs.setAttribute('role', 'tablist'); const tabBtns: HTMLButtonElement[] = [];
  for (const [mid, label] of [['ask', 'ASK'], ['go', 'GO TO VIEW']] as const) {
    const b = el('button', 'mc-tab', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(state.mode === mid));
    b.addEventListener('click', () => { state.mode = mid; syncMode(); }); tabBtns.push(b); tabs.append(b);
  }
  const log = el('div', 'mc-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-label', 'Conversation');
  log.addEventListener('scroll', () => log.classList.toggle('scrolled', log.scrollTop > 4));
  const hello = el('div', 'mc-hello'); const orbit = el('div', 'mc-orbit'); orbit.append(createEmber(96).el);
  const starters = el('div', 'mc-starters');
  const st = (label: string, fn: () => void): void => { const b = el('button', 'mc-task', label); b.type = 'button'; b.addEventListener('click', fn); starters.append(b); };
  st('WHAT IS A HOTSPOT?', () => { state.mode = 'ask'; syncMode(); void send('What is a hotspot?'); });
  st('IS THIS MONTH NORMAL?', () => { state.mode = 'ask'; syncMode(); void send('Is this month normal here?'); });
  st('WHY HARMONIZE?', () => { state.mode = 'ask'; syncMode(); void send('Why do we need to harmonize MODIS and VIIRS?'); });
  const exp = el('button', 'mc-task', `EXPLAIN ${areaCodeNow()}`); exp.type = 'button'; exp.addEventListener('click', () => { state.mode = 'ask'; syncMode(); void send('Explain this area for a non-expert.', true); }); starters.append(exp);
  hello.append(orbit, el('p', undefined, INTRO), starters);
  const sugs = el('div', 'mc-sugs');
  const form = el('form', 'mc-comp'); const prompt = el('span', 'mc-prompt', '›'); prompt.setAttribute('aria-hidden', 'true');
  const input = el('textarea'); input.rows = 1; input.maxLength = 500; input.placeholder = 'Ask about fire, sensors or this page'; input.setAttribute('aria-label', 'Your question'); input.value = state.draft;
  const count = el('span', 'mc-count'); count.hidden = true;
  const sendB = el('button', 'mc-send'); sendB.type = 'submit'; sendB.setAttribute('aria-label', 'Send'); sendB.append(icon('send', 18));
  input.addEventListener('input', () => { state.draft = input.value; autosize(); syncSend(); count.hidden = input.value.length < 400; count.textContent = `${input.value.length}/500`; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.append(prompt, input, count, sendB); form.addEventListener('submit', (e) => { e.preventDefault(); void send(input.value); });
  const note = siNote();
  root.append(head, tel, tabs, hello, log, sugs, form, note);
  active = { root, log, input, send: sendB, sugs, hello, tabs: tabBtns, prompt, tel, starters };
  syncMode(); setBusy(state.busy); renderLog(); renderTelemetry(); autosize(); syncSend();
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
  requestAnimationFrame(autosize); active?.input.focus({ preventScroll: true });
}
export function initAssistant(h: AssistantHost): void {
  host = h; fabEmber = createEmber(32); document.getElementById('ask-ember')?.append(fabEmber.el);
  setupHello(); window.addEventListener('fc-hud', renderTelemetry); window.addEventListener('online', renderTelemetry); window.addEventListener('offline', renderTelemetry);
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
