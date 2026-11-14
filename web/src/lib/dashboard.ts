import { median } from './stats';
import { daysInMonth, MONTH_ABBR, monthOf } from './time';
import type { Season } from './analytics';

export interface RecentRegion { harm: number[]; median: number[]; p10?: number[]; p90?: number[] }
export interface Recent { days: string[]; window_days: number; baseline_years?: string; regions: Record<string, RecentRegion> }

/** Validate the optional recent.json; null = unusable. */
export function parseRecent(j: unknown): Recent | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Partial<Recent>;
  if (!Array.isArray(o.days) || !o.days.length || !o.regions || typeof o.regions !== 'object') return null;
  const w = Number.isFinite(o.window_days) && (o.window_days as number) > 0 ? Math.floor(o.window_days as number) : 7;
  const regions: Record<string, RecentRegion> = {};
  for (const [k, r] of Object.entries(o.regions)) {
    if (r && Array.isArray(r.harm) && Array.isArray(r.median) && r.harm.length === o.days.length && r.median.length === o.days.length) regions[k] = r;
  }
  return Object.keys(regions).length ? { days: o.days, window_days: w, baseline_years: o.baseline_years, regions } : null;
}
const sum = (a: ArrayLike<number>, from: number): number => { let s = 0; for (let i = from; i < a.length; i++) s += Number.isFinite(a[i]) ? a[i] : 0; return s; };
export interface Last7 { value: number; median: number; pct: number; days: string[]; harm: number[] }
/** Last `window_days` of the daily series vs the sum of the daily medians over the same days. */
export function last7(rec: Recent | null, key: string): Last7 | null {
  const r = rec?.regions[key]; if (!rec || !r) return null;
  const from = Math.max(0, r.harm.length - rec.window_days);
  const value = sum(r.harm, from), med = sum(r.median, from);
  return { value, median: med, pct: med > 0 ? (value / med - 1) * 100 : NaN, days: rec.days, harm: r.harm };
}

export type Dir = 'up' | 'down' | 'flat';
export interface Delta { text: string; dir: Dir }
/** Delta chip: arrow + rounded percent; within +-3 % counts as flat. */
export function deltaChip(pct: number | null | undefined): Delta | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const r = Math.round(Math.abs(pct));
  if (r < 3) return { text: '→ about normal', dir: 'flat' };
  return pct > 0 ? { text: `↑ ${r}%`, dir: 'up' } : { text: `↓ ${r}%`, dir: 'down' };
}

export interface SeasonStatus { inSeason: boolean; label: string; sub: string }
/** "IN SEASON · day N of ~M" (contiguous run of season months around today) or "OFF SEASON · next: Apr". */
export function seasonStatus(season: Season | null, month: number, day: number, year: number): SeasonStatus | null {
  if (!season || !season.months.length) return null;
  const set = new Set(season.months);
  if (set.has(month)) {
    let start = month; for (let i = 0; i < 12 && set.has(((start + 10) % 12) + 1); i++) start = ((start + 10) % 12) + 1;
    const k = (month - start + 12) % 12, y0 = start <= month ? year : year - 1;
    let n = 0, len = 0;
    for (let i = 0; i < 12; i++) {
      const m = ((start - 1 + i) % 12) + 1; if (!set.has(m)) break;
      const d = daysInMonth(y0 + Math.floor((start - 1 + i) / 12), m); len += d;
      if (i < k) n += d; else if (i === k) n += day;
    }
    return { inSeason: true, label: 'IN SEASON', sub: `day ${n} of ~${len}` };
  }
  let next = month; for (let i = 0; i < 12; i++) { next = (next % 12) + 1; if (set.has(next)) break; }
  return { inSeason: false, label: 'OFF SEASON', sub: `next: ${MONTH_ABBR[next - 1]}` };
}

