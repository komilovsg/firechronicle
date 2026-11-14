// Live data-derived chunks: fetch the published data files, regenerate the facts chunks with the
// same generator used at build time and swap their text (and BM25 tokens) into the index.
// Build-time embeddings are kept.
import { buildFactsDocs } from "./facts.ts";
import { tokenize } from "./tokenize.ts";
import type { Chunk } from "./retrieve.ts";

const BASE = "https://komilovsg.github.io/firechronicle/data/";
export const LIVE_URLS = { meta: `${BASE}meta.json`, regions: `${BASE}regions.json`, partial: `${BASE}partial.json` } as const;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 15 * 1024 * 1024;
export const CHECK_EVERY_MS = 15 * 60_000;
export const CACHE_TTL_S = 3600;

export interface FactsStatus { source: "live" | "baked"; generated_at: string | null; data_through: string | null; cached_until: string | null; error?: string }
export interface LiveData { meta: any; regions: any[]; partial: any | null }

/** Replace text and tokens of chunks matched by (docId, section); keep embeddings; skip unknown sections. */
export function applyFacts(base: Chunk[], data: LiveData): Chunk[] {
  const facts = buildFactsDocs(data.meta, data.regions, data.partial);
  const map = new Map(facts.map((f) => [`${f.docId}|${f.section}`, f.text]));
  return base.map((c) => {
    const text = map.get(`${c.doc}|${c.section}`);
    return text !== undefined && (c as Chunk & { live?: boolean }).live ? { ...c, text, tokens: tokenize(text) } : c;
  });
}

async function fetchJson(url: string, optional = false): Promise<any | null> {
  if (!Object.values(LIVE_URLS).includes(url as never)) throw new Error("url not allowed"); // fixed list only
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "manual" });
    if (r.status === 404 && optional) return null;
    if (!r.ok) throw new Error(`status ${r.status}`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("too large");
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error("too large");
    return JSON.parse(new TextDecoder().decode(buf));
  } finally { clearTimeout(timer); }
}

interface Cached { generated_at: string; data_through: string | null; meta: any; regions: any[]; partial: any | null; stored: number }

let lastError: string | undefined;
let memo: { data: LiveData; status: FactsStatus; checkedAt: number } | null = null;

export function validLive(d: any): d is LiveData {
  return !!d && typeof d.meta === "object" && d.meta !== null && Array.isArray(d.regions) && d.regions.every((r: any) => Array.isArray(r?.t) && Array.isArray(r?.harm));
}

/** Returns live data when available; null means: use the baked text. */
export async function getLiveFacts(kv: KVNamespace, now = Date.now()): Promise<{ data: LiveData | null; status: FactsStatus; stale: boolean }> {
  if (memo && now - memo.checkedAt < CHECK_EVERY_MS) return { data: memo.data, status: memo.status, stale: false };
  try {
    const cachedRaw = (await kv.get("facts:current", "json")) as Cached | null;
    // re-check the small meta file; reuse cached regions/partial when generated_at is unchanged
    const meta = await fetchJson(LIVE_URLS.meta);
    let data: LiveData;
    if (cachedRaw && cachedRaw.generated_at === meta?.generated_at && validLive(cachedRaw)) {
      data = { meta, regions: cachedRaw.regions, partial: cachedRaw.partial };
    } else {
      const regionsFile = await fetchJson(LIVE_URLS.regions);
      const partial = await fetchJson(LIVE_URLS.partial, true);
      data = { meta, regions: regionsFile?.regions, partial };
      if (!validLive(data)) throw new Error("invalid live data");
      const rec: Cached = { generated_at: meta.generated_at, data_through: meta.data_through ?? null, ...data, stored: now };
      await kv.put("facts:current", JSON.stringify(rec), { expirationTtl: CACHE_TTL_S });
    }
    const status: FactsStatus = {
      source: "live", generated_at: meta.generated_at ?? null, data_through: meta.data_through ?? null,
      cached_until: new Date(now + CACHE_TTL_S * 1000).toISOString(),
    };
    memo = { data, status, checkedAt: now };
    return { data, status, stale: false };
  } catch (e) {
    lastError = String((e as Error)?.message ?? e).slice(0, 80);
    // fall back to cached copy if any, else baked text
    try {
      const c = (await kv.get("facts:current", "json")) as Cached | null;
      if (c && validLive(c)) {
        const status: FactsStatus = { source: "live", generated_at: c.generated_at, data_through: c.data_through, cached_until: null };
        return { data: { meta: c.meta, regions: c.regions, partial: c.partial }, status, stale: true };
      }
    } catch { /* ignore */ }
    return { data: null, status: { source: "baked", generated_at: null, data_through: null, cached_until: null, error: lastError }, stale: true };
  }
}
