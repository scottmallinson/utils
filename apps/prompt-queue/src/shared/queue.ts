// The queue reducer: every change to the app's state goes through `reduce`.
// It's pure: time and new ids come in through `Context`, so tests are deterministic.

import type { RunOutcome, RunStats } from './claude/run';
import { type Command, mergeSettings } from './commands';
import { applyLimitReport, type LimitReport, pauseForLimit } from './limits';
import { bottomRank, normaliseRanks, placeAt, sortQueue, topRank } from './ordering';
import type { AppState, OutputEntry, QueueItem, Repo, ToolId, Turn } from './types';

export type FinishOutcome = RunOutcome | { kind: 'cancelled' };

export type EngineAction =
  | { type: 'addRepo'; name: string; path: string }
  | { type: 'runStarted'; itemId: string; sessionId?: string }
  | { type: 'runOutput'; itemId: string; entries: OutputEntry[] }
  | {
      type: 'runFinished';
      itemId: string;
      outcome: FinishOutcome;
      stats: RunStats;
    }
  | { type: 'limitReport'; toolId: ToolId; report: LimitReport }
  /** After a restart: anything still marked running was interrupted. */
  | { type: 'recover' };

export type Action = Command | EngineAction;

export interface Context {
  now: number;
  id: () => string;
}

export const CONTINUE_PROMPT = 'Continue from where you left off.';
export const MAX_OUTPUT_ENTRIES = 400;
export const MAX_ENTRY_LENGTH = 4_000;
export const MAX_RESULT_LENGTH = 20_000;
/** Completed and cancelled items kept for reference; older ones are dropped. */
export const MAX_HISTORY = 300;

const FINISHED = new Set(['completed', 'cancelled']);

