// CORS, input validation, rate limiting helpers.
export const ALLOWED_ORIGINS = ["https://komilovsg.github.io", "http://localhost:5173", "http://localhost:4173"];

export type CorsDecision = { allowed: boolean; origin: string | null; headers: Record<string, string> };

export function corsDecision(origin: string | null): CorsDecision {
  if (origin === null) return { allowed: true, origin: null, headers: {} }; // non-browser clients (curl, eval)
  if (!ALLOWED_ORIGINS.includes(origin)) return { allowed: false, origin, headers: {} };
  return {
    allowed: true, origin,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-debug-token",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  };
}

export const MAX_BODY_BYTES = 4096;

export function cleanQuestion(q: unknown): string | null {
  if (typeof q !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = q.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim();
  return s.length >= 3 && s.length <= 500 ? s : null;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const PER_MINUTE = 5;
export const PER_DAY = 30;
export const GLOBAL_DAILY_CAP = 1500;

/** Pure decision helper so it can be unit-tested. */
export function rateDecision(minuteCount: number, dayCount: number): "ok" | "minute" | "day" {
  if (minuteCount >= PER_MINUTE) return "minute";
  if (dayCount >= PER_DAY) return "day";
  return "ok";
}

async function bump(kv: KVNamespace, key: string, ttl: number): Promise<number> {
  const n = Number((await kv.get(key)) ?? 0) + 1;
  await kv.put(key, String(n), { expirationTtl: ttl });
  return n;
}

export async function checkRate(kv: KVNamespace, ip: string, salt: string, now = Date.now()): Promise<"ok" | "minute" | "day"> {
  const h = (await sha256Hex(`${salt}:${ip}`)).slice(0, 24);
  const minute = Math.floor(now / 60000);
  const day = new Date(now).toISOString().slice(0, 10);
  const mk = `rl:m:${h}:${minute}`, dk = `rl:d:${h}:${day}`;
  const m = Number((await kv.get(mk)) ?? 0), d = Number((await kv.get(dk)) ?? 0);
  const dec = rateDecision(m, d);
  if (dec !== "ok") return dec;
  await Promise.all([kv.put(mk, String(m + 1), { expirationTtl: 120 }), kv.put(dk, String(d + 1), { expirationTtl: 90000 })]);
  return "ok";
}

export async function bumpGlobal(kv: KVNamespace, now = Date.now()): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  return (await bump(kv, `cap:${day}`, 90000)) <= GLOBAL_DAILY_CAP;
}
