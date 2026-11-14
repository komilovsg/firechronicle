// Tokenizer and identifier extraction. Pure, no runtime dependencies.
// Node can import this file directly (type stripping), so build-index.mjs
// and the Worker share exactly one implementation.

export const STOPWORDS = new Set(
  ("a an the and or but if of to in on at by for from with as is are was were be been being it its this that these those " +
    "i you he she we they me my your our their what which who whom how when where why do does did can could should would " +
    "will shall may might must not no yes so than then there here about into over under between per also just only very " +
    "use used using").split(/\s+/),
);

export type IdKind = "doi" | "date" | "sat" | "code";
export interface Ident { kind: IdKind; norm: string; raw: string }

// Alternation order matters: doi | date | satellite | code | word.
const TOKEN_RE =
  /(10\.\d{4,9}\/[^\s,;()"'<>]*[^\s,;()"'<>.])|(\b\d{4}-\d{2}(?:-\d{2})?\b)|(\bnoaa[-_ ]?\d{2}\b|\bsuomi[-_ ]?npp\b|\bs[-_ ]npp\b|\bsnpp\b)|(\b(?:vnp|vj[12])[-_ ]?14[-_ ]?img\b|\b[a-z]{2,}\d+(?:[-_][a-z0-9]+)*[a-z0-9]*\b)|([a-z0-9]+(?:\.\d+)?)/gi;

const stripSep = (s: string) => s.toLowerCase().replace(/[-_ ]/g, "");

function normSat(raw: string): string {
  const s = stripSep(raw);
  return s.includes("npp") ? "snpp" : s;
}

export interface Tokenized { tokens: string[]; idents: Ident[] }

export function tokenizeFull(text: string): Tokenized {
  const tokens: string[] = [];
  const idents: Ident[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1]) { const n = m[1].toLowerCase(); tokens.push(n); idents.push({ kind: "doi", norm: n, raw: m[1] }); }
    else if (m[2]) { tokens.push(m[2]); idents.push({ kind: "date", norm: m[2], raw: m[2] }); }
    else if (m[3]) { const n = normSat(m[3]); tokens.push(n); idents.push({ kind: "sat", norm: n, raw: m[3] }); }
    else if (m[4]) { const n = stripSep(m[4]); tokens.push(n); idents.push({ kind: "code", norm: n, raw: m[4] }); }
    else if (m[5]) {
      const w = m[5].toLowerCase();
      if (!STOPWORDS.has(w)) tokens.push(w);
    }
  }
  return { tokens, idents };
}

export const tokenize = (text: string): string[] => tokenizeFull(text).tokens;

export interface QueryIdents {
  /** identifiers that pin chunks: product codes, DOIs, dates, numbered satellites */
  pin: string[];
  /** subset of pin that is not a satellite name (product codes, DOIs, dates) */
  strong: string[];
  /** all extracted identifiers, for diagnostics */
  all: string[];
  iso3: string[];
  types: number[];
}

export function extractIdentifiers(q: string): QueryIdents {
  const { idents } = tokenizeFull(q);
  const pin: string[] = [];
  const strong: string[] = [];
  const all: string[] = [];
  for (const id of idents) {
    all.push(id.norm);
    if (!pin.includes(id.norm)) pin.push(id.norm);
    if (id.kind !== "sat" && !strong.includes(id.norm)) strong.push(id.norm);
  }
  // Terra / Aqua are plain words; listed for diagnostics only (too generic to pin).
  for (const m of q.matchAll(/\b(terra|aqua)\b/gi)) all.push(m[1].toLowerCase());
  const iso3 = [...new Set([...q.matchAll(/\b(KAZ|UZB|TKM|KGZ|TJK|AFG)\b/gi)].map((m) => m[1].toUpperCase()))];
  const types = [...new Set([...q.matchAll(/\btype[\s_-]*([0-3])\b/gi)].map((m) => Number(m[1])))];
  return { pin, strong, all, iso3, types };
}
