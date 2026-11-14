/** SI assistant: request/response contracts, validation and a tiny API client (fetch is injected, so tests can mock it). */
export type Lang = 'en' | 'ru' | 'tg';
export const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'ru', label: 'RU' }, { id: 'tg', label: 'TJ' }];
export type Facts = Record<string, string | number | null>;
export const FACT_KEY = /^[a-z0-9_]{1,40}$/;
export const MAX_FACTS = 40;
const MAX_STR = 200;

/** Keep at most 40 keys matching /^[a-z0-9_]{1,40}$/ with string, finite-number or null values. */
export function sanitizeFacts(raw: Record<string, unknown>): Facts {
  const out: Facts = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_FACTS) break;
    if (!FACT_KEY.test(k)) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_STR);
  }
  return out;
}
export interface AskBody { q: string; lang: Lang; area?: { name: string; facts: Facts } }
export function buildAskBody(q: string, lang: Lang, area?: { name: string; facts: Record<string, unknown> }): AskBody {
  const body: AskBody = { q: q.trim().slice(0, 500), lang };
  if (area) body.area = { name: area.name.slice(0, 100), facts: sanitizeFacts(area.facts) };
  return body;
}
export interface Source { title: string; section: string; url: string }
export interface Answer { answer: string; refused: boolean; reason: string | null; sources: Source[]; model: string | null; cached: boolean; disclosure: string | null }
const str = (x: unknown, max = 4000): string => (typeof x === 'string' ? x.slice(0, max) : '');
const httpsUrl = (u: unknown): string | null => { if (typeof u !== 'string') return null; try { const p = new URL(u); return p.protocol === 'https:' ? p.href : null; } catch { return null; } };
/** Validate an /ask response; anything unexpected is dropped, links must be https. */
export function parseAskResponse(j: unknown): Answer | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (typeof o.answer !== 'string' && o.refused !== true) return null;
  const sources: Source[] = [];
  if (Array.isArray(o.sources)) for (const s of o.sources.slice(0, 10)) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>, url = httpsUrl(r.url);
    if (typeof r.title === 'string' && r.title) sources.push({ title: str(r.title, 200), section: str(r.section, 200), url: url ?? '' });
  }
  return { answer: str(o.answer), refused: o.refused === true, reason: typeof o.reason === 'string' ? str(o.reason, 300) : null, sources, model: typeof o.model === 'string' ? str(o.model, 80) : null, cached: o.cached === true, disclosure: typeof o.disclosure === 'string' ? str(o.disclosure, 400) : null };
}

export interface NavAction { area?: string; yearFrom?: number; yearTo?: number; mode?: string; compare?: string | null }
export interface NavLimits { regionIds: string[]; firstYear: number; lastYear: number; modes: string[] }
const REGION = /^[A-Za-z0-9-]{2,20}$/;
/** Re-validate a /nav action on the client; invalid fields are dropped. Returns null when nothing usable is left. */
export function validateAction(a: unknown, lim: NavLimits): NavAction | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>, out: NavAction = {};
  if (typeof o.area === 'string' && REGION.test(o.area) && lim.regionIds.includes(o.area)) out.area = o.area;
  const yr = (v: unknown): number | undefined => (Number.isInteger(v) && (v as number) >= lim.firstYear && (v as number) <= lim.lastYear ? (v as number) : undefined);
  const y0 = yr(o.yearFrom), y1 = yr(o.yearTo);
  if (y0 !== undefined && y1 !== undefined) { if (y0 <= y1) { out.yearFrom = y0; out.yearTo = y1; } }
  else if (y0 !== undefined) out.yearFrom = y0; else if (y1 !== undefined) out.yearTo = y1;
  if (typeof o.mode === 'string' && lim.modes.includes(o.mode)) out.mode = o.mode;
  if (o.compare === null || o.compare === '') out.compare = null;
  else if (typeof o.compare === 'string' && REGION.test(o.compare) && lim.regionIds.includes(o.compare)) out.compare = o.compare;
  return Object.keys(out).length ? out : null;
}

export type ApiError = { kind: 'rate'; retryAfter: number | null } | { kind: 'network' } | { kind: 'bad' } | { kind: 'unconfigured' };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; json(): Promise<unknown> }>;
async function post(fetchImpl: FetchLike, base: string, path: string, body: unknown): Promise<ApiResult<unknown>> {
  if (!base) return { ok: false, error: { kind: 'unconfigured' } };
  try {
    const r = await fetchImpl(base.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) { const ra = Number(r.headers.get('retry-after')); return { ok: false, error: { kind: 'rate', retryAfter: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) : null } }; }
    if (!r.ok) return { ok: false, error: { kind: 'bad' } };
    return { ok: true, value: await r.json() };
  } catch (e) { return { ok: false, error: { kind: e instanceof SyntaxError ? 'bad' : 'network' } }; }
}
export async function ask(fetchImpl: FetchLike, base: string, body: AskBody): Promise<ApiResult<Answer>> {
  const r = await post(fetchImpl, base, '/ask', body);
  if (!r.ok) return r;
  const a = parseAskResponse(r.value);
  return a ? { ok: true, value: a } : { ok: false, error: { kind: 'bad' } };
}
export async function nav(fetchImpl: FetchLike, base: string, q: string, lim: NavLimits): Promise<ApiResult<{ action: NavAction | null; refused: boolean }>> {
  const r = await post(fetchImpl, base, '/nav', { q: q.trim().slice(0, 500) });
  if (!r.ok) return r;
  const o = r.value as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return { ok: false, error: { kind: 'bad' } };
  return { ok: true, value: { action: validateAction(o.action, lim), refused: o.refused === true } };
}
