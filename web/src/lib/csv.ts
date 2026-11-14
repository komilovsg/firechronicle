const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** One CSV field. Numbers pass through (negatives are not prefixed). Non-numeric strings starting with = + - @ TAB CR get a leading apostrophe. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v;
  if (!NUMERIC.test(s) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csvRow = (cells: (string | number | null | undefined)[]): string => cells.map(csvCell).join(',');
export const buildCsv = (header: string[], rows: (string | number | null | undefined)[][]): string =>
  [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
