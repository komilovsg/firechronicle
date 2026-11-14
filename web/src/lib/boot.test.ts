import { describe, expect, it, vi } from 'vitest';
import { createSteps, hardTimeout, track } from './boot';
describe('boot steps', () => {
  it('ticks only on resolve and is idempotent', async () => {
    const s = createSteps(['meta', 'regions']); expect(s.fraction()).toBe(0);
    let res!: (v: number) => void; const p = track(s, 'meta', new Promise<number>((r) => { res = r; }));
    expect(s.fraction()).toBe(0); res(1); await p; expect(s.fraction()).toBe(0.5);
    s.done('meta'); expect(s.fraction()).toBe(0.5); s.done('nope'); expect(s.fraction()).toBe(0.5);
    s.done('regions'); expect(s.finished()).toBe(true);
  });
  it('a failed step blocks finishing and records the name', async () => {
    const s = createSteps(['a', 'b']); await expect(track(s, 'a', Promise.reject(new Error('x')))).rejects.toThrow('x');
    s.done('b'); expect(s.failed()).toBe('a'); expect(s.finished()).toBe(false);
  });
  it('notifies subscribers', () => { const s = createSteps(['a']); const f = vi.fn(); s.onChange(f); s.done('a'); expect(f).toHaveBeenCalledTimes(1); });
});
describe('hardTimeout', () => {
  it('fires once after ms, not after cancel', () => {
    vi.useFakeTimers(); const f = vi.fn(); const t = hardTimeout(20000, f); vi.advanceTimersByTime(19999); expect(f).not.toHaveBeenCalled(); vi.advanceTimersByTime(2); expect(f).toHaveBeenCalledTimes(1); t.cancel();
    const g = vi.fn(); const u = hardTimeout(100, g); u.cancel(); vi.advanceTimersByTime(500); expect(g).not.toHaveBeenCalled(); vi.useRealTimers();
  });
});
