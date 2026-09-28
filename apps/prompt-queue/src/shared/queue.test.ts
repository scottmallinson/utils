import { describe, expect, it } from 'vitest';
import { item, NOW, repo, state, testContext } from './__fixtures__/state';
import {
  type Action,
  CONTINUE_PROMPT,
  MAX_HISTORY,
  MAX_OUTPUT_ENTRIES,
  queuedItems,
  reduce,
} from './queue';
import type { AppState } from './types';

const HOUR = 3_600_000;
const options = { model: '', permissionMode: 'acceptEdits' as const };

function run(s: AppState, ...actions: Action[]) {
  const ctx = testContext();
  return actions.reduce((current, action) => reduce(current, action, ctx), s);
}

const order = (s: AppState, repoId?: string) => queuedItems(s, repoId).map((i) => i.id);
const find = (s: AppState, id: string) => {
  const found = s.items.find((i) => i.id === id);
  if (!found) throw new Error(`No item ${id}`);
  return found;
};

describe('adding', () => {
  it('adds to the back of its priority, or the front if asked', () => {
    const s = run(
      state(),
      { type: 'add', repoId: 'a', prompt: 'one', priority: 'normal', options },
      { type: 'add', repoId: 'b', prompt: 'two', priority: 'normal', options },
      { type: 'add', repoId: 'a', prompt: 'urgent', priority: 'normal', options, atTop: true },
      { type: 'add', repoId: 'a', prompt: 'later', priority: 'low', options, atTop: true },
    );
    expect(queuedItems(s).map((i) => i.turns[0]?.prompt)).toEqual([
      'urgent',
      'one',
      'two',
      'later',
    ]);
    expect(find(s, 'id-1')).toMatchObject({
      repoId: 'a',
      status: 'queued',
      createdAt: NOW,
      turns: [{ id: 'id-2', kind: 'prompt', prompt: 'one', output: [] }],
    });
  });

  it('ignores unknown repos', () => {
    const s = state();
    expect(run(s, { type: 'add', repoId: 'x', prompt: 'p', priority: 'high', options })).toBe(s);
  });
});

describe('reordering', () => {
  const s = state({
    items: [
      item('a1', { rank: 0 }),
      item('b1', { repoId: 'b', rank: 1 }),
      item('a2', { rank: 2 }),
      item('a3', { rank: 3 }),
      item('done', { status: 'completed', rank: -10 }),
    ],
  });

  it('moves within the whole queue', () => {
    expect(order(run(s, { type: 'move', itemId: 'a3', targetId: 'a1' }))).toEqual([
      'a3',
      'a1',
      'b1',
      'a2',
    ]);
    expect(order(run(s, { type: 'move', itemId: 'a1', targetId: 'a2' }))).toEqual([
      'b1',
      'a2',
      'a1',
      'a3',
    ]);
  });

  it('moves within one repo, keeping other repos in place', () => {
    const next = run(s, { type: 'move', itemId: 'a3', targetId: 'a2', repoId: 'a' });
    expect(order(next, 'a')).toEqual(['a1', 'a3', 'a2']);
    expect(order(next)).toEqual(['a1', 'b1', 'a3', 'a2']);
  });

  it('moves to the top or bottom', () => {
    expect(order(run(s, { type: 'moveToEnd', itemId: 'a2', end: 'top' }))).toEqual([
      'a2',
      'a1',
      'b1',
      'a3',
    ]);
    expect(
      order(run(s, { type: 'moveToEnd', itemId: 'a1', end: 'bottom', repoId: 'a' }), 'a'),
    ).toEqual(['a2', 'a3', 'a1']);
  });

  it('changing priority re-sorts, joining the back of the new priority', () => {
    const next = run(s, { type: 'setPriority', itemId: 'a3', priority: 'high' });
    expect(order(next)).toEqual(['a3', 'a1', 'b1', 'a2']);
    expect(order(run(next, { type: 'setPriority', itemId: 'a1', priority: 'high' }))).toEqual([
      'a3',
      'a1',
      'b1',
      'a2',
    ]);
  });

  it('dragging into another priority adopts it', () => {
    const mixed = state({
      items: [item('h', { priority: 'high' }), item('n'), item('l', { priority: 'low' })],
    });
    const next = run(mixed, { type: 'move', itemId: 'l', targetId: 'h' });
    expect(order(next)).toEqual(['l', 'h', 'n']);
    expect(find(next, 'l').priority).toBe('high');
  });
});

