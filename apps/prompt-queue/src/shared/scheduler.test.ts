import { describe, expect, it } from 'vitest';
import { item, NOW, repo, state } from './__fixtures__/state';
import { describeHold, planQueue } from './scheduler';
import type { AppState } from './types';

const HOUR = 3_600_000;
const plan = (s: AppState) => {
  const result = planQueue(s, NOW);
  return { start: result.start.map((i) => i.id), holds: Object.fromEntries(result.holds) };
};

describe('planQueue', () => {
  it('starts the first item, one at a time by default', () => {
    const s = state({
      items: [item('2', { rank: 2 }), item('1', { rank: 1 }), item('3', { repoId: 'b' })],
    });
    expect(plan(s)).toEqual({
      start: ['3'],
      holds: { '1': { kind: 'capacity' }, '2': { kind: 'capacity' } },
    });
  });

  it('runs one item per repo, up to the concurrency limit', () => {
    const s = state({
      settings: { ...state().settings, maxConcurrent: 3 },
      items: [
        item('a1', { rank: 1 }),
        item('a2', { rank: 2 }),
        item('b1', { repoId: 'b', rank: 3 }),
      ],
    });
    expect(plan(s)).toEqual({
      start: ['a1', 'b1'],
      holds: { a2: { kind: 'repo-busy', itemId: 'a1' } },
    });
  });

  it('counts running items', () => {
    const s = state({
      settings: { ...state().settings, maxConcurrent: 2 },
      items: [
        item('run', { status: 'running' }),
        item('a1', { rank: 1 }),
        item('b1', { repoId: 'b', rank: 2 }),
        item('c1', { repoId: 'c', rank: 3 }),
      ],
      repos: [repo('a'), repo('b'), repo('c')],
    });
    expect(plan(s)).toEqual({
      start: ['b1'],
      holds: { a1: { kind: 'repo-busy', itemId: 'run' }, c1: { kind: 'capacity' } },
    });
  });

  it('respects pauses', () => {
    expect(plan(state({ paused: true, items: [item('1')] })).holds['1']).toEqual({
      kind: 'paused',
    });
    const s = state({
      repos: [repo('a', { paused: true }), repo('b')],
      items: [item('1'), item('2', { repoId: 'b' })],
    });
    expect(plan(s)).toEqual({ start: ['2'], holds: { '1': { kind: 'repo-paused' } } });
    expect(plan(state({ repos: [], items: [item('1')] })).holds['1']).toEqual({
      kind: 'repo-missing',
    });
  });

  it('holds a repo while one of its prompts waits for feedback, if enabled', () => {
    const items = [item('q', { status: 'needs-feedback' }), item('1')];
    expect(plan(state({ items })).holds['1']).toEqual({ kind: 'repo-waiting', itemId: 'q' });
    const s = state({ items, settings: { ...state().settings, pauseRepoOnFeedback: false } });
    expect(plan(s).start).toEqual(['1']);
  });

  it('waits for a limit to reset', () => {
    const s = state({
      items: [item('1', { priority: 'high' })],
      limits: {
        'claude-code': {
          windows: {},
          pausedUntil: NOW + HOUR,
          pausedReason: '5-hour limit reached',
        },
      },
    });
    expect(plan(s).holds['1']).toEqual({
      kind: 'limit',
      until: NOW + HOUR,
      reason: '5-hour limit reached',
    });
    expect(planQueue(s, NOW + HOUR).start.map((i) => i.id)).toEqual(['1']);
  });

  it('keeps headroom for higher priorities as usage climbs', () => {
    const at = (utilization: number): AppState =>
      state({
        settings: { ...state().settings, maxConcurrent: 3 },
        repos: [repo('a'), repo('b'), repo('c')],
        items: [
          item('high', { priority: 'high' }),
          item('normal', { repoId: 'b' }),
          item('low', { repoId: 'c', priority: 'low' }),
        ],
        limits: {
          'claude-code': {
            windows: {
              seven_day: { status: 'warning', utilization, resetsAt: NOW + HOUR, updatedAt: NOW },
            },
          },
        },
      });
    expect(plan(at(50)).start).toEqual(['high', 'normal', 'low']);
    expect(plan(at(75))).toEqual({
      start: ['high', 'normal'],
      holds: { low: { kind: 'reserve', window: 'seven_day', utilization: 75, threshold: 70 } },
    });
    expect(plan(at(95)).start).toEqual(['high']);
  });

  it('ignores usage from windows that have reset', () => {
    const s = state({
      items: [item('low', { priority: 'low' })],
      limits: {
        'claude-code': {
          windows: {
            five_hour: { status: 'warning', utilization: 99, resetsAt: NOW - 1, updatedAt: 0 },
          },
        },
      },
    });
    expect(plan(s).start).toEqual(['low']);
  });
});

describe('describeHold', () => {
  it('explains holds', () => {
    const time = () => '3:00 PM';
    expect(describeHold({ kind: 'limit', until: 0, reason: 'Weekly limit reached' }, time)).toBe(
      'Weekly limit reached, waiting until 3:00 PM',
    );
    expect(
      describeHold(
        { kind: 'reserve', window: 'five_hour', utilization: 71.6, threshold: 70 },
        time,
      ),
    ).toBe('Held: 5-hour limit 72% used (holds at 70%)');
    expect(describeHold({ kind: 'capacity' }, time)).toBe('Up next');
  });
});
