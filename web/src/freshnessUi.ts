import { nowDate } from './lib/clock';
import { formatCountdown, freshness, nextRun, parseRefresh, shortCountdown, type FreshState, type Refresh } from './lib/freshness';
import type { Meta } from './lib/series';
import { openInfoSheet } from './ui/sheet';

const MIN5 = 300000, H1 = 3600000;
const mon = (d: Date): string => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayText = (s: string): string => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const q = (id: string): HTMLElement => document.getElementById(id)!;

export interface TickInfo { state: FreshState; updating: boolean; countdown: string | null; short: string }
type Cb = (t: TickInfo) => void;
const subs: Cb[] = [];
export const onFreshTick = (cb: Cb): void => { subs.push(cb); };
export function freshText(refresh: Refresh): string {
  return `Data refresh automatically every day at ${refresh.schedule_utc} UTC from NASA FIRMS (MODIS, VIIRS NOAA-20, NOAA-21). Recent months are provisional until science-quality data replace them. Automatic updates are scheduled until ${refresh.auto_update_until}. After that the data stay available but are no longer refreshed. To extend updates, contact the team.`;
}

function link(refresh: Refresh): HTMLAnchorElement {
  const a = document.createElement('a'); a.href = refresh.issues_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Contact the team (GitHub issues)'; return a;
}
function info(refresh: Refresh): HTMLElement {
  const box = document.createElement('div'); box.className = 'fresh-info';
  const p1 = document.createElement('p'); p1.textContent = `Data refresh automatically every day at ${refresh.schedule_utc} UTC from NASA FIRMS (MODIS, VIIRS NOAA-20, NOAA-21). Recent months are provisional until science-quality data replace them.`;
  const p2 = document.createElement('p'); p2.textContent = `Automatic updates are scheduled until ${refresh.auto_update_until}. After that the data stay available but are no longer refreshed. To extend updates, contact the team. `;
  p2.append(link(refresh)); box.append(p1, p2); return box;
}

