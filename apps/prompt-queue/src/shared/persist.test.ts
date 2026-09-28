import { describe, expect, it } from 'vitest';
import { item, state } from './__fixtures__/state';
import { loadState } from './persist';
import { createInitialState } from './types';

describe('loadState', () => {
  it('round-trips saved state', () => {
    const saved = state({
      paused: true,
      items: [
        item('a1', { sessionId: 's1', message: 'Waiting', status: 'needs-feedback' }),
        item('b1', { repoId: 'b', priority: 'low', rank: 3 }),
        item('c1', {
          turns: [
            {
              id: 't',
              kind: 'prompt',
              prompt: 'p',
              createdAt: 1,
              startedAt: 2,
              permissionMode: 'plan',
              output: [],
            },
          ],
        }),
      ],
      limits: {
        'claude-code': {
          windows: { five_hour: { status: 'warning', utilization: 70, resetsAt: 5, updatedAt: 1 } },
          pausedUntil: 10,
          pausedReason: 'Limit',
        },
      },
    });
    expect(loadState(JSON.parse(JSON.stringify(saved)))).toEqual(JSON.parse(JSON.stringify(saved)));
  });

  it('starts fresh from nothing or an unknown version', () => {
    expect(loadState(undefined)).toEqual(createInitialState());
    expect(loadState({ version: 2, repos: [] })).toEqual(createInitialState());
  });

  it('drops malformed entries and items for missing repos', () => {
    const loaded = loadState({
      version: 1,
      repos: [{ id: 'a', path: '/a' }, { id: 'b' }, 'junk'],
      items: [
        { ...item('ok'), options: { model: 3, permissionMode: 'nope' } },
        { ...item('orphan'), repoId: 'gone' },
        { ...item('bad-status'), status: 'exploded' },
        { ...item('no-turns'), turns: [] },
        {
          ...item('bad-output'),
          turns: [
            {
              id: 't',
              kind: 'prompt',
              prompt: 'p',
              permissionMode: 'yolo',
              output: [1, { kind: 'text', text: 'ok' }],
            },
          ],
        },
      ],
      limits: { 'claude-code': { windows: { x: { status: 'bad' }, y: 3 } } },
      settings: { maxConcurrent: 3 },
    });
    expect(loaded.repos).toEqual([{ id: 'a', path: '/a', name: '/a', paused: false }]);
    expect(loaded.items.map((i) => i.id)).toEqual(['ok', 'bad-output']);
    expect(loaded.items[0]?.options).toEqual({ model: '', permissionMode: 'default' });
    expect(loaded.items[1]?.turns[0]?.output).toEqual([{ kind: 'text', text: 'ok', at: 0 }]);
    expect(loaded.items[1]?.turns[0]?.permissionMode).toBeUndefined();
    expect(loaded.limits['claude-code']).toEqual({ windows: {} });
    expect(loaded.settings.maxConcurrent).toBe(3);
  });
});