export function reduce(state: AppState, action: Action, ctx: Context): AppState {
  switch (action.type) {
    case 'add': {
      if (!state.repos.some((repo) => repo.id === action.repoId)) return state;
      const queued = queuedItems(state);
      const item: QueueItem = {
        id: ctx.id(),
        repoId: action.repoId,
        toolId: 'claude-code',
        priority: action.priority,
        rank: action.atTop ? topRank(queued, action.priority) : bottomRank(queued, action.priority),
        status: 'queued',
        createdAt: ctx.now,
        updatedAt: ctx.now,
        options: action.options,
        turns: [newTurn(ctx, 'prompt', action.prompt)],
      };
      return { ...state, items: [...state.items, item] };
    }

    case 'edit':
      return updateItem(
        state,
        action.itemId,
        (item) => {
          if (item.status !== 'queued') return item;
          const turns = [...item.turns];
          const last = turns.at(-1);
          if (action.prompt && last) turns[turns.length - 1] = { ...last, prompt: action.prompt };
          return { ...item, turns, options: { ...item.options, ...action.options } };
        },
        ctx,
      );

    case 'move': {
      const list = queuedItems(state, action.repoId);
      const placement = placeAt(list, action.itemId, action.targetId);
      if (!placement) return state;
      return withRanks(
        updateItem(state, action.itemId, (item) => ({ ...item, ...placement }), ctx),
      );
    }

    case 'moveToEnd': {
      const list = queuedItems(state, action.repoId);
      const target = action.end === 'top' ? list[0] : list.at(-1);
      if (!target) return state;
      const placement = placeAt(list, action.itemId, target.id);
      if (!placement) return state;
      return withRanks(
        updateItem(state, action.itemId, (item) => ({ ...item, ...placement }), ctx),
      );
    }

    case 'setPriority':
      return updateItem(
        state,
        action.itemId,
        (item) =>
          item.priority === action.priority
            ? item
            : {
                ...item,
                priority: action.priority,
                rank: bottomRank(queuedItems(state), action.priority),
              },
        ctx,
      );

    case 'cancel':
      // Running items are stopped by the engine, which then reports `runFinished`.
      return updateItem(
        state,
        action.itemId,
        (item) =>
          item.status === 'queued' ? { ...item, status: 'cancelled', message: undefined } : item,
        ctx,
      );

    case 'retry':
      return updateItem(
        state,
        action.itemId,
        (item) => {
          if (item.status !== 'error' && item.status !== 'cancelled') return item;
          const turns = item.turns.map((turn, index) =>
            index === item.turns.length - 1 ? resetTurn(turn) : turn,
          );
          // Retrying the very first prompt starts a fresh session.
          const sessionId = turns.length === 1 ? undefined : item.sessionId;
          return {
            ...item,
            status: 'queued',
            message: undefined,
            sessionId,
            turns,
            rank: topRank(queuedItems(state), item.priority),
          };
        },
        ctx,
      );

    case 'reply':
      return updateItem(
        state,
        action.itemId,
        (item) => {
          if (!item.sessionId || item.status === 'queued' || item.status === 'running') return item;
          return {
            ...item,
            status: 'queued',
            message: undefined,
            options: { ...item.options, ...action.options },
            turns: [...item.turns, newTurn(ctx, 'reply', action.text)],
            // A reply continues work already under way, so it goes to the front.
            rank: topRank(queuedItems(state), item.priority),
          };
        },
        ctx,
      );

    case 'resolve':
      return updateItem(
        state,
        action.itemId,
        (item) =>
          item.status === 'needs-feedback'
            ? { ...item, status: 'completed', message: undefined }
            : item,
        ctx,
      );

    case 'remove':
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.itemId || item.status === 'running'),
      };

    case 'clearFinished':
      return {
        ...state,
        items: state.items.filter(
          (item) =>
            !FINISHED.has(item.status) ||
            (action.repoId !== undefined && item.repoId !== action.repoId),
        ),
      };

    case 'setPaused':
      return { ...state, paused: action.paused };

    case 'setRepoPaused':
      return {
        ...state,
        repos: state.repos.map((repo) =>
          repo.id === action.repoId ? { ...repo, paused: action.paused } : repo,
        ),
      };

    case 'removeRepo': {
      const busy = state.items.some(
        (item) => item.repoId === action.repoId && item.status === 'running',
      );
      if (busy) return state;
      return {
        ...state,
        repos: state.repos.filter((repo) => repo.id !== action.repoId),
        items: state.items.filter((item) => item.repoId !== action.repoId),
      };
    }

    case 'resumeTool': {
      const { windows } = state.limits[action.toolId];
      return { ...state, limits: { ...state.limits, [action.toolId]: { windows } } };
    }

    case 'updateSettings':
      return { ...state, settings: mergeSettings(state.settings, action.settings) };

    case 'addRepo': {
      if (state.repos.some((repo) => samePath(repo.path, action.path))) return state;
      const repo: Repo = { id: ctx.id(), name: action.name, path: action.path, paused: false };
      return { ...state, repos: [...state.repos, repo] };
    }

    case 'runStarted':
      return updateItem(
        state,
        action.itemId,
        (item) => ({
          ...item,
          status: 'running',
          message: undefined,
          sessionId: action.sessionId ?? item.sessionId,
          turns: updateLastTurn(item.turns, (turn) => ({ ...resetTurn(turn), startedAt: ctx.now })),
        }),
        ctx,
      );

    case 'runOutput':
      return updateItem(
        state,
        action.itemId,
        (item) => ({
          ...item,
          turns: updateLastTurn(item.turns, (turn) => ({
            ...turn,
            output: [
              ...turn.output,
              ...action.entries.map((entry) => ({
                ...entry,
                text: truncate(entry.text, MAX_ENTRY_LENGTH),
              })),
            ].slice(-MAX_OUTPUT_ENTRIES),
          })),
        }),
        ctx,
      );

    case 'runFinished': {
      const next = updateItem(
        state,
        action.itemId,
        (item) => finishItem(item, action.outcome, action.stats, state, ctx),
        ctx,
      );
      const { outcome } = action;
      const item = next.items.find((candidate) => candidate.id === action.itemId);
      if (outcome.kind !== 'limited' || !item) return pruneHistory(next);
      const limits = pauseForLimit(next.limits[item.toolId], outcome.resetsAt, ctx.now);
      return { ...next, limits: { ...next.limits, [item.toolId]: limits } };
    }

    case 'limitReport': {
      const limits = applyLimitReport(state.limits[action.toolId], action.report, ctx.now);
      return { ...state, limits: { ...state.limits, [action.toolId]: limits } };
    }

    case 'recover':
      return {
        ...state,
        items: state.items.map((item) =>
          item.status === 'running'
            ? {
                ...item,
                status: 'error',
                message: 'Interrupted: Prompt Queue closed while this was running.',
                updatedAt: ctx.now,
              }
            : item,
        ),
      };
  }
}

