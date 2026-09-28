import { describe, expect, it } from 'vitest';
import { item, NOW, state } from '../../../shared/__fixtures__/state';
import {
  canReply,
  itemTitle,
  latestActivity,
  repoSummaries,
  sections,
  statusDisplay,
  totalCost,
} from './view';

describe('statusDisplay', () => {
  it('shows why queued items wait', () => {
    const queued = item('q');
    expect(statusDisplay(queued).label).toBe('Queued');
    expect(statusDisplay(queued, { kind: 'limit', until: 0, reason: '' }).label).toBe(
      'Waiting for limit',
    );
    expect(
      statusDisplay(queued, { kind: 'reserve', window: 'x', utilization: 1, threshold: 1 }).tone,
    ).toBe('waiting');
    expect(statusDisplay(queued, { kind: 'repo-paused' }).label).toBe('Paused');
    expect(statusDisplay(queued, { kind: 'capacity' }).label).toBe('Queued');
  });

  it('labels every status', () => {
    expect(
      (['running', 'needs-feedback', 'completed', 'error', 'cancelled'] as const).map(
        (status) => statusDisplay(item('x', { status })).label,
      ),
    ).toEqual(['In progress', 'Waiting on feedback', 'Completed', 'Error', 'Cancelled']);
  });
});

describe('sections', () => {
  const s = state({
    items: [
      item('q2', { rank: 2 }),
      item('q1', { rank: 1 }),
      item('b', { repoId: 'b', rank: 3 }),
      item('r', { status: 'running' }),
      item('e', { status: 'error', updatedAt: NOW + 1 }),
      item('f', { status: 'needs-feedback', updatedAt: NOW + 2 }),
      item('c', { status: 'completed' }),
      item('x', { status: 'cancelled', updatedAt: NOW + 5 }),
    ],
  });

  it('groups items for display', () => {
    const ids = (list: { id: string }[]) => list.map((i) => i.id);
    const all = sections(s);
    expect(ids(all.attention)).toEqual(['f', 'e']);
    expect(ids(all.running)).toEqual(['r']);
    expect(ids(all.queued)).toEqual(['q1', 'q2', 'b']);
    expect(ids(all.done)).toEqual(['x', 'c']);
    expect(ids(sections(s, 'b').queued)).toEqual(['b']);
  });

  it('summarises repos', () => {
    expect(Object.fromEntries(repoSummaries(s))).toEqual({
      a: { queued: 2, running: 1, attention: 2 },
      b: { queued: 1, running: 0, attention: 0 },
    });
  });
});

describe('item helpers', () => {
  it('titles an item by its first line', () => {
    const turn = { id: 't', kind: 'prompt' as const, createdAt: 0, output: [] };
    expect(
      itemTitle(item('x', { turns: [{ ...turn, prompt: '\n  Fix the login bug \nmore' }] })),
    ).toBe('Fix the login bug');
    expect(
      itemTitle(item('x', { turns: [{ ...turn, prompt: 'x'.repeat(200) }] }), 10),
    ).toHaveLength(10);
  });

  it('finds the latest activity and total cost', () => {
    const busy = item('x', {
      turns: [
        { id: 't1', kind: 'prompt', prompt: 'p', createdAt: 0, costUsd: 0.25, output: [] },
        {
          id: 't2',
          kind: 'reply',
          prompt: 'r',
          createdAt: 0,
          costUsd: 0.5,
          output: [
            { kind: 'tool', text: 'Bash: npm test\nmore', at: 0 },
            { kind: 'info', text: 'Weekly limit 50% used', at: 0 },
          ],
        },
      ],
    });
    expect(latestActivity(busy)).toBe('Bash: npm test');
    expect(totalCost(busy)).toBe(0.75);
    expect(totalCost(item('y'))).toBeUndefined();
  });

  it('allows replies to finished items with a session', () => {
    expect(canReply(item('x', { status: 'completed', sessionId: 's' }))).toBe(true);
    expect(canReply(item('x', { status: 'completed' }))).toBe(false);
    expect(canReply(item('x', { status: 'running', sessionId: 's' }))).toBe(false);
  });
});
