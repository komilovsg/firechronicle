import { el } from './ui/dom';
import { loadTle } from './data';
import { makeRec, subPoint, groundTrack, swathRings, nextPasses, type Tle, type TleSat, type LL } from './lib/orbits';
import type { SatFrame, FireMap } from './map';
import type { SatRec } from '../node_modules/satellite.js/dist/propagation/SatRec.js';

export interface SatsDeps {
  getMap(): FireMap | undefined; host(): HTMLElement; centroid(): LL | null; areaName(): string;
  ended(id: string): boolean; colors(): { modis: string; viirs: string };
}
const SENSOR: Record<string, 'modis' | 'viirs'> = { terra: 'modis', aqua: 'modis', snpp: 'viirs', n20: 'viirs', n21: 'viirs' };
const GREY = '#8996a7';
const hm = (d: Date): string => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const rel = (ms: number): string => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60} min`; };
const dayLab = (d: Date, now: Date): string => (d.toDateString() === now.toDateString() ? '' : ` ${d.toLocaleDateString([], { weekday: 'short' })}`);

/** The "Satellites" map layer: SGP4 positions, ground tracks, swath bands and the next passes over the selected area. Computes only while on. */
export function initSats(d: SatsDeps): { toggle(): void; onArea(): void; isOn(): boolean } {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let on = false, mode: 'live' | 'x60' = 'live', tle: Tle | null = null, recs = new Map<string, SatRec>(), timer = 0, panel: HTMLElement | null = null;
  let realBase = 0, simBase = 0, cache: { t: number; tracks: SatFrame['tracks']; swaths: SatFrame['swaths'] } | null = null, passesAt = 0, hidden = false;
  const now = (): number => (mode === 'live' ? Date.now() : simBase + (Date.now() - realBase) * 60);
  const color = (s: TleSat): string => (d.ended(s.id) ? GREY : d.colors()[SENSOR[s.id] ?? 'viirs']);

  const frame = (): void => {
    const map = d.getMap(); if (!map || !tle) return;
    const t = now(), date = new Date(t), sats: SatFrame['sats'] = [];
    const heavy = !cache || Math.abs(t - cache.t) > 90000;
    const tracks: SatFrame['tracks'] = heavy ? [] : cache!.tracks, swaths: SatFrame['swaths'] = heavy ? [] : cache!.swaths;
    for (const s of tle.satellites) {
      const rec = recs.get(s.id); if (!rec) continue;
      const p = subPoint(rec, date); if (!p) continue;
      sats.push({ id: s.id, name: s.name, lon: p.lon, lat: p.lat, color: color(s), ended: d.ended(s.id) });
      if (heavy && !d.ended(s.id)) {
        const segs = groundTrack(rec, date, 50, 50, 30);
        tracks.push({ id: s.id, color: color(s), lines: segs.map((g) => g.map((q) => [q.lon, q.lat] as [number, number])) });
        swaths.push({ id: s.id, color: color(s), rings: segs.flatMap((g) => swathRings(g, s.swath_km).map((r) => r.map((q) => [q.lon, q.lat] as [number, number]))) });
      }
    }
    if (heavy) cache = { t, tracks, swaths };
    map.setSatellites({ sats, tracks, swaths });
    const clock = panel?.querySelector('.sat-clock'); if (clock) clock.textContent = mode === 'x60' ? `Simulated ${date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ×60` : `Live ${hm(date)}`;
    if (Date.now() - passesAt > 300000) renderPasses();
  };
  const restart = (): void => { clearInterval(timer); if (!on || hidden) return; frame(); timer = window.setInterval(frame, mode === 'live' ? 2000 : 100); };
  const renderPasses = (): void => {
    passesAt = Date.now(); const box = panel?.querySelector<HTMLElement>('.sat-passes'); if (!box || !tle) return;
    box.textContent = '';
    const c = d.centroid(); box.append(el('h4', undefined, `Next passes over ${d.areaName()}`));
    if (!c) { box.append(el('p', 'muted', 'Pick an area to see passes.')); return; }
    const t0 = new Date(), ul = el('ul');
    for (const s of tle.satellites) {
      const li = el('li'); const dot = el('i'); dot.style.background = color(s); li.append(dot, el('b', undefined, s.name));
      if (d.ended(s.id)) { li.append(el('span', 'muted', 'ended')); ul.append(li); continue; }
      const rec = recs.get(s.id), ps = rec ? nextPasses(rec, c, t0, s.swath_km, 24).slice(0, 2) : [];
      li.append(el('span', undefined, ps.length ? ps.map((p) => `${hm(p.time)}${dayLab(p.time, t0)} (${rel(p.time.getTime() - t0.getTime())})`).join(' · ') : 'none in 24 h'));
      ul.append(li);
    }
    box.append(ul);
  };
  const build = (): HTMLElement => {
    const p = el('section', 'sat-panel'); p.setAttribute('aria-label', 'Satellites');
    const head = el('div', 'sat-head'); head.append(el('b', undefined, 'Satellites'));
    const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Time');
    for (const [m, t] of [['live', 'LIVE'], ['x60', '×60']] as const) {
      const b = el('button', undefined, t) as HTMLButtonElement; b.type = 'button'; b.dataset.mode = m; b.setAttribute('aria-pressed', String(m === mode));
      if (m === 'x60' && reduce) { b.disabled = true; b.title = 'Time-lapse is off because reduced motion is requested'; }
      b.addEventListener('click', () => { if (m === mode) return; mode = m; if (m === 'x60') { realBase = Date.now(); simBase = Date.now(); } cache = null; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.mode === mode))); restart(); });
      seg.append(b);
    }
    const x = el('button', 'sat-x', '×') as HTMLButtonElement; x.type = 'button'; x.setAttribute('aria-label', 'Hide satellites'); x.addEventListener('click', () => api.toggle());
    head.append(seg, x);
    const clock = el('p', 'sat-clock muted'); clock.setAttribute('aria-hidden', 'true');
    const lg = el('ul', 'sat-leg'); for (const [c, t] of [[d.colors().modis, 'MODIS (Terra, Aqua)'], [d.colors().viirs, 'VIIRS (NOAA-20, -21)'], [GREY, 'Ended (Suomi NPP)']] as const) { const li = el('li'); const dot = el('i'); dot.style.background = c; li.append(dot, t); lg.append(li); }
    const passes = el('div', 'sat-passes');
    const note = el('p', 'sat-note', `Orbits: CelesTrak TLE, fetched ${tle ? tle.fetched_at.slice(0, 10) : 'n/a'}. Positions are SGP4 estimates.`);
    p.append(head, clock, lg, passes, note); return p;
  };
  const place = (): void => {
    if (!panel) return;
    const drawer = document.querySelector<HTMLElement>('#mdrawer .md-half');
    (matchMedia('(max-width: 640px)').matches && drawer ? drawer : d.host()).append(panel);
  };
  const api = {
    toggle(): void {
      const map = d.getMap(); if (!map) return;
      if (on) { on = false; clearInterval(timer); map.setSatellites(null); map.setSatPressed(false); panel?.remove(); panel = null; cache = null; return; }
      void (async () => {
        if (!tle) {
          tle = await loadTle();
          if (!tle) { const m = el('div', 'sat-panel'); m.append(el('p', undefined, 'Orbit data is unavailable right now.')); d.host().append(m); setTimeout(() => m.remove(), 3000); return; }
          for (const s of tle.satellites) try { recs.set(s.id, makeRec(s)); } catch { /* bad element set */ }
        }
        on = true; map.setSatPressed(true); panel = build(); place(); renderPasses(); restart();
      })();
    },
    onArea(): void { if (on) { passesAt = 0; renderPasses(); } },
    isOn: (): boolean => on,
  };
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; restart(); });
  matchMedia('(max-width: 640px)').addEventListener('change', place);
  return api;
}
