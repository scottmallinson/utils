import { describe, expect, it } from 'vitest';
import { item, NOW, state } from '../shared/__fixtures__/state';
import type { AppState } from '../shared/types';
import { Engine, type Notice, type RunCallbacks, type RunRequest } from './engine';

const SESSION = '123e4567-e89b-12d3-a456-426614174000';
const line = (value: unknown) => JSON.stringify(value);
const result = (text: string, extra: object = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: SESSION,
    ...extra,
  });

interface FakeRun {
  request: RunRequest;
  callbacks: RunCallbacks;
  cancelled: boolean;
  finish(lines: string[], exitCode?: number): void;
}

function setup(initial: AppState) {
  const runs: FakeRun[] = [];
  const notices: Notice[] = [];
  const timers: { callback: () => void; at: number }[] = [];
  let now = NOW;
  let ids = 0;
  const engine = new Engine({
    state: initial,
    now: () => now,
    newId: () => `new-${++ids}`,
    newSessionId: () => SESSION,
    onChange: () => {},
    onNotice: (notice) => notices.push(notice),
    setTimer: (callback, ms) => {
      const timer = { callback, at: now + ms };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    startRun: (request, callbacks) => {
      const run: FakeRun = {
        request,
        callbacks,
        cancelled: false,
        finish(lines, exitCode = 0) {
          for (const l of lines) callbacks.onLine(l);
          callbacks.onExit({ exitCode, stderr: '', cancelled: run.cancelled });
        },
      };
      runs.push(run);
      return {
        cancel: () => {
          run.cancelled = true;
          run.finish([], 143);
        },
      };
    },
  });
  engine.start();
  const status = () => Object.fromEntries(engine.getState().items.map((i) => [i.id, i.status]));
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => t.at <= now)) timer.callback();
  };
  return { engine, runs, notices, status, advance };
}

describe('Engine', () => {
  it('runs queued prompts one after another', () => {
    const { runs, status } = setup(
      state({ items: [item('1', { rank: 1 }), item('2', { rank: 2 })] }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.request).toEqual({
      cwd: '/code/a',
      prompt: 'Prompt 1',
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
        '--session-id',
        SESSION,
      ],
      claudePath: '',
    });
    expect(status()).toEqual({ '1': 'running', '2': 'queued' });

    runs[0]?.finish([
      line({ type: 'system', subtype: 'init', session_id: SESSION }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it' }] } }),
      result('Fixed.'),
    ]);
    expect(status()).toEqual({ '1': 'completed', '2': 'running' });
    expect(runs).toHaveLength(2);
  });

  it('records output and the session', () => {
    const { engine, runs } = setup(state({ items: [item('1')] }));
    runs[0]?.finish([
      line({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] },
      }),
      result('Done.', { total_cost_usd: 0.02 }),
    ]);
    const [done] = engine.getState().items;
    expect(done?.sessionId).toBe(SESSION);
    expect(done?.turns[0]?.output.map((o) => o.text)).toEqual(['Read: a.ts']);
    expect(done?.turns[0]).toMatchObject({ result: 'Done.', costUsd: 0.02 });
  });

  it('resumes the session for replies', () => {
    const { engine, runs, status, notices } = setup(state({ items: [item('1')] }));
    runs[0]?.finish([result('Should I use Postgres or SQLite?')]);
    expect(status()).toEqual({ '1': 'needs-feedback' });
    expect(notices.map((n) => n.kind)).toEqual(['needs-feedback', 'drained']);

    engine.command({ type: 'reply', itemId: '1', text: 'SQLite' });
    expect(runs[1]?.request.prompt).toBe('SQLite');
    expect(runs[1]?.request.args.slice(-2)).toEqual(['--resume', SESSION]);
  });

  it('pauses on a usage limit and resumes after the reset', () => {
    const { engine, runs, status, advance, notices } = setup(
      state({ items: [item('1', { rank: 1 }), item('2', { rank: 2 })] }),
    );
    runs[0]?.finish(
      [
        line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Starting' }] } }),
        line({
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'rejected',
            rateLimitType: 'five_hour',
            resetsAt: (NOW + 3_600_000) / 1000,
          },
        }),
        result("You've hit your limit · resets 1pm", { is_error: true }),
      ],
      1,
    );
    expect(status()).toEqual({ '1': 'queued', '2': 'queued' });
    expect(runs).toHaveLength(1);
    expect(notices.map((n) => n.kind)).toEqual(['limited']);
    expect(engine.getState().limits['claude-code'].windows.five_hour?.status).toBe('limited');

    advance(30 * 60_000);
    expect(runs).toHaveLength(1);
    advance(31 * 60_000);
    expect(runs).toHaveLength(2);
    // It picks up where it left off.
    expect(runs[1]?.request.prompt).toBe('Continue from where you left off.');
    expect(runs[1]?.request.args).toContain('--resume');
  });

  it('cancels running prompts', () => {
    const { engine, runs, status } = setup(
      state({ items: [item('1', { rank: 1 }), item('2', { rank: 2 })] }),
    );
    engine.command({ type: 'cancel', itemId: '1' });
    expect(runs[0]?.cancelled).toBe(true);
    expect(status()).toEqual({ '1': 'cancelled', '2': 'running' });
  });

  it('pauses the queue when Claude Code is missing', async () => {
    const initial = state({ items: [item('1', { rank: 1 }), item('2', { rank: 2 })] });
    const notices: Notice[] = [];
    const engine = new Engine({
      state: initial,
      onChange: () => {},
      onNotice: (notice) => notices.push(notice),
      startRun: (_request, callbacks) => {
        // Like the real runner, which finds the CLI asynchronously.
        queueMicrotask(() =>
          callbacks.onExit({
            exitCode: null,
            stderr: '',
            spawnError: 'Couldn’t find Claude Code.',
            cancelled: false,
          }),
        );
        return { cancel: () => {} };
      },
    });
    engine.start();
    await Promise.resolve();
    const state2 = engine.getState();
    expect(state2.paused).toBe(true);
    expect(state2.items.map((i) => i.status)).toEqual(['error', 'queued']);
    expect(notices.map((n) => n.kind)).toEqual(['error', 'paused']);
  });

  it('marks runs interrupted by a restart', () => {
    const { status } = setup(state({ items: [item('1', { status: 'running' })] }));
    expect(status()).toEqual({ '1': 'error' });
  });
});