export function initFreshness(meta: Meta): void {
  const refresh = parseRefresh(meta.refresh);
  const loaded = meta.generated_at, through = meta.data_through ?? meta.generated_at.slice(0, 10);
  const pill = q('fresh') as HTMLButtonElement, digits = q('fr-digits');
  pill.hidden = false;
  q('fr-upd').textContent = `Last update ${mon(new Date(meta.generated_at))}`;
  q('fr-through').textContent = `· Data through ${dayText(through)}`;
  digits.textContent = '';
  for (let i = 0; i < 8; i++) { const c = document.createElement('span'); c.textContent = '0'; digits.append(c); }
  const dc = [...digits.children] as HTMLElement[];
  let target = nextRun(nowDate(), refresh.schedule_utc), phase: 'wait' | 'updating' = 'wait', pollUntil = 0, nextPoll = 0, toasted = false, last = '';
  const banner = q('fresh-banner');

  const setDigits = (txt: string): void => { if (txt === last) return; for (let i = 0; i < 8; i++) if (txt[i] !== last[i]) { dc[i].textContent = txt[i]; dc[i].classList.remove('tick'); void dc[i].offsetWidth; dc[i].classList.add('tick'); } last = txt; };
  const toast = (): void => {
    if (toasted) return; toasted = true;
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
    const s = document.createElement('span'); s.textContent = 'New data available.';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary'; b.textContent = 'Reload'; b.addEventListener('click', () => location.reload());
    const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ghost'; x.textContent = 'Later'; x.addEventListener('click', () => t.remove());
    t.append(s, b, x); document.body.append(t);
  };
  const poll = async (): Promise<void> => {
    try {
      const r = await fetch(`./data/meta.json?ts=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) return;
      const m = (await r.json()) as { generated_at?: string };
      if (m.generated_at && m.generated_at !== loaded) { toast(); phase = 'wait'; target = nextRun(nowDate(), refresh.schedule_utc); }
    } catch { /* offline: try again later */ }
  };
  const showBanner = (state: FreshState): void => {
    banner.textContent = '';
    if (state === 'fresh') { banner.hidden = true; return; }
    const span = document.createElement('span');
    if (state === 'stale') span.textContent = `Data may be out of date — last update ${mon(new Date(meta.generated_at))}. NASA FIRMS or the update job may be delayed.`;
    else { span.textContent = `Automatic updates ended on ${refresh.auto_update_until}. Data are shown as of ${dayText(through)}. Contact the team to extend. `; }
    banner.append(span); if (state === 'ended') banner.append(link(refresh));
    banner.dataset.state = state; banner.hidden = false;
  };
  let shownState: FreshState | null = null;
  const tick = (): void => {
    const now = nowDate(), f = freshness(now, through, refresh);
    pill.dataset.state = f.state;
    if (shownState !== f.state) { shownState = f.state; showBanner(f.state); }
    let cdText: string | null = null, shortT: string, updating = false;
    if (f.state === 'fresh') {
      if (phase === 'wait' && now >= target) { phase = 'updating'; pollUntil = target.getTime() + 2 * H1; nextPoll = 0; }
      if (phase === 'updating') {
        updating = true;
        if (now.getTime() >= pollUntil) { phase = 'wait'; target = nextRun(now, refresh.schedule_utc); updating = false; }
        else if (now.getTime() >= nextPoll) { nextPoll = now.getTime() + MIN5; void poll(); }
      }
      if (!updating) { cdText = formatCountdown(target.getTime() - now.getTime()); shortT = shortCountdown(target.getTime() - now.getTime()); }
      else shortT = 'updating…';
    } else shortT = f.state === 'stale' ? `next try ${refresh.schedule_utc} UTC` : 'updates ended';
    // pill content
    const label = q('fr-cd-label'), cd = q('fr-cd');
    cd.hidden = f.state === 'ended';
    if (updating) { digits.hidden = true; label.textContent = 'Updating… (GitHub schedules can run up to ~1 h late)'; }
    else if (cdText !== null) { digits.hidden = false; label.textContent = 'Next update in'; setDigits(cdText); }
    else { digits.hidden = true; label.textContent = `Next attempt ${refresh.schedule_utc} UTC`; }
    q('fr-main').textContent = f.state === 'fresh' ? 'Updated daily from NASA FIRMS' : f.state === 'stale' ? 'Data may be delayed' : 'Updates ended';
    const ago = f.daysOld === null ? '' : f.daysOld <= 0 ? 'today' : f.daysOld === 1 ? 'yesterday' : `${f.daysOld} d ago`;
    q('fr-short').textContent = f.state === 'ended' ? 'Updates ended' : `${f.state === 'fresh' ? `Updated ${ago || 'recently'}` : 'Data delayed'} \u00b7 ${f.state === 'fresh' && !updating ? `next in ${shortT}` : shortT}`;
    const t = f.state === 'fresh' ? target : nextRun(now, refresh.schedule_utc);
    pill.title = `Next update: ${t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (your time) · ${t.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    for (const cb of subs) cb({ state: f.state, updating, countdown: cdText, short: shortT });
  };
  tick(); setInterval(tick, 1000);

  // popover (desktop) / bottom sheet (phones)
  let pop: HTMLElement | null = null;
  const closePop = (): void => { pop?.remove(); pop = null; pill.setAttribute('aria-expanded', 'false'); };
  pill.addEventListener('click', () => {
    if (matchMedia('(max-width: 640px)').matches) { pill.setAttribute('aria-expanded', 'true'); const close = openInfoSheet('Data freshness', info(refresh), pill); void close; pill.setAttribute('aria-expanded', 'false'); return; }
    if (pop) { closePop(); return; }
    pop = document.createElement('div'); pop.className = 'gloss-pop fresh-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Data freshness');
    pop.append(info(refresh)); document.body.append(pop);
    const r = pill.getBoundingClientRect(), w = Math.min(340, innerWidth - 16); pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`; pop.style.top = `${r.bottom + 8}px`;
    pill.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', (e) => { if (pop && !pop.contains(e.target as Node) && !pill.contains(e.target as Node)) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { closePop(); pill.focus(); } });
  addEventListener('scroll', closePop, { passive: true });
}
