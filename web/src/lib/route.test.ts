import { describe, expect, it } from 'vitest';
import { routeCheck } from './route';
const ids = ['central-asia', 'KAZ', 'TJK'];
describe('routeCheck', () => {
  it('valid hash has no messages', () => { const r = routeCheck('#a=KAZ&y=2005-2020&m=harm&v=map', ids, 2000, 2026); expect(r.view).toBe('map'); expect(r.messages).toEqual([]); });
  it('no hash falls back to overview silently', () => { const r = routeCheck('', ids, 2000, 2026); expect(r.view).toBe('overview'); expect(r.messages).toEqual([]); expect(r.viewBad).toBe(false); });
  it('bad view', () => { const r = routeCheck('#v=nope', ids, 2000, 2026); expect(r.view).toBe('overview'); expect(r.viewBad).toBe(true); expect(r.messages).toEqual(["That view doesn't exist — showing Overview"]); });
  it('unknown area and bad years each report', () => {
    expect(routeCheck('#a=ZZZ', ids, 2000, 2026).messages).toEqual(['Unknown area — showing Central Asia']);
    expect(routeCheck('#y=1990-2050', ids, 2000, 2026).messages[0]).toContain('Years out of range');
    expect(routeCheck('#y=2020-2010', ids, 2000, 2026).messages.length).toBe(1);
    expect(routeCheck('#y=abc', ids, 2000, 2026).messages.length).toBe(1);
  });
  it('malformed percent-encoding does not throw', () => { expect(() => routeCheck('#a=%E0%A4%A&v=%', ids, 2000, 2026)).not.toThrow(); expect(routeCheck('#a=%E0%A4%A', ids, 2000, 2026).messages.length).toBeGreaterThan(0); });
});
