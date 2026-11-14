import { describe, expect, it } from 'vitest';
import { pickSnap, snapHeights } from './mapDrawer';
describe('map drawer snaps', () => {
  const hs = snapHeights(600);
  it('heights are ordered and fit', () => { expect(hs.peek).toBeLessThan(hs.half); expect(hs.half).toBeLessThan(hs.full); expect(hs.full).toBeLessThanOrEqual(600); });
  it('nearest snap on slow release', () => { expect(pickSnap(hs.peek + 10, hs, 0, 'peek')).toBe('peek'); expect(pickSnap(hs.half - 5, hs, 0, 'peek')).toBe('half'); expect(pickSnap(hs.full - 20, hs, 0, 'half')).toBe('full'); });
  it('flick moves one snap, flick down from half goes to peek', () => { expect(pickSnap(hs.half, hs, 0.9, 'half')).toBe('peek'); expect(pickSnap(hs.half, hs, -0.9, 'half')).toBe('full'); expect(pickSnap(hs.peek, hs, 0.9, 'peek')).toBe('peek'); });
});
