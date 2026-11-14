import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRetry, delayFor, BACKOFF_S, MAX_AUTO } from './retry';

describe('backoff', () => {
  it('5, 10, 20, 30 then stop', () => { expect([0, 1, 2, 3, 4].map(delayFor)).toEqual([5, 10, 20, 30, null]); expect(BACKOFF_S.length).toBe(MAX_AUTO); });
});
describe('retry controller', () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
  it('counts down 5..1 and then runs once', async () => {
    const run = vi.fn(async () => true), ticks: number[] = [], r = createRetry({ run, onTick: (s) => ticks.push(s), isOnline: () => true });
    r.fail(); expect(r.state()).toBe('counting'); expect(ticks).toEqual([5]);
    vi.advanceTimersByTime(4000); expect(ticks).toEqual([5, 4, 3, 2, 1]); expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); await flush(); expect(run).toHaveBeenCalledTimes(1); expect(r.state()).toBe('idle'); expect(r.attempts()).toBe(0);
  });
  it('follows the backoff sequence on repeated failures and gives up after 4 attempts', async () => {
    const run = vi.fn(async () => false), states: string[] = [], r = createRetry({ run, onState: (s) => states.push(s), isOnline: () => true });
    r.fail(); for (const secs of [5, 10, 20, 30]) { vi.advanceTimersByTime(secs * 1000 - 1); expect(run.mock.calls.length).toBeLessThan(4); vi.advanceTimersByTime(1); await flush(); await flush(); }
    expect(run).toHaveBeenCalledTimes(4); expect(r.state()).toBe('gaveup'); vi.advanceTimersByTime(120000); expect(run).toHaveBeenCalledTimes(4);
  });
  it('retryNow runs immediately and cancel stops the countdown', async () => {
    const run = vi.fn(async () => true), r = createRetry({ run, isOnline: () => true }); r.fail(); r.retryNow(); await flush(); expect(run).toHaveBeenCalledTimes(1);
    const run2 = vi.fn(async () => true), r2 = createRetry({ run: run2, isOnline: () => true }); r2.fail(); r2.cancel(); vi.advanceTimersByTime(60000); expect(run2).not.toHaveBeenCalled(); expect(r2.state()).toBe('cancelled');
  });
  it('offline pauses the countdown and resumes with one attempt on the online event', async () => {
    let on = false, fire: () => void = () => undefined; const run = vi.fn(async () => true);
    const r = createRetry({ run, isOnline: () => on, onOnline: (f) => { fire = f; return () => undefined; } });
    r.fail(); expect(r.state()).toBe('offline'); vi.advanceTimersByTime(60000); expect(run).not.toHaveBeenCalled();
    on = true; fire(); await flush(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('persisted attempts reduce the budget', () => { const r = createRetry({ run: async () => false, attempts: 4, isOnline: () => true }); r.fail(); expect(r.state()).toBe('gaveup'); });
  it('a thrown run counts as a failure', async () => { const r = createRetry({ run: async () => { throw new Error('x'); }, isOnline: () => true }); r.fail(); vi.advanceTimersByTime(5000); await flush(); await flush(); expect(r.state()).toBe('counting'); expect(r.attempts()).toBe(1); });
});
