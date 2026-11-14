/** Integer with thin-space thousands separators: 1234567 -> "1 234 567" (U+2009). */
export function fmtInt(x: number): string {
  if (!Number.isFinite(x)) return '–';
  const s = String(Math.abs(Math.round(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (x < 0 && Math.round(x) !== 0 ? '−' : '') + s;
}
