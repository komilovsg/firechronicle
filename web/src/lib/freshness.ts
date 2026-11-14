/** Data-freshness logic (pure: every function takes `now`). */
export interface Refresh { schedule_utc: string; cadence: string; auto_update_until: string; issues_url: string }
export const DEFAULT_REFRESH: Refresh = { schedule_utc: '03:00', cadence: 'daily', auto_update_until: '2027-05-15', issues_url: 'https://github.com/komilovsg/firechronicle/issues' };
export const STALE_DAYS = 3;
const DAY = 86400000;

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
/** meta.refresh with safe fallbacks for missing or malformed fields. */
export function parseRefresh(raw: unknown): Refresh {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sched = typeof r.schedule_utc === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.schedule_utc) ? r.schedule_utc : DEFAULT_REFRESH.schedule_utc;
  return {
    schedule_utc: sched,
    cadence: typeof r.cadence === 'string' && r.cadence ? r.cadence : DEFAULT_REFRESH.cadence,
    auto_update_until: isDate(r.auto_update_until) ? r.auto_update_until : DEFAULT_REFRESH.auto_update_until,
    issues_url: typeof r.issues_url === 'string' && /^https:\/\//.test(r.issues_url) ? r.issues_url : DEFAULT_REFRESH.issues_url,
  };
}
/** The next HH:MM UTC strictly after `now`. */
export function nextRun(now: Date, scheduleUtc: string): Date {
  const [h, m] = scheduleUtc.split(':').map(Number);
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0);
  return new Date(t > now.getTime() ? t : t + DAY);
}
export type FreshState = 'fresh' | 'stale' | 'ended';
export interface Freshness { state: FreshState; daysOld: number | null }
const utcDay = (d: Date): number => Math.floor(d.getTime() / DAY);
/** ended: today (UTC) is after auto_update_until. stale: data_through more than 3 days old. */
export function freshness(now: Date, dataThrough: string | null | undefined, refresh: Refresh): Freshness {
  const daysOld = isDate(dataThrough) ? utcDay(now) - Math.floor(Date.parse(dataThrough + 'T00:00:00Z') / DAY) : null;
  if (utcDay(now) > Math.floor(Date.parse(refresh.auto_update_until + 'T00:00:00Z') / DAY)) return { state: 'ended', daysOld };
  return { state: daysOld === null || daysOld > STALE_DAYS ? 'stale' : 'fresh', daysOld };
}
const p2 = (n: number): string => String(n).padStart(2, '0');
/** 25965000 ms -> "07:12:45" */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
}
/** Compact form for phones: "7h" or "12m". */
export function shortCountdown(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h` : `${Math.max(1, m)}m`;
}
