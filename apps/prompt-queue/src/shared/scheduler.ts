// Decides which queued prompts start now, and why the others wait.
// Runs in the main process to start work, and in the UI to explain the queue.

import { busiestWindow, effectiveLimits, windowLabel } from './limits';
import { sortQueue } from './ordering';
import type { AppState, QueueItem } from './types';

export type HoldReason =
  | { kind: 'paused' }
  | { kind: 'repo-paused' }
  | { kind: 'repo-missing' }
  /** Another prompt in the same repo is running. */
  | { kind: 'repo-busy'; itemId: string }
  /** A prompt in the same repo is waiting for feedback. */
  | { kind: 'repo-waiting'; itemId: string }
  | { kind: 'limit'; until: number; reason: string }
  /** Held back to keep headroom in a limit window for higher-priority prompts. */
  | { kind: 'reserve'; window: string; utilization: number; threshold: number }
  /** The maximum number of prompts are already running. */
  | { kind: 'capacity' };

export interface Plan {
  /** Items to start now, in order. */
  start: QueueItem[];
  /** Why each other queued item is waiting. */
  holds: Map<string, HoldReason>;
}

export function planQueue(state: AppState, now: number): Plan {
  const running = state.items.filter((item) => item.status === 'running');
  const busyRepos = new Map(running.map((item) => [item.repoId, item.id]));
  const waitingRepos = new Map<string, string>();
  if (state.settings.pauseRepoOnFeedback) {
    for (const item of state.items) {
      if (item.status === 'needs-feedback' && !waitingRepos.has(item.repoId)) {
        waitingRepos.set(item.repoId, item.id);
      }
    }
  }
  const repos = new Map(state.repos.map((repo) => [repo.id, repo]));
  let slots = Math.max(0, state.settings.maxConcurrent - running.length);

  const start: QueueItem[] = [];
  const holds = new Map<string, HoldReason>();
  const queued = sortQueue(state.items.filter((item) => item.status === 'queued'));

  for (const item of queued) {
    const hold = holdFor(item);
    if (hold) {
      holds.set(item.id, hold);
    } else {
      start.push(item);
      busyRepos.set(item.repoId, item.id);
      slots--;
    }
  }
  return { start, holds };

  function holdFor(item: QueueItem): HoldReason | undefined {
    const repo = repos.get(item.repoId);
    if (!repo) return { kind: 'repo-missing' };
    if (state.paused) return { kind: 'paused' };
    if (repo.paused) return { kind: 'repo-paused' };
    const busy = busyRepos.get(item.repoId);
    if (busy) return { kind: 'repo-busy', itemId: busy };
    const waiting = waitingRepos.get(item.repoId);
    if (waiting) return { kind: 'repo-waiting', itemId: waiting };

    const limits = effectiveLimits(state.limits[item.toolId], now);
    if (limits.pausedUntil !== undefined) {
      return {
        kind: 'limit',
        until: limits.pausedUntil,
        reason: limits.pausedReason ?? 'Usage limit reached',
      };
    }
    if (item.priority !== 'high') {
      const threshold =
        item.priority === 'low' ? state.settings.holdLowAbove : state.settings.holdNormalAbove;
      const busiest = busiestWindow(limits);
      if (busiest && threshold < 100 && busiest.utilization >= threshold) {
        return { kind: 'reserve', ...busiest, threshold };
      }
    }
    if (slots <= 0) return { kind: 'capacity' };
    return undefined;
  }
}

/** A short explanation of a hold, for the UI. */
export function describeHold(hold: HoldReason, formatTime: (time: number) => string): string {
  switch (hold.kind) {
    case 'paused':
      return 'Queue paused';
    case 'repo-paused':
      return 'Repo paused';
    case 'repo-missing':
      return 'Repo removed';
    case 'repo-busy':
      return 'Repo busy';
    case 'repo-waiting':
      return 'Repo waiting on your feedback';
    case 'limit':
      return `${hold.reason}, waiting until ${formatTime(hold.until)}`;
    case 'reserve':
      return `Held: ${windowLabel(hold.window)} limit ${Math.round(hold.utilization)}% used (holds at ${hold.threshold}%)`;
    case 'capacity':
      return 'Up next';
  }
}
