// Queue order: priority first (high, normal, low), then the user's order (rank).
// Moving an item next to items of another priority adopts their priority, so the
// order you see is always the order things run in.

import type { Priority, QueueItem } from './types';

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function compareQueue(a: QueueItem, b: QueueItem): number {
  return (
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    a.rank - b.rank ||
    a.createdAt - b.createdAt
  );
}

export function sortQueue(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort(compareQueue);
}

/** A rank that sorts before every other item of the same priority. */
export function topRank(items: readonly QueueItem[], priority: Priority): number {
  const ranks = items.filter((item) => item.priority === priority).map((item) => item.rank);
  return ranks.length > 0 ? Math.min(...ranks) - 1 : 0;
}

/** A rank that sorts after every other item of the same priority. */
export function bottomRank(items: readonly QueueItem[], priority: Priority): number {
  const ranks = items.filter((item) => item.priority === priority).map((item) => item.rank);
  return ranks.length > 0 ? Math.max(...ranks) + 1 : 0;
}

export interface Placement {
  priority: Priority;
  rank: number;
}

/**
 * Where an item lands when placed between two neighbours in a sorted list
 * (either may be missing at the ends). The list may be filtered, e.g. to one repo:
 * the result still sorts between the two neighbours.
 */
export function placeBetween(
  current: Priority,
  above: QueueItem | undefined,
  below: QueueItem | undefined,
): Placement {
  let priority = current;
  if (above && PRIORITY_ORDER[priority] < PRIORITY_ORDER[above.priority]) priority = above.priority;
  if (below && PRIORITY_ORDER[priority] > PRIORITY_ORDER[below.priority]) priority = below.priority;
  const aboveRank = above?.priority === priority ? above.rank : undefined;
  const belowRank = below?.priority === priority ? below.rank : undefined;
  let rank: number;
  if (aboveRank !== undefined && belowRank !== undefined) rank = (aboveRank + belowRank) / 2;
  else if (aboveRank !== undefined) rank = aboveRank + 1;
  else if (belowRank !== undefined) rank = belowRank - 1;
  else rank = 0;
  return { priority, rank };
}

/**
 * Moves `id` within the sorted `list` to sit where `targetId` is now
 * (before it when moving up, after it when moving down).
 */
export function placeAt(
  list: readonly QueueItem[],
  id: string,
  targetId: string,
): Placement | undefined {
  const from = list.findIndex((item) => item.id === id);
  const to = list.findIndex((item) => item.id === targetId);
  const item = list[from];
  if (!item || to < 0 || from === to) return undefined;
  const rest = list.filter((other) => other.id !== id);
  // Like arrayMove: with the item taken out, it goes back in at index `to`.
  return placeBetween(item.priority, rest[to - 1], rest[to]);
}

/** Rewrites ranks as 0, 1, 2… in queue order, if they have got too close to split. */
export function normaliseRanks(items: QueueItem[]): QueueItem[] {
  const sorted = sortQueue(items);
  const crowded = sorted.some(
    (item, index) =>
      index > 0 &&
      sorted[index - 1]?.priority === item.priority &&
      Math.abs(item.rank - (sorted[index - 1]?.rank ?? 0)) < 1e-6,
  );
  if (!crowded) return items;
  const ranks = new Map(sorted.map((item, index) => [item.id, index]));
  return items.map((item) => ({ ...item, rank: ranks.get(item.id) ?? item.rank }));
}
