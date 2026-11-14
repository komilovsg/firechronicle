/** Automatic retry with a visible countdown: 5 s, 10 s, 20 s, then 30 s; stops after 4 automatic attempts. */
export const BACKOFF_S = [5, 10, 20, 30];
export const MAX_AUTO = BACKOFF_S.length;
/** Seconds to wait before automatic attempt number `attempt` (0-based), or null when the budget is spent. */
export const delayFor = (attempt: number): number | null => (attempt >= 0 && attempt < MAX_AUTO ? BACKOFF_S[attempt] : null);
export type RetryState = 'idle' | 'counting' | 'retrying' | 'offline' | 'gaveup' | 'cancelled';
export interface RetryOpts {
  /** One attempt; resolves true when it worked. A rejection counts as failure. */
  run: () => Promise<boolean> | boolean;
  onTick?: (secLeft: number, total: number) => void;
  onState?: (s: RetryState, attempt: number) => void;
  /** Automatic attempts already used (e.g. persisted across a page reload). */
  attempts?: number;
  isOnline?: () => boolean;
  onOnline?: (fn: () => void) => () => void;
  setT?: typeof setInterval; clearT?: typeof clearInterval;
}
export interface Retry { fail(): void; success(): void; cancel(): void; retryNow(): void; state(): RetryState; attempts(): number }
export function createRetry(o: RetryOpts): Retry {
  const setT = o.setT ?? setInterval, clearT = o.clearT ?? clearInterval, online = o.isOnline ?? ((): boolean => navigator.onLine);
  const onOnline = o.onOnline ?? ((fn: () => void): (() => void) => { addEventListener('online', fn); return () => removeEventListener('online', fn); });
  let state: RetryState = 'idle', n = o.attempts ?? 0, timer: ReturnType<typeof setInterval> | null = null, left = 0, total = 0, off: (() => void) | null = null;
  const set = (s: RetryState): void => { state = s; o.onState?.(s, n); };
  const stop = (): void => { if (timer !== null) { clearT(timer); timer = null; } if (off) { off(); off = null; } };
  const attempt = async (): Promise<void> => {
    stop(); n++; set('retrying');
    let ok = false; try { ok = await o.run(); } catch { ok = false; }
    if (ok) { n = 0; set('idle'); } else if (state === 'retrying') self.fail();
  };
  const self: Retry = {
    fail() {
      stop(); const d = delayFor(n);
      if (d === null) { set('gaveup'); return; }
      if (!online()) { set('offline'); off = onOnline(() => { stop(); void attempt(); }); return; }
      total = d; left = d; set('counting'); o.onTick?.(left, total);
      timer = setT(() => { left--; if (left <= 0) { void attempt(); } else o.onTick?.(left, total); }, 1000);
    },
    success() { stop(); n = 0; set('idle'); },
    cancel() { stop(); set('cancelled'); },
    retryNow() { void attempt(); },
    state: () => state, attempts: () => n,
  };
  return self;
}
