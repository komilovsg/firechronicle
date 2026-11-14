/** Safe readers for meta.validation: any field may be missing; never print "undefined" or "NaN". */
export const DASH = '—';
export function pick(o: unknown, ...path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) { if (cur === null || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; }
  return cur;
}
export const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
export const str = (x: unknown): string | null => (typeof x === 'string' && x.length ? x : null);
export function fmtNum(x: unknown, digits = 1, suffix = ''): string {
  const n = num(x);
  return n === null ? DASH : `${n.toFixed(digits)}${suffix}`;
}
export function fmtSigned(x: unknown, digits = 1, suffix = ''): string {
  const n = num(x);
  if (n === null) return DASH;
  const s = Math.abs(n).toFixed(digits);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${s}${suffix}`;
}
/** jump_ratio 1.6 -> "+60%", 0.46 -> "−54%" */
export function jumpPct(ratio: unknown): string {
  const r = num(ratio);
  return r === null ? DASH : fmtSigned((r - 1) * 100, 0, '%');
}
export function fmtP(p: unknown): string {
  const n = num(p);
  if (n === null) return DASH;
  return n < 0.001 ? '< 0.001' : n.toPrecision(2);
}
export interface Headline { naive: string; modis: string; harm: string; naiveCp: string | null; harmCp: string | null; modisCp: string | null }
export function headline(v: unknown): Headline {
  return {
    naive: jumpPct(pick(v, 'naive_break_2012', 'jump_ratio')),
    modis: jumpPct(pick(v, 'modis_only_reference', 'jump_ratio')),
    harm: jumpPct(pick(v, 'harmonized_break_2012', 'jump_ratio')),
    naiveCp: str(pick(v, 'naive_break_2012', 'change_point')),
    harmCp: str(pick(v, 'harmonized_break_2012', 'change_point')),
    modisCp: str(pick(v, 'modis_only_reference', 'change_point')),
  };
}
export interface CvRow { sensor: string; years: string; bias: string; mae: string; r2: string; n: string }
const SENSORS: [string, string][] = [['snpp', 'S-NPP'], ['n20', 'NOAA-20'], ['n21', 'NOAA-21']];
/** Region-month cross-validation per VIIRS sensor, in display strings. */
export function cvRows(v: unknown): CvRow[] {
  return SENSORS.map(([k, label]) => {
    const rm = pick(v, 'cv', k, 'region_month');
    return { sensor: label, years: str(pick(v, 'cv', k, 'years')) ?? DASH, bias: fmtSigned(pick(rm, 'bias_pct'), 2, '%'), mae: fmtNum(pick(rm, 'mae'), 0), r2: fmtNum(pick(rm, 'r2'), 3), n: fmtNum(pick(rm, 'n'), 0) };
  }).filter((r) => r.bias !== DASH || r.mae !== DASH || r.r2 !== DASH);
}
export function notes(v: unknown): string[] {
  const n = pick(v, 'notes');
  return Array.isArray(n) ? n.filter((x): x is string => typeof x === 'string') : [];
}
/** "2011-01" -> decimal year position on a year axis (start of month + a small offset to centre on the month). */
export function cpToX(cp: string | null): number | null {
  const m = cp ? /^(\d{4})-(\d{2})$/.exec(cp) : null;
  return m ? +m[1] + (+m[2] - 1) / 12 + 1 / 24 : null;
}

/** cv.<sensor>.per_year_bias_pct = {"2013": x, ...} -> sorted [{year, bias}] (invalid entries dropped). */
export function perYearBias(v: unknown, sensor: string): { year: number; bias: number }[] {
  const m = pick(v, 'cv', sensor, 'per_year_bias_pct');
  if (m === null || typeof m !== 'object') return [];
  return Object.entries(m as Record<string, unknown>)
    .map(([y, b]) => ({ year: Number(y), bias: num(b) }))
    .filter((r): r is { year: number; bias: number } => Number.isInteger(r.year) && r.bias !== null)
    .sort((a, b) => a.year - b.year);
}
/** Independent check: country-month R\u00b2 of the VIIRS S-NPP prediction vs a seasonal-climatology baseline. */
export function independentCheck(v: unknown): { r2: string; baseline: string } {
  return { r2: fmtNum(pick(v, 'cv', 'snpp', 'country_month', 'r2'), 3), baseline: fmtNum(pick(v, 'cv', 'snpp', 'climatology_r2'), 3) };
}
