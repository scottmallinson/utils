import type { Context } from '../queue';
import { type AppState, createInitialState, type QueueItem, type Repo } from '../types';

export const NOW = Date.UTC(2026, 8, 27, 12, 0);

/** A context with a fixed clock and predictable ids: id-1, id-2… */
export function testContext(now = NOW): Context & { advance(ms: number): void } {
  let counter = 0;
  const context = {
    now,
    id: () => `id-${++counter}`,
    advance(ms: number) {
      context.now += ms;
    },
  };
  return context;
}

export function repo(id: string, overrides: Partial<Repo> = {}): Repo {
  return { id, name: id, path: `/code/${id}`, paused: false, ...overrides };
}

export function item(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    repoId: 'a',
    toolId: 'claude-code',
    priority: 'normal',
    rank: 0,
    status: 'queued',
    createdAt: NOW,
    updatedAt: NOW,
    options: { model: '', permissionMode: 'acceptEdits' },
    turns: [{ id: `${id}-t1`, kind: 'prompt', prompt: `Prompt ${id}`, createdAt: NOW, output: [] }],
    ...overrides,
  };
}

export function state(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialState(), repos: [repo('a'), repo('b')], ...overrides };
}
