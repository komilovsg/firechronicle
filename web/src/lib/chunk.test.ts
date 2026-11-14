import { describe, expect, it, vi } from 'vitest';
import { chunk, isChunkError, recover, StaleBuildError, type Env } from './chunk';
const mkEnv = (stored: string | null = null, now = 1_000_000): Env & { reload: ReturnType<typeof vi.fn>; v: string | null } => {
  const e = { v: stored, get: () => e.v, set: (x: string) => { e.v = x; }, now: () => now, reload: vi.fn() }; return e as never;
};
describe('chunk recovery', () => {
  it('recognises the usual messages', () => { for (const m of ['Failed to fetch dynamically imported module: /assets/x.js', 'error loading dynamically imported module', 'Importing a module script failed.', 'ChunkLoadError: x']) expect(isChunkError(new Error(m))).toBe(true); expect(isChunkError(new Error('boom'))).toBe(false); });
  it('passes values through', async () => { expect(await chunk(async () => 5, mkEnv())).toBe(5); });
  it('non-chunk errors are rethrown untouched', async () => { const env = mkEnv(); await expect(chunk(async () => { throw new Error('x'); }, env)).rejects.toThrow('x'); expect(env.reload).not.toHaveBeenCalled(); });
  it('first chunk failure reloads once and never resolves', async () => {
    const env = mkEnv(); let settled = false;
    void chunk(async () => { throw new Error('Failed to fetch dynamically imported module'); }, env).then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 10)); expect(env.reload).toHaveBeenCalledTimes(1); expect(env.v).toBe('1000000'); expect(settled).toBe(false);
  });
  it('second failure within the window shows the message instead of looping', async () => {
    const env = mkEnv('999000'); await expect(chunk(async () => { throw new Error('Failed to fetch dynamically imported module'); }, env)).rejects.toBeInstanceOf(StaleBuildError); expect(env.reload).not.toHaveBeenCalled();
  });
  it('an old marker allows another reload', () => { const env = mkEnv('1', 1_000_000); expect(recover(env)).toBe(true); expect(env.reload).toHaveBeenCalledTimes(1); });
});