describe('editing and removing', () => {
  it('edits queued items only', () => {
    const s = state({ items: [item('q'), item('r', { status: 'running' })] });
    const next = run(
      s,
      { type: 'edit', itemId: 'q', prompt: 'new', options: { model: 'opus' } },
      { type: 'edit', itemId: 'r', prompt: 'new' },
    );
    expect(find(next, 'q').turns[0]?.prompt).toBe('new');
    expect(find(next, 'q').options).toEqual({ model: 'opus', permissionMode: 'acceptEdits' });
    expect(find(next, 'r').turns[0]?.prompt).toBe('Prompt r');
  });

  it('changes the permission mode at any point in the session', () => {
    const s = state({
      items: [
        item('q'),
        item('r', { status: 'running' }),
        item('w', { status: 'needs-feedback', sessionId: 's1' }),
      ],
    });
    const next = run(
      s,
      ...['q', 'r', 'w'].map(
        (itemId): Action => ({ type: 'setPermissionMode', itemId, permissionMode: 'plan' }),
      ),
    );
    expect(next.items.map((i) => i.options)).toEqual([
      { model: '', permissionMode: 'plan' },
      { model: '', permissionMode: 'plan' },
      { model: '', permissionMode: 'plan' },
    ]);
    expect(find(next, 'w').status).toBe('needs-feedback');
    expect(run(next, { type: 'setPermissionMode', itemId: 'q', permissionMode: 'plan' })).toBe(
      next,
    );
  });

  it('removes anything but running items', () => {
    const s = state({ items: [item('q'), item('r', { status: 'running' })] });
    const next = run(s, { type: 'remove', itemId: 'q' }, { type: 'remove', itemId: 'r' });
    expect(next.items.map((i) => i.id)).toEqual(['r']);
  });

  it('clears finished items, optionally for one repo', () => {
    const s = state({
      items: [
        item('c', { status: 'completed' }),
        item('x', { status: 'cancelled', repoId: 'b' }),
        item('e', { status: 'error' }),
        item('q'),
      ],
    });
    expect(run(s, { type: 'clearFinished', repoId: 'b' }).items.map((i) => i.id)).toEqual([
      'c',
      'e',
      'q',
    ]);
    expect(run(s, { type: 'clearFinished' }).items.map((i) => i.id)).toEqual(['e', 'q']);
  });

  it('cancels queued items; running ones are left to the engine', () => {
    const s = state({ items: [item('q'), item('r', { status: 'running' })] });
    const next = run(s, { type: 'cancel', itemId: 'q' }, { type: 'cancel', itemId: 'r' });
    expect(next.items.map((i) => i.status)).toEqual(['cancelled', 'running']);
  });
});

