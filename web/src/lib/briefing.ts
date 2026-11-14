import { annualTotals, climatology, detectSeason, monthRanges, type Span } from './analytics';
import { MONTH_ABBR } from './time';
import { median } from './stats';
import type { Source } from './assistant';

const ISO_IN_SECTION = /\(([A-Z]{3})\)\s*$/;
/** Region ISO3 cited by a source section such as "Tajikistan (TJK)", or null. */
export function regionOf(sources: Source[]): string | null {
  for (const s of sources) { const m = ISO_IN_SECTION.exec(s.section); if (m) return m[1]; }
  return null;
}
export type Topic = string; // an ISO3, or METHOD | SATELLITES | DATA | LIMITS | VALIDATION | GENERAL
/** Card topic: the region when a region source is cited, else the short name of the cited document. */
export function topicOf(sources: Source[]): Topic {
  const iso = regionOf(sources); if (iso) return iso;
  const hay = sources.map((s) => `${s.title} ${s.section}`).join(' ').toLowerCase();
  if (/limit/.test(hay)) return 'LIMITS';
  if (/validat|accura|cross-valid|independent|bias/.test(hay)) return 'VALIDATION';
  if (/harmoni|calibrat|method|how the series/.test(hay)) return 'METHOD';
  if (/satellite|sensor|modis|viirs|hotspot|instrument/.test(hay)) return 'SATELLITES';
  if (/data|source|access|file|dataset/.test(hay)) return 'DATA';
  return 'GENERAL';
}
/** Whether a validation chip row applies (only when the cited section is about validation). */
export const isValidationCited = (sources: Source[]): boolean => sources.some((s) => /validat|accura|cross-valid|independent/i.test(`${s.title} ${s.section}`));

export interface Citation { n: number; label: string; title: string; section: string; url: string }
/** One numbered citation per source, in order. */
export function numberCitations(sources: Source[]): Citation[] {
  return sources.map((s, i) => ({ n: i + 1, label: s.section ? `${s.title} · ${s.section}` : s.title, title: s.title, section: s.section, url: s.url }));
}

export interface DataModule {
  chips: { k: string; v: string }[];
  /** 12 cells: share of the strongest month's median (0..1) and whether the month is in season. */
  months: { share: number; inSeason: boolean; label: string }[];
  spark: { years: number[]; totals: number[]; latest: number } | null;
}
const sgn = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}%`;
/** Deterministic data module from a harmonized monthly series, using the same functions as the page summary. */
export function buildDataModule(arr: ArrayLike<number>, sp: Span, y0: number, y1: number): DataModule | null {
  const cl = climatology(arr, y0, y1, sp), season = detectSeason(cl.median);
  const at = annualTotals(arr, y0, y1, sp);
  if (!season && at.length < 3) return null;
  const maxMed = Math.max(0, ...cl.median.filter(Number.isFinite));
  const inSeason = new Set(season?.months ?? []);
  const months = MONTH_ABBR.map((m, i) => ({ share: maxMed > 0 && Number.isFinite(cl.median[i]) ? cl.median[i] / maxMed : 0, inSeason: inSeason.has(i + 1), label: m }));
  const chips: { k: string; v: string }[] = [];
  if (season) { chips.push({ k: 'SEASON', v: monthRanges(season.months).join(' · ') }); chips.push({ k: 'PEAK', v: MONTH_ABBR[season.peak - 1] }); }
  let spark: DataModule['spark'] = null;
  if (at.length >= 3) {
    const med = median(at.map((a) => a.total)), last = at[at.length - 1];
    if (med > 0) chips.push({ k: `${last.year} vs MEDIAN`, v: sgn((last.total / med - 1) * 100) });
    spark = { years: at.map((a) => a.year), totals: at.map((a) => a.total), latest: last.total };
  }
  return { chips, months, spark };
}
/** Validation chips from meta.validation (region-by-month leave-one-year-out for S-NPP); empty when the numbers are missing. */
export function validationChips(v: unknown): { k: string; v: string }[] {
  const get = (...p: string[]): unknown => p.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), v);
  const r2 = get('cv', 'snpp', 'country_month', 'r2'), bias = get('cv', 'snpp', 'region_month', 'bias_pct');
  const out: { k: string; v: string }[] = [];
  if (typeof r2 === 'number' && Number.isFinite(r2)) out.push({ k: 'R²', v: r2.toFixed(3) });
  if (typeof bias === 'number' && Number.isFinite(bias)) out.push({ k: 'BIAS', v: `${bias < 0 ? '−' : bias > 0 ? '+' : ''}${Math.abs(bias).toFixed(2)}%` });
  return out;
}
/** Telemetry strip text for the area: ISO3, CA for the whole region, CUSTOM otherwise. */
export const areaCode = (kind: 'region' | 'polygon' | 'circle', id?: string): string => (kind !== 'region' ? 'CUSTOM' : id === 'central-asia' ? 'CA' : (id ?? 'CA'));

/** First sentence of an answer (up to the first ". " / "! " / "? "), for compact preview cards. */
export function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^(.+?[.!?])(?=\s[A-Z0-9\u0400-\u04ff]|$)/.exec(t);
  return m ? m[1] : t;
}
