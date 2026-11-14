export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Month index: t = 0 is 2000-01. m is 1..12. */
export const tFromYM = (y: number, m: number): number => (y - 2000) * 12 + (m - 1);
export const yearOf = (t: number): number => 2000 + Math.floor(t / 12);
/** 1..12 */
export const monthOf = (t: number): number => (((t % 12) + 12) % 12) + 1;
const pad2 = (n: number): string => String(n).padStart(2, '0');
export const tLabel = (t: number): string => `${yearOf(t)}-${pad2(monthOf(t))}`;
export function parseTLabel(s: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12 || y < 2000) return null;
  return tFromYM(y, mo);
}
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** "2012-01-20" -> t, or null */
export function tFromDate(s: string): number | null {
  return parseTLabel(s.slice(0, 7));
}