export type SensorState = 'active' | 'ended';
export interface SensorRow { key: string; label: string; state: SensorState; text: string; note: string }
/** ENDED when the sensor's end date is more than 7 days before data_through. */
export function sensorStatus(sensors: Record<string, { label: string; start: string; end: string }>, dataThrough: string | null | undefined): SensorRow[] {
  const dt = dataThrough ? Date.parse(dataThrough + 'T00:00:00Z') : NaN;
  const fmtD = (s: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${+m[3]} ${MONTH_ABBR[+m[2] - 1]} ${m[1]}` : s; };
  return (['modis', 'snpp', 'n20', 'n21'] as const).filter((k) => sensors[k]).map((k) => {
    const s = sensors[k], end = Date.parse(s.end + 'T00:00:00Z');
    const ended = Number.isFinite(dt) && Number.isFinite(end) && end < dt - 7 * 864e5;
    return { key: k, label: s.label.replace(/\s*\(Terra\+Aqua\)/, ' Terra/Aqua'), state: ended ? 'ended' : 'active', text: ended ? `ENDED ${fmtD(s.end)}` : 'ACTIVE', note: !ended && k === 'modis' ? 'retiring 2026–27' : '' } as SensorRow;
  });
}

/** Same-days history of one region from partial.json for the current partial month, or null. */
export function regionHist(p: { t_month: number; regions?: Record<string, { t: number[]; harm: number[] }> } | null, tLast: number, id: string): { t: number[]; v: number[] } | null {
  if (!p || p.t_month !== tLast) return null;
  const r = p.regions?.[id]; return r ? { t: r.t, v: r.harm } : null;
}

export type Status = 'extreme' | 'above' | 'normal' | 'below';
export function statusOf(rank: number): Status | null {
  if (!Number.isFinite(rank)) return null;
  return rank >= 95 ? 'extreme' : rank >= 75 ? 'above' : rank <= 25 ? 'below' : 'normal';
}
export const STATUS_LABEL: Record<Status, string> = { extreme: 'Extreme', above: 'Above', normal: 'Normal', below: 'Below' };
export interface CountryRow { id: string; name: string; value: number; pct: number; ytd: number; trend: number[]; rank: number; status: Status | null }
export type SortKey = 'name' | 'value' | 'pct' | 'ytd' | 'rank';
/** Stable sort; non-finite values always last, in either direction. */
export function sortRows(rows: CountryRow[], key: SortKey, dir: 1 | -1): CountryRow[] {
  const val = (r: CountryRow): number | string => (key === 'name' ? r.name : r[key]);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = val(a.r), y = val(b.r);
    const bx = typeof x === 'number' && !Number.isFinite(x), by = typeof y === 'number' && !Number.isFinite(y);
    if (bx || by) return bx === by ? a.i - b.i : bx ? 1 : -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c * dir || a.i - b.i;
  }).map((o) => o.r);
}

/** Cells with detections in `tNow` vs the median across earlier years (same-days history). Row arrays are sparse (c, t, harm). */
export function activeCells(rows: { c: ArrayLike<number>; t: ArrayLike<number>; harm: ArrayLike<number> }, mask: Uint8Array, tNow: number, hist: { c: ArrayLike<number>; t: ArrayLike<number>; harm: ArrayLike<number> } | null): { value: number; median: number; pct: number } | null {
  if (!hist) return null;
  let value = 0;
  for (let i = 0; i < rows.c.length; i++) if (rows.t[i] === tNow && mask[rows.c[i]] && rows.harm[i] > 0) value++;
  const m = monthOf(tNow), by = new Map<number, number>();
  for (let i = 0; i < hist.c.length; i++) { const t = hist.t[i]; if (t < tNow && monthOf(t) === m && mask[hist.c[i]] && hist.harm[i] > 0) by.set(t, (by.get(t) ?? 0) + 1); }
  const years = new Set<number>(); for (let i = 0; i < hist.c.length; i++) if (hist.t[i] < tNow && monthOf(hist.t[i]) === m) years.add(hist.t[i]);
  if (!years.size) return null;
  const med = median([...years].map((t) => by.get(t) ?? 0));
  return { value, median: med, pct: med > 0 ? (value / med - 1) * 100 : NaN };
}
