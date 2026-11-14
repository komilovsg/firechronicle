/** Recovery from stale hashed chunks after a deploy: reload once, then ask the user to reload. */
export const KEY = 'fc-chunk-reload';
export const WINDOW_MS = 60000;
export class StaleBuildError extends Error { constructor() { super('A new version of FireChronicle was published. Reload to continue.'); this.name = 'StaleBuildError'; } }
export const isChunkError = (e: unknown): boolean => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i.test(String((e as Error)?.message ?? e));
export interface Env { get(): string | null; set(v: string): void; now(): number; reload(): void }
const real = (): Env => ({
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { sessionStorage.setItem(KEY, v); } catch { /* private mode */ } },
  now: () => Date.now(), reload: () => location.reload(),
});
/** true = a reload was triggered (hash is kept by location.reload); false = already reloaded recently, caller shows the message. */
export function recover(env: Env = real()): boolean {
  const last = Number(env.get() ?? 0);
  if (last && env.now() - last < WINDOW_MS) return false;
  env.set(String(env.now())); env.reload(); return true;
}
/** Wrap a dynamic import: on a chunk error reload once; on a repeat throw StaleBuildError. */
export async function chunk<T>(f: () => Promise<T>, env: Env = real()): Promise<T> {
  try { return await f(); } catch (e) {
    if (!isChunkError(e)) throw e;
    if (recover(env)) return new Promise<T>(() => undefined);
    throw new StaleBuildError();
  }
}
