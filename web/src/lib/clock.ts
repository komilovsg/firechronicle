/** `?now=YYYY-MM-DD` fakes the clock for testing the freshness states. Strictly validated, never stored. */
export function parseNow(search: string): Date | null {
  const v = new URLSearchParams(search).get('now');
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T12:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}
const base = typeof location !== 'undefined' ? parseNow(location.search) : null, t0 = Date.now();
/** Current time; with ?now= the clock starts at noon UTC of that day and keeps ticking. */
export const nowDate = (): Date => (base ? new Date(base.getTime() + (Date.now() - t0)) : new Date());
