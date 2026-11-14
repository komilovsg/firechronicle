import { describe, expect, it } from 'vitest';
import { edgeIndex, nextIndex, snapDecision, typeaheadIndex } from './selectLogic';

describe('select navigation', () => {
  const dis = [false, true, false, false, true];
  it('skips disabled options and stops at the ends', () => {
    expect(nextIndex(dis, 0, 1)).toBe(2);
    expect(nextIndex(dis, 3, 1)).toBe(3);
    expect(nextIndex(dis, 2, -1)).toBe(0);
    expect(nextIndex(dis, 0, -1)).toBe(0);
    expect(edgeIndex(dis, 'first')).toBe(0); expect(edgeIndex(dis, 'last')).toBe(3);
    expect(edgeIndex([true, false, true], 'first')).toBe(1);
  });
  it('typeahead', () => {
    const labels = ['Afghanistan', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Turkmenistan'];
    const none = labels.map(() => false);
    expect(typeaheadIndex(labels, none, 0, 'k')).toBe(1);
    expect(typeaheadIndex(labels, none, 1, 'k')).toBe(2); // repeat cycles
    expect(typeaheadIndex(labels, none, 2, 'k')).toBe(1);
    expect(typeaheadIndex(labels, none, 0, 'ky')).toBe(2);
    expect(typeaheadIndex(labels, none, 0, 'kk')).toBe(1);
    expect(typeaheadIndex(labels, none, 0, 'z')).toBe(-1);
    expect(typeaheadIndex(labels, none, 0, '')).toBe(-1);
    expect(typeaheadIndex(labels, [false, false, true, false, false], 0, 'ky')).toBe(-1);
  });
});
describe('sheet snap decision', () => {
  const base = { defaultY: 300, closedY: 700 };
  it('flick down closes from default, goes to default from expanded', () => {
    expect(snapDecision({ ...base, y: 320, velocity: 0.8 })).toBe('close');
    expect(snapDecision({ ...base, y: 100, velocity: 0.8 })).toBe('default');
  });
  it('flick up expands from default, returns to default when pulled below it', () => {
    expect(snapDecision({ ...base, y: 290, velocity: -0.9 })).toBe('expanded');
    expect(snapDecision({ ...base, y: 450, velocity: -0.9 })).toBe('default');
  });
  it('slow drag: past 30% of the visible sheet closes, otherwise snaps to nearest', () => {
    expect(snapDecision({ ...base, y: 300 + 0.3 * 400, velocity: 0 })).toBe('close');
    expect(snapDecision({ ...base, y: 300 + 0.29 * 400, velocity: 0.1 })).toBe('default');
    expect(snapDecision({ ...base, y: 60, velocity: 0 })).toBe('expanded');
    expect(snapDecision({ ...base, y: 200, velocity: 0 })).toBe('default');
  });
});