function finishItem(
  item: QueueItem,
  outcome: FinishOutcome,
  stats: RunStats,
  state: AppState,
  ctx: Context,
): QueueItem {
  const sessionId = stats.sessionId ?? item.sessionId;
  const finishTurn = (turn: Turn, result?: string): Turn => ({
    ...turn,
    finishedAt: ctx.now,
    result: result === undefined ? undefined : truncate(result, MAX_RESULT_LENGTH),
    costUsd: stats.costUsd,
    durationMs: stats.durationMs,
    numTurns: stats.numTurns,
  });

  switch (outcome.kind) {
    case 'completed':
      return {
        ...item,
        status: 'completed',
        sessionId,
        message: undefined,
        turns: updateLastTurn(item.turns, (turn) => finishTurn(turn, outcome.result)),
      };
    case 'needs-feedback':
      return {
        ...item,
        status: 'needs-feedback',
        sessionId,
        message: outcome.reason,
        turns: updateLastTurn(item.turns, (turn) => finishTurn(turn, outcome.result)),
      };
    case 'error':
      return {
        ...item,
        status: 'error',
        sessionId,
        message: outcome.message,
        turns: updateLastTurn(item.turns, (turn) => finishTurn(turn)),
      };
    case 'cancelled':
      return {
        ...item,
        status: 'cancelled',
        sessionId,
        message: undefined,
        turns: updateLastTurn(item.turns, (turn) => finishTurn(turn)),
      };
    case 'limited': {
      // Back into the queue, at the front, to run again once the limit resets.
      const rank = topRank(queuedItems(state), item.priority);
      if (outcome.madeProgress && sessionId) {
        return {
          ...item,
          status: 'queued',
          sessionId,
          rank,
          message: undefined,
          turns: [
            ...updateLastTurn(item.turns, (turn) => finishTurn(turn, outcome.message)),
            newTurn(ctx, 'continue', CONTINUE_PROMPT),
          ],
        };
      }
      // Nothing happened yet: run the same turn again. A first prompt gets a fresh session.
      return {
        ...item,
        status: 'queued',
        rank,
        message: undefined,
        sessionId: item.turns.length === 1 ? undefined : sessionId,
        turns: updateLastTurn(item.turns, (turn) => ({ ...turn, startedAt: undefined })),
      };
    }
  }
}

/** Queued items in run order, optionally just one repo's. */
export function queuedItems(state: AppState, repoId?: string): QueueItem[] {
  return sortQueue(
    state.items.filter(
      (item) => item.status === 'queued' && (repoId === undefined || item.repoId === repoId),
    ),
  );
}

function updateItem(
  state: AppState,
  itemId: string,
  update: (item: QueueItem) => QueueItem,
  ctx: Context,
): AppState {
  let changed = false;
  const items = state.items.map((item) => {
    if (item.id !== itemId) return item;
    const next = update(item);
    if (next === item) return item;
    changed = true;
    return { ...next, updatedAt: ctx.now };
  });
  return changed ? { ...state, items } : state;
}

function updateLastTurn(turns: Turn[], update: (turn: Turn) => Turn): Turn[] {
  return turns.map((turn, index) => (index === turns.length - 1 ? update(turn) : turn));
}

function newTurn(ctx: Context, kind: Turn['kind'], prompt: string): Turn {
  return { id: ctx.id(), kind, prompt, createdAt: ctx.now, output: [] };
}

function resetTurn(turn: Turn): Turn {
  return {
    id: turn.id,
    kind: turn.kind,
    prompt: turn.prompt,
    createdAt: turn.createdAt,
    output: [],
  };
}

function withRanks(state: AppState): AppState {
  const items = normaliseRanks(state.items);
  return items === state.items ? state : { ...state, items };
}

function pruneHistory(state: AppState): AppState {
  const finished = state.items.filter((item) => FINISHED.has(item.status));
  if (finished.length <= MAX_HISTORY) return state;
  const drop = new Set(
    [...finished]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, finished.length - MAX_HISTORY)
      .map((item) => item.id),
  );
  return { ...state, items: state.items.filter((item) => !drop.has(item.id)) };
}

function samePath(a: string, b: string): boolean {
  const normalise = (path: string) => path.replace(/[\\/]+$/, '');
  return normalise(a) === normalise(b);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