describe('running', () => {
  const s = state({ items: [item('q', { rank: 5 }), item('other', { rank: 0 })] });

  it('tracks a run from start to completion', () => {
    const ctx = testContext();
    let next = reduce(s, { type: 'runStarted', itemId: 'q', sessionId: 's1' }, ctx);
    expect(find(next, 'q')).toMatchObject({ status: 'running', sessionId: 's1' });
    expect(find(next, 'q').turns[0]).toMatchObject({
      startedAt: NOW,
      permissionMode: 'acceptEdits',
    });

    next = reduce(
      next,
      { type: 'runOutput', itemId: 'q', entries: [{ kind: 'text', text: 'Hi', at: NOW }] },
      ctx,
    );
    ctx.advance(1000);
    next = reduce(
      next,
      {
        type: 'runFinished',
        itemId: 'q',
        outcome: { kind: 'completed', result: 'Done' },
        stats: { sessionId: 's1', costUsd: 0.1, durationMs: 1000, numTurns: 2 },
      },
      ctx,
    );
    expect(find(next, 'q')).toMatchObject({ status: 'completed', updatedAt: NOW + 1000 });
    expect(find(next, 'q').turns[0]).toMatchObject({
      output: [{ kind: 'text', text: 'Hi' }],
      result: 'Done',
      finishedAt: NOW + 1000,
      costUsd: 0.1,
      numTurns: 2,
    });
  });

  it('caps output', () => {
    const entries = Array.from({ length: MAX_OUTPUT_ENTRIES + 5 }, (_, i) => ({
      kind: 'text' as const,
      text: i === MAX_OUTPUT_ENTRIES + 4 ? 'x'.repeat(10_000) : String(i),
      at: NOW,
    }));
    const next = run(s, { type: 'runOutput', itemId: 'q', entries });
    const output = find(next, 'q').turns[0]?.output ?? [];
    expect(output).toHaveLength(MAX_OUTPUT_ENTRIES);
    expect(output[0]?.text).toBe('5');
    expect(output.at(-1)?.text.length).toBe(4000);
  });

  it('records feedback requests and errors', () => {
    const feedback = run(s, {
      type: 'runFinished',
      itemId: 'q',
      outcome: { kind: 'needs-feedback', reason: 'Claude asked a question', result: 'Which?' },
      stats: {},
    });
    expect(find(feedback, 'q')).toMatchObject({
      status: 'needs-feedback',
      message: 'Claude asked a question',
    });
    const error = run(s, {
      type: 'runFinished',
      itemId: 'q',
      outcome: { kind: 'error', message: 'Boom' },
      stats: {},
    });
    expect(find(error, 'q')).toMatchObject({ status: 'error', message: 'Boom' });
  });

  it('requeues at the front and pauses the tool when a limit is hit', () => {
    const next = run(
      s,
      { type: 'runStarted', itemId: 'q', sessionId: 's1' },
      {
        type: 'runFinished',
        itemId: 'q',
        outcome: { kind: 'limited', message: 'Limit', resetsAt: NOW + HOUR, madeProgress: true },
        stats: { sessionId: 's1' },
      },
    );
    expect(order(next)).toEqual(['q', 'other']);
    const q = find(next, 'q');
    expect(q.status).toBe('queued');
    expect(q.turns.map((t) => t.kind)).toEqual(['prompt', 'continue']);
    expect(q.turns[1]?.prompt).toBe(CONTINUE_PROMPT);
    expect(next.limits['claude-code'].pausedUntil).toBeGreaterThan(NOW + HOUR);
  });

  it('runs the same prompt again if a limit hit before any work', () => {
    const next = run(
      s,
      { type: 'runStarted', itemId: 'q', sessionId: 's1' },
      {
        type: 'runFinished',
        itemId: 'q',
        outcome: { kind: 'limited', message: 'Limit', madeProgress: false },
        stats: { sessionId: 's1' },
      },
    );
    const q = find(next, 'q');
    expect(q.turns).toHaveLength(1);
    expect(q.sessionId).toBeUndefined();
    expect(q.status).toBe('queued');
  });

  it('marks interrupted runs as errors after a restart', () => {
    const next = run(state({ items: [item('r', { status: 'running' })] }), { type: 'recover' });
    expect(find(next, 'r')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^Interrupted/),
    });
  });

  it('keeps a bounded history', () => {
    const many = state({
      items: [
        ...Array.from({ length: MAX_HISTORY }, (_, i) =>
          item(`c${i}`, { status: 'completed', updatedAt: i }),
        ),
        item('q'),
      ],
    });
    const next = run(many, {
      type: 'runFinished',
      itemId: 'q',
      outcome: { kind: 'completed', result: '' },
      stats: {},
    });
    expect(next.items).toHaveLength(MAX_HISTORY);
    expect(next.items.some((i) => i.id === 'c0')).toBe(false);
  });
});

