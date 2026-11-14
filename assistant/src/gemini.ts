// Gemini REST client: embeddings (single model, no fallback) and a pinned chat model chain
// with KV-backed cooldowns.
export const API = "https://generativelanguage.googleapis.com/v1beta/models";
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIM = 768;
export const CHAT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
];
export const TIMEOUT_MS = 15000;
export const MAX_OUTPUT_TOKENS = 350;

export interface GeminiEnv { GEMINI_API_KEY: string; KV: KVNamespace }

// ---- time helpers -------------------------------------------------------

const laFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

function laParts(d: Date) {
  const p: Record<string, number> = {};
  for (const x of laFmt.formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}

/** Offset (ms) of America/Los_Angeles from UTC at the given instant (negative). */
function laOffsetMs(d: Date): number {
  const p = laParts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

/** Next 00:00 America/Los_Angeles strictly after `now`, as an epoch ms. */
export function nextMidnightLA(now: Date): number {
  const p = laParts(now);
  const wall = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0); // next-day midnight as "wall clock in UTC"
  let t = wall - laOffsetMs(new Date(wall));
  t = wall - laOffsetMs(new Date(t)); // second pass settles DST edges
  return t;
}

export const fmtUtc = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

// ---- error classification ----------------------------------------------

export function isPerDayQuota(errorBody: string): boolean {
  return /PerDay|per day/i.test(errorBody);
}

export function cooldownMs(status: number, errorBody: string, now: Date): number {
  if (status === 429) return isPerDayQuota(errorBody) ? nextMidnightLA(now) - now.getTime() : 60_000;
  if (status === 404) return 6 * 3600_000;
  return 60_000; // 500 / 503 / timeout: KV minimum TTL
}

// ---- KV cooldowns -------------------------------------------------------

export async function coolingUntil(kv: KVNamespace, model: string, now = Date.now()): Promise<number | null> {
  const v = await kv.get(`cool:${model}`);
  const until = v ? Number(v) : 0;
  return until > now ? until : null;
}

async function setCooldown(kv: KVNamespace, model: string, ms: number, now: number) {
  const ttl = Math.max(60, Math.ceil(ms / 1000));
  await kv.put(`cool:${model}`, String(now + ttl * 1000), { expirationTtl: ttl });
}

// ---- fetch with timeout -------------------------------------------------

async function post(url: string, key: string, body: unknown): Promise<{ status: number; text: string } | { status: 0; text: "timeout" }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    return { status: r.status, text: await r.text() };
  } catch {
    return { status: 0, text: "timeout" };
  } finally { clearTimeout(timer); }
}

// ---- embeddings ---------------------------------------------------------

export async function embedQuery(env: GeminiEnv, text: string): Promise<number[] | null> {
  const r = await post(`${API}/${EMBED_MODEL}:embedContent`, env.GEMINI_API_KEY, {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_QUERY",
    outputDimensionality: EMBED_DIM,
  });
  if (r.status !== 200) return null;
  try { return JSON.parse(r.text).embedding.values as number[]; } catch { return null; }
}

// ---- chat chain ---------------------------------------------------------

export interface ChatRequest {
  system: string;
  user: string;
  schema?: unknown; // responseSchema => JSON output
  models?: string[];
}

export type ChatResult =
  | { ok: true; text: string; model: string; attempts: { model: string; status: number }[] }
  | { ok: false; reason: "limit"; resetAt: number; attempts: { model: string; status: number }[] }
  | { ok: false; reason: "unavailable"; attempts: { model: string; status: number }[] };

export async function chat(env: GeminiEnv, req: ChatRequest, exclude: string[] = []): Promise<ChatResult> {
  const attempts: { model: string; status: number }[] = [];
  const models = (req.models ?? CHAT_MODELS).filter((m) => !exclude.includes(m));
  let earliestReset = Infinity;
  let skipped = 0;
  for (const model of models) {
    const until = await coolingUntil(env.KV, model);
    if (until) { skipped++; earliestReset = Math.min(earliestReset, until); continue; }
    const generationConfig: Record<string, unknown> = { maxOutputTokens: MAX_OUTPUT_TOKENS };
    if (req.schema) { generationConfig.responseMimeType = "application/json"; generationConfig.responseSchema = req.schema; }
    const r = await post(`${API}/${model}:generateContent`, env.GEMINI_API_KEY, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig,
    });
    attempts.push({ model, status: r.status });
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.text);
        const cand = j.candidates?.[0];
        const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
        const truncated = cand?.finishReason === "MAX_TOKENS" && !req.schema && !/sources?\s*:/i.test(text);
        if (text && !truncated) return { ok: true, text, model, attempts };
      } catch { /* fall through to next model */ }
      continue;
    }
    if ([429, 503, 500, 404, 0].includes(r.status)) {
      const ms = cooldownMs(r.status, r.text, new Date());
      await setCooldown(env.KV, model, ms, Date.now());
      earliestReset = Math.min(earliestReset, Date.now() + Math.max(60_000, ms));
      continue;
    }
    // other statuses (400/403): do not cool down, try the next model
  }
  const anyAttempt = attempts.length > 0;
  if (!anyAttempt && skipped > 0) return { ok: false, reason: "limit", resetAt: earliestReset, attempts };
  if (attempts.length && attempts.every((a) => a.status === 429)) return { ok: false, reason: "limit", resetAt: earliestReset, attempts };
  return { ok: false, reason: "unavailable", attempts };
}

export async function healthModels(kv: KVNamespace) {
  return Promise.all(CHAT_MODELS.map(async (name) => {
    const u = await coolingUntil(kv, name);
    return { name, cooling_until: u ? new Date(u).toISOString() : null };
  }));
}
