// Loads saved state defensively: anything malformed is dropped rather than
// crashing the app, and missing fields get defaults.

import { mergeSettings } from './commands';
import {
  type AppState,
  createInitialState,
  type ItemStatus,
  type LimitWindow,
  type OutputEntry,
  PERMISSION_MODES,
  PRIORITIES,
  type QueueItem,
  type Repo,
  type ToolLimits,
  type Turn,
} from './types';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const STATUSES: readonly ItemStatus[] = [
  'queued',
  'running',
  'needs-feedback',
  'completed',
  'error',
  'cancelled',
];

export function loadState(value: unknown): AppState {
  const state = createInitialState();
  if (!isObject(value) || value.version !== 1) return state;

  const repos = list(value.repos).flatMap((raw): Repo[] => {
    if (!isObject(raw)) return [];
    const id = str(raw.id);
    const path = str(raw.path);
    if (!id || !path) return [];
    return [{ id, path, name: str(raw.name) ?? path, paused: raw.paused === true }];
  });
  const repoIds = new Set(repos.map((repo) => repo.id));

  const items = list(value.items).flatMap((raw): QueueItem[] => {
    const item = loadItem(raw);
    return item && repoIds.has(item.repoId) ? [item] : [];
  });

  const claude = isObject(value.limits) ? value.limits['claude-code'] : undefined;
  return {
    version: 1,
    paused: value.paused === true,
    repos,
    items,
    limits: { 'claude-code': loadLimits(claude) },
    settings: mergeSettings(state.settings, value.settings),
  };
}

function loadItem(raw: unknown): QueueItem | undefined {
  if (!isObject(raw)) return undefined;
  const id = str(raw.id);
  const repoId = str(raw.repoId);
  const status = STATUSES.find((candidate) => candidate === raw.status);
  const priority = PRIORITIES.find((candidate) => candidate === raw.priority);
  const turns = list(raw.turns).flatMap((turn) => loadTurn(turn) ?? []);
  if (!id || !repoId || !status || !priority || turns.length === 0) return undefined;
  const options = isObject(raw.options) ? raw.options : {};
  const createdAt = num(raw.createdAt) ?? 0;
  return {
    id,
    repoId,
    toolId: 'claude-code',
    priority,
    rank: num(raw.rank) ?? 0,
    status,
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
    options: {
      model: str(options.model) ?? '',
      permissionMode: PERMISSION_MODES.find((mode) => mode === options.permissionMode) ?? 'default',
    },
    sessionId: str(raw.sessionId),
    turns,
    message: str(raw.message),
  };
}

function loadTurn(raw: unknown): Turn | undefined {
  if (!isObject(raw)) return undefined;
  const id = str(raw.id);
  const prompt = str(raw.prompt);
  const kind = (['prompt', 'reply', 'continue'] as const).find((k) => k === raw.kind);
  if (!id || !prompt || !kind) return undefined;
  const output = list(raw.output).flatMap((entry): OutputEntry[] => {
    if (!isObject(entry)) return [];
    const text = str(entry.text);
    const entryKind = (['text', 'tool', 'info', 'error'] as const).find((k) => k === entry.kind);
    return text !== undefined && entryKind
      ? [{ kind: entryKind, text, at: num(entry.at) ?? 0 }]
      : [];
  });
  return {
    id,
    kind,
    prompt,
    createdAt: num(raw.createdAt) ?? 0,
    startedAt: num(raw.startedAt),
    finishedAt: num(raw.finishedAt),
    output,
    result: str(raw.result),
    costUsd: num(raw.costUsd),
    durationMs: num(raw.durationMs),
    numTurns: num(raw.numTurns),
  };
}

function loadLimits(raw: unknown): ToolLimits {
  if (!isObject(raw)) return { windows: {} };
  const windows: Record<string, LimitWindow> = {};
  if (isObject(raw.windows)) {
    for (const [key, window] of Object.entries(raw.windows)) {
      if (!isObject(window)) continue;
      const status = (['ok', 'warning', 'limited'] as const).find((s) => s === window.status);
      const updatedAt = num(window.updatedAt);
      if (!status || updatedAt === undefined) continue;
      windows[key] = {
        status,
        updatedAt,
        utilization: num(window.utilization),
        resetsAt: num(window.resetsAt),
      };
    }
  }
  const pausedUntil = num(raw.pausedUntil);
  return pausedUntil === undefined
    ? { windows }
    : { windows, pausedUntil, pausedReason: str(raw.pausedReason) };
}
