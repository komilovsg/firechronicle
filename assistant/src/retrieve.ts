// Hybrid retrieval: cosine + BM25 fused by RRF, with exact-identifier pinning.
import { extractIdentifiers, tokenize } from "./tokenize.ts";

export interface Chunk {
  id: number;
  doc: string;
  title: string;
  section: string;
  url: string;
  text: string;
  embedding: number[];
  tokens: string[];
}

export interface Hit {
  chunk: Chunk;
  sim: number;
  vecRank: number | null;
  bm25Rank: number | null;
  rrf: number;
  pinned: boolean;
}

export interface RetrieveResult { hits: Hit[]; maxSim: number; pinnedCount: number; identifiers: string[] }

export type Mode = "vector" | "hybrid";

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export function bm25Scores(queryTokens: string[], docs: string[][], k1 = 1.5, b = 0.75): number[] {
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.length, 0) / (N || 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const qs = [...new Set(queryTokens)];
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const q of qs) {
      const f = tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    return s;
  });
}

/** Reciprocal rank fusion over rank maps (rank starts at 1). */
export function rrf(rankings: Map<number, number>[], k = 60): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rankings) for (const [id, rank] of r) out.set(id, (out.get(id) ?? 0) + 1 / (k + rank));
  return out;
}

function rankMap(scores: number[], positiveOnly: boolean): Map<number, number> {
  const idx = scores.map((s, i) => [s, i] as const).filter(([s]) => !positiveOnly || s > 0);
  idx.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return new Map(idx.map(([, i], r) => [i, r + 1]));
}

export function retrieve(
  query: string,
  queryEmbedding: number[],
  chunks: Chunk[],
  opts: { mode?: Mode; topK?: number; maxPinned?: number } = {},
): RetrieveResult {
  const mode = opts.mode ?? "hybrid";
  const topK = opts.topK ?? 4;
  const maxPinned = opts.maxPinned ?? 2;

  const sims = chunks.map((c) => cosine(queryEmbedding, c.embedding));
  const vecRanks = rankMap(sims, false);
  const bmScores = bm25Scores(tokenize(query), chunks.map((c) => c.tokens));
  const bmRanks = rankMap(bmScores, true);
  const fused = mode === "vector" ? rrf([vecRanks]) : rrf([vecRanks, bmRanks]);

  const qi = extractIdentifiers(query);
  const ids = qi.pin;
  const pinnedIdx: number[] = [];
  if (ids.length) {
    const set = ids;
    // When the query holds a product code / DOI / date, only chunks containing one of those pin;
    // satellite names alone pin only when there is no stronger identifier.
    const pinIds = qi.strong.length ? qi.strong : set;
    const matching = chunks.map((c, i) => [c, i] as const).filter(([c]) => {
      const tk = new Set(c.tokens);
      return pinIds.some((id) => tk.has(id));
    });
    // Chunks holding a product code / DOI / date outrank chunks matching only a satellite name.
    const isStrong = (c: Chunk) => { const tk = new Set(c.tokens); return qi.strong.some((id) => tk.has(id)); };
    matching.sort(
      (a, b) =>
        Number(isStrong(b[0])) - Number(isStrong(a[0])) ||
        (fused.get(b[1]) ?? 0) - (fused.get(a[1]) ?? 0) ||
        a[1] - b[1],
    );
    for (const [, i] of matching.slice(0, maxPinned)) pinnedIdx.push(i);
  }

  const order = chunks.map((_, i) => i).sort((a, b) => (fused.get(b) ?? 0) - (fused.get(a) ?? 0) || a - b);
  const final: number[] = [...pinnedIdx];
  for (const i of order) { if (final.length >= topK) break; if (!final.includes(i)) final.push(i); }

  const hits: Hit[] = final.map((i) => ({
    chunk: chunks[i],
    sim: sims[i],
    vecRank: vecRanks.get(i) ?? null,
    bm25Rank: bmRanks.get(i) ?? null,
    rrf: fused.get(i) ?? 0,
    pinned: pinnedIdx.includes(i),
  }));
  return { hits, maxSim: sims.length ? Math.max(...sims) : 0, pinnedCount: pinnedIdx.length, identifiers: ids };
}
