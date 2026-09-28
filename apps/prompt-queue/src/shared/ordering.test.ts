import { describe, expect, it } from 'vitest';
import { item } from './__fixtures__/state';
import { normaliseRanks, placeAt, placeBetween, sortQueue } from './ordering';

describe('sortQueue', () => {
  it('orders by priority, then rank, then age', () => {
    const items = [
      item('low', { priority: 'low', rank: -5 }),
      item('n2', { rank: 2 }),
      item('n1b', { rank: 1, createdAt: 2 }),
      item('n1a', { rank: 1, createdAt: 1 }),
      item('high', { priority: 'high', rank: 10 }),
    ];
    expect(sortQueue(items).map((i) => i.id)).toEqual(['high', 'n1a', 'n1b', 'n2', 'low']);
  });
});

describe('placeBetween', () => {
  const high = item('h', { priority: 'high', rank: 0 });
  const n1 = item('n1', { rank: 0 });
  const n2 = item('n2', { rank: 1 });
  const low = item('l', { priority: 'low', rank: 0 });

  it('goes between neighbours of the same priority', () => {
    expect(placeBetween('normal', n1, n2)).toEqual({ priority: 'normal', rank: 0.5 });
    expect(placeBetween('normal', undefined, n1)).toEqual({ priority: 'normal', rank: -1 });
    expect(placeBetween('normal', n2, undefined)).toEqual({ priority: 'normal', rank: 2 });
    expect(placeBetween('normal', undefined, undefined)).toEqual({ priority: 'normal', rank: 0 });
  });

  it('adopts the priority of where it lands', () => {
    // A low item dragged above normal ones becomes normal.
    expect(placeBetween('low', undefined, n1)).toEqual({ priority: 'normal', rank: -1 });
    // A high item dragged below normal ones becomes normal.
    expect(placeBetween('high', n2, low)).toEqual({ priority: 'normal', rank: 2 });
    // Between tiers, keeping its own priority is fine.
    expect(placeBetween('normal', high, n1)).toEqual({ priority: 'normal', rank: -1 });
    expect(placeBetween('high', high, n1)).toEqual({ priority: 'high', rank: 1 });
  });
});

describe('placeAt', () => {
  const list = [item('a', { rank: 0 }), item('b', { rank: 1 }), item('c', { rank: 2 })];

  it('moves down to after the target', () => {
    expect(placeAt(list, 'a', 'b')).toEqual({ priority: 'normal', rank: 1.5 });
    expect(placeAt(list, 'a', 'c')).toEqual({ priority: 'normal', rank: 3 });
  });

  it('moves up to before the target', () => {
    expect(placeAt(list, 'c', 'a')).toEqual({ priority: 'normal', rank: -1 });
    expect(placeAt(list, 'c', 'b')).toEqual({ priority: 'normal', rank: 0.5 });
  });

  it('ignores no-op and unknown moves', () => {
    expect(placeAt(list, 'a', 'a')).toBeUndefined();
    expect(placeAt(list, 'x', 'a')).toBeUndefined();
    expect(placeAt(list, 'a', 'x')).toBeUndefined();
  });
});

describe('normaliseRanks', () => {
  it('leaves well-spaced ranks alone', () => {
    const items = [item('a', { rank: 0 }), item('b', { rank: 0.5 })];
    expect(normaliseRanks(items)).toBe(items);
  });

  it('respaces crowded ranks, keeping the order', () => {
    const items = [item('b', { rank: 1e-9 }), item('a', { rank: 0 }), item('c', { rank: 5 })];
    const result = normaliseRanks(items);
    expect(sortQueue(result).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.map((i) => i.rank)).toEqual([1, 0, 2]);
  });
});
