// Pure helpers that turn app state into what the UI shows.

import { sortQueue } from '../../../shared/ordering';
import type { HoldReason } from '../../../shared/scheduler';
import type { AppState, QueueItem } from '../../../shared/types';

export type Tone = 'neutral' | 'waiting' | 'active' | 'attention' | 'success' | 'danger' | 'muted';

export type StatusIcon =
  | 'queue'
  | 'clock'
  | 'pause'
  | 'spinner'
  | 'message'
  | 'check'
  | 'alert'
  | 'close';

export interface StatusDisplay {
  label: string;
  tone: Tone;
  icon: StatusIcon;
}

export function statusDisplay(item: QueueItem, hold?: HoldReason): StatusDisplay {
  switch (item.status) {
    case 'queued':
      switch (hold?.kind) {
        case 'limit':
          return { label: 'Waiting for limit', tone: 'waiting', icon: 'clock' };
        case 'reserve':
          return { label: 'Held for limits', tone: 'waiting', icon: 'clock' };
        case 'paused':
        case 'repo-paused':
          return { label: 'Paused', tone: 'muted', icon: 'pause' };
        default:
          return { label: 'Queued', tone: 'neutral', icon: 'queue' };
      }
    case 'running':
      return { label: 'In progress', tone: 'active', icon: 'spinner' };
    case 'needs-feedback':
      return { label: 'Waiting on feedback', tone: 'attention', icon: 'message' };
    case 'completed':
      return { label: 'Completed', tone: 'success', icon: 'check' };
    case 'error':
      return { label: 'Error', tone: 'danger', icon: 'alert' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted', icon: 'close' };
  }
}

export interface Sections {
  /** Waiting on feedback, or failed: newest first. */
  attention: QueueItem[];
  running: QueueItem[];
  /** In run order. */
  queued: QueueItem[];
  /** Completed or cancelled: newest first. */
  done: QueueItem[];
}

export function sections(state: AppState, repoId?: string): Sections {
  const items = state.items.filter((item) => repoId === undefined || item.repoId === repoId);
  const newestFirst = (a: QueueItem, b: QueueItem) => b.updatedAt - a.updatedAt;
  return {
    attention: items
      .filter((item) => item.status === 'needs-feedback' || item.status === 'error')
      .sort(newestFirst),
    running: items
      .filter((item) => item.status === 'running')
      .sort((a, b) => (a.turns.at(-1)?.startedAt ?? 0) - (b.turns.at(-1)?.startedAt ?? 0)),
    queued: sortQueue(items.filter((item) => item.status === 'queued')),
    done: items
      .filter((item) => item.status === 'completed' || item.status === 'cancelled')
      .sort(newestFirst),
  };
}

export interface RepoSummary {
  queued: number;
  running: number;
  attention: number;
}

export function repoSummaries(state: AppState): Map<string, RepoSummary> {
  const summaries = new Map<string, RepoSummary>(
    state.repos.map((repo) => [repo.id, { queued: 0, running: 0, attention: 0 }]),
  );
  for (const item of state.items) {
    const summary = summaries.get(item.repoId);
    if (!summary) continue;
    if (item.status === 'queued') summary.queued++;
    else if (item.status === 'running') summary.running++;
    else if (item.status === 'needs-feedback' || item.status === 'error') summary.attention++;
  }
  return summaries;
}

/** The first line of the original prompt, trimmed for a list. */
export function itemTitle(item: QueueItem, max = 120): string {
  const line =
    item.turns[0]?.prompt
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What a running item did most recently (its words or tool calls, not limit notes). */
export function latestActivity(item: QueueItem): string | undefined {
  const output = item.turns.at(-1)?.output ?? [];
  const entry = [...output]
    .reverse()
    .find((candidate) => candidate.kind === 'text' || candidate.kind === 'tool');
  return entry?.text.split('\n')[0];
}

export function totalCost(item: QueueItem): number | undefined {
  const costs = item.turns
    .map((turn) => turn.costUsd)
    .filter((cost): cost is number => cost !== undefined);
  return costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : undefined;
}

/** Items can be replied to once they have a session and aren't queued or running. */
export function canReply(item: QueueItem): boolean {
  return Boolean(item.sessionId) && item.status !== 'queued' && item.status !== 'running';
}
