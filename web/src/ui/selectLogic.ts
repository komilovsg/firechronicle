/** Pure logic for the custom select (no DOM). */

/** Next enabled index from `from` in direction `dir` (+1/-1). No wrap; returns `from` when nothing is enabled that way. */
export function nextIndex(disabled: boolean[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < disabled.length; i += dir) if (!disabled[i]) return i;
  return from;
}
export function edgeIndex(disabled: boolean[], which: 'first' | 'last'): number {
  if (which === 'first') { const i = disabled.findIndex((d) => !d); return i < 0 ? 0 : i; }
  for (let i = disabled.length - 1; i >= 0; i--) if (!disabled[i]) return i;
  return 0;
}
/**
 * Typeahead. Same character repeated cycles through matches starting after `current`;
 * a longer buffer matches from `current` inclusive. Returns -1 when nothing matches.
 */
export function typeaheadIndex(labels: string[], disabled: boolean[], current: number, buffer: string): number {
  const b = buffer.toLowerCase().trim();
  if (!b) return -1;
  const repeated = b.length > 1 && [...b].every((c) => c === b[0]);
  const key = repeated ? b[0] : b, start = key.length === 1 ? current + 1 : current;
  const n = labels.length;
  for (let k = 0; k < n; k++) {
    const i = (start + k + n) % n;
    if (!disabled[i] && labels[i].toLowerCase().startsWith(key)) return i;
  }
  return -1;
}

export type Snap = 'close' | 'default' | 'expanded';
export interface SnapInput {
  /** Current sheet translateY in px (0 = fully expanded, larger = lower). */
  y: number;
  /** translateY of the default snap point, and the fully closed position (sheet height). */
  defaultY: number; closedY: number;
  /** Release velocity in px/ms, positive = downward. */
  velocity: number;
}
export const FLICK = 0.5;
/** Where the sheet goes on release. Flicks win; otherwise drag distance (30% of the visible default height closes). */
export function snapDecision({ y, defaultY, closedY, velocity }: SnapInput): Snap {
  if (velocity > FLICK) return y < defaultY - 8 ? 'default' : 'close';
  if (velocity < -FLICK) return y > defaultY + 8 ? 'default' : 'expanded';
  const visible = Math.max(1, closedY - defaultY);
  if (y >= defaultY + 0.3 * visible) return 'close';
  return y < defaultY / 2 ? 'expanded' : 'default';
}