describe('feedback', () => {
  const waiting = item('w', {
    status: 'needs-feedback',
    sessionId: 's1',
    message: 'Claude asked a question',
    rank: 9,
  });
  const s = state({ items: [item('q', { rank: 0 }), waiting] });

  it('queues a reply at the front, resuming the session', () => {
    const next = run(s, {
      type: 'reply',
      itemId: 'w',
      text: 'Use Postgres',
      options: { permissionMode: 'plan' },
    });
    const w = find(next, 'w');
    expect(w.status).toBe('queued');
    expect(w.message).toBeUndefined();
    expect(w.options.permissionMode).toBe('plan');
    expect(w.turns.at(-1)).toMatchObject({ kind: 'reply', prompt: 'Use Postgres' });
    expect(order(next)).toEqual(['w', 'q']);
  });

  it("can't reply without a session", () => {
    const noSession = state({ items: [item('w', { status: 'completed' })] });
    expect(run(noSession, { type: 'reply', itemId: 'w', text: 'more' })).toBe(noSession);
  });

  it('marks feedback resolved', () => {
    expect(find(run(s, { type: 'resolve', itemId: 'w' }), 'w').status).toBe('completed');
  });

  it('retries failed items from a clean slate', () => {
    const failed = state({
      items: [
        item('e', {
          status: 'error',
          sessionId: 's1',
          message: 'Boom',
          turns: [
            {
              id: 't',
              kind: 'prompt',
              prompt: 'p',
              createdAt: 0,
              startedAt: 1,
              output: [{ kind: 'error', text: 'x', at: 1 }],
            },
          ],
        }),
      ],
    });
    const e = find(run(failed, { type: 'retry', itemId: 'e' }), 'e');
    expect(e).toMatchObject({ status: 'queued', message: undefined, sessionId: undefined });
    expect(e.turns[0]).toEqual({ id: 't', kind: 'prompt', prompt: 'p', createdAt: 0, output: [] });
  });
});

describe('repos, pausing and settings', () => {
  it('adds repos once per path', () => {
    const next = run(
      state({ repos: [] }),
      { type: 'addRepo', name: 'app', path: '/code/app' },
      { type: 'addRepo', name: 'app', path: '/code/app/' },
    );
    expect(next.repos).toEqual([{ id: 'id-1', name: 'app', path: '/code/app', paused: false }]);
  });

  it("removes a repo and its items, unless it's busy", () => {
    const s = state({ items: [item('a1'), item('b1', { repoId: 'b' })] });
    const next = run(s, { type: 'removeRepo', repoId: 'a' });
    expect(next.repos.map((r) => r.id)).toEqual(['b']);
    expect(next.items.map((i) => i.id)).toEqual(['b1']);
    const busy = state({ items: [item('a1', { status: 'running' })] });
    expect(run(busy, { type: 'removeRepo', repoId: 'a' })).toBe(busy);
  });

  it('pauses the queue and repos', () => {
    const next = run(
      state(),
      { type: 'setPaused', paused: true },
      { type: 'setRepoPaused', repoId: 'b', paused: true },
    );
    expect(next.paused).toBe(true);
    expect(next.repos).toEqual([repo('a'), repo('b', { paused: true })]);
  });

  it('lets the user end a limit pause early', () => {
    const s = state({
      limits: { 'claude-code': { windows: {}, pausedUntil: NOW + HOUR, pausedReason: 'Limit' } },
    });
    expect(run(s, { type: 'resumeTool', toolId: 'claude-code' }).limits['claude-code']).toEqual({
      windows: {},
    });
  });

  it('updates settings within bounds', () => {
    const next = run(state(), {
      type: 'updateSettings',
      settings: { maxConcurrent: 99, holdLowAbove: 50, notifications: false },
    });
    expect(next.settings).toMatchObject({
      maxConcurrent: 4,
      holdLowAbove: 50,
      notifications: false,
    });
  });
});
