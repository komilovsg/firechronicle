/** Boot progress: named steps that tick only when their promise resolves, plus a hard timeout. */
export interface Steps {
  names: string[];
  /** Mark a step done (idempotent). */
  done(name: string): void;
  /** Mark a step failed; the tracker enters the error state. */
  fail(name: string, err?: unknown): void;
  /** 0..1, fraction of finished steps. */
  fraction(): number;
  finished(): boolean;
  failed(): string | null;
  onChange(fn: () => void): void;
}
export function createSteps(names: string[]): Steps {
  const doneSet = new Set<string>(); let failedName: string | null = null; const subs: (() => void)[] = [];
  const emit = (): void => subs.forEach((f) => f());
  return {
    names,
    done(n) { if (!names.includes(n) || doneSet.has(n)) return; doneSet.add(n); emit(); },
    fail(n) { if (failedName === null) { failedName = n; emit(); } },
    fraction: () => doneSet.size / Math.max(1, names.length),
    finished: () => doneSet.size === names.length && failedName === null,
    failed: () => failedName,
    onChange(fn) { subs.push(fn); },
  };
}
/** Track a promise against a step; resolves with its value. */
export async function track<T>(steps: Steps, name: string, p: Promise<T>): Promise<T> {
  try { const v = await p; steps.done(name); return v; } catch (e) { steps.fail(name, e); throw e; }
}
/** Hard timeout: calls onTimeout once after `ms` unless cancelled; cancel() is idempotent. */
export function hardTimeout(ms: number, onTimeout: () => void, setT: typeof setTimeout = setTimeout, clearT: typeof clearTimeout = clearTimeout): { cancel: () => void } {
  let live = true; const id = setT(() => { if (live) { live = false; onTimeout(); } }, ms);
  return { cancel: () => { if (live) { live = false; clearT(id); } } };
}
