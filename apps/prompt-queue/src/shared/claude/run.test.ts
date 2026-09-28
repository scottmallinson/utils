import { describe, expect, it } from 'vitest';
import { endsWithQuestion, type FinishInput, RunTracker } from './run';
import type { ClaudeEvent } from './stream';

const NOW = Date.UTC(2026, 8, 27, 12, 0);
const exit = (overrides: Partial<FinishInput> = {}): FinishInput => ({
  exitCode: 0,
  stderr: '',
  now: NOW,
  questionsNeedFeedback: true,
  ...overrides,
});

function result(overrides: Partial<Extract<ClaudeEvent, { type: 'result' }>> = {}): ClaudeEvent {
  return {
    type: 'result',
    isError: false,
    subtype: 'success',
    text: 'All done.',
    sessionId: 's1',
    denials: [],
    ...overrides,
  };
}

function track(events: ClaudeEvent[]) {
  const tracker = new RunTracker();
  const output = events.map((event) => tracker.handle(event));
  return { tracker, output };
}

describe('RunTracker', () => {
  it('completes and reports stats', () => {
    const { tracker, output } = track([
      { type: 'init', sessionId: 's1' },
      { type: 'text', text: 'Working' },
      { type: 'tool', name: 'Bash', detail: 'npm test' },
      result({ costUsd: 0.5, durationMs: 1000, numTurns: 3 }),
    ]);
    expect(output).toEqual([
      undefined,
      { kind: 'text', text: 'Working' },
      { kind: 'tool', text: 'Bash: npm test' },
      undefined,
    ]);
    expect(tracker.finish(exit())).toEqual({ kind: 'completed', result: 'All done.' });
    expect(tracker.stats()).toEqual({
      sessionId: 's1',
      costUsd: 0.5,
      durationMs: 1000,
      numTurns: 3,
    });
  });

  it('needs feedback when tools were denied', () => {
    const { tracker } = track([result({ denials: ['Bash (npm test)', 'Write (a.ts)'] })]);
    expect(tracker.finish(exit())).toEqual({
      kind: 'needs-feedback',
      reason: 'Needs permission: Bash (npm test), Write (a.ts)',
      result: 'All done.',
    });
  });

  it('needs feedback when the agent asks a question, if enabled', () => {
    const { tracker } = track([result({ text: 'Which database should I use?' })]);
    expect(tracker.finish(exit()).kind).toBe('needs-feedback');
    expect(tracker.finish(exit({ questionsNeedFeedback: false })).kind).toBe('completed');
  });

  it('reports a limit from a rate limit event, with its reset time', () => {
    const resetsAt = NOW + 3_600_000;
    const { tracker, output } = track([
      { type: 'text', text: 'Starting' },
      { type: 'limit', report: { window: 'five_hour', status: 'limited', resetsAt } },
      { type: 'api-error', error: 'rate_limit', text: "You've hit your limit · resets 1pm" },
      result({ isError: true, text: "You've hit your limit · resets 1pm" }),
    ]);
    expect(output[1]).toMatchObject({
      kind: 'info',
      text: expect.stringMatching(/^5-hour limit reached/),
    });
    // The same message as the API error isn't repeated.
    expect(output[3]).toBeUndefined();
    expect(tracker.finish(exit({ exitCode: 1 }))).toEqual({
      kind: 'limited',
      message: "You've hit your limit · resets 1pm",
      resetsAt,
      madeProgress: true,
    });
  });

  it('falls back to the limit message text for the reset time', () => {
    const { tracker } = track([
      result({ isError: true, text: "You've hit your limit · resets 3pm (UTC)" }),
    ]);
    expect(tracker.finish(exit({ exitCode: 1 }))).toEqual({
      kind: 'limited',
      message: "You've hit your limit · resets 3pm (UTC)",
      resetsAt: Date.UTC(2026, 8, 27, 15, 0),
      madeProgress: false,
    });
  });

  it('spots a limit reported only on stderr', () => {
    const { tracker } = track([]);
    expect(
      tracker.finish(exit({ exitCode: 1, stderr: 'Claude AI usage limit reached|1760000000\n' })),
    ).toMatchObject({ kind: 'limited', resetsAt: 1760000000000 });
  });

  it('shows usage warnings', () => {
    const { output } = track([
      { type: 'limit', report: { window: 'seven_day', status: 'warning', utilization: 81.4 } },
      { type: 'limit', report: { window: 'seven_day', status: 'ok' } },
    ]);
    expect(output).toEqual([{ kind: 'info', text: 'Weekly limit 81% used' }, undefined]);
  });

  it('reports errors', () => {
    expect(track([result({ isError: true, text: 'Boom' })]).tracker.finish(exit())).toEqual({
      kind: 'error',
      message: 'Boom',
    });
    expect(
      track([result({ isError: true, subtype: 'error_max_turns', text: '' })]).tracker.finish(
        exit(),
      ),
    ).toEqual({ kind: 'error', message: 'Stopped after reaching the maximum number of turns.' });
    expect(
      track([
        { type: 'api-error', error: 'authentication_failed', text: 'Invalid API key' },
      ]).tracker.finish(exit({ exitCode: 1 })).kind,
    ).toBe('error');
    expect(track([]).tracker.finish(exit({ exitCode: 2, stderr: 'bad flag\n' }))).toEqual({
      kind: 'error',
      message: 'bad flag',
    });
    expect(track([]).tracker.finish(exit({ exitCode: 3 }))).toEqual({
      kind: 'error',
      message: 'Claude Code exited with code 3.',
    });
    expect(track([]).tracker.finish(exit())).toEqual({
      kind: 'error',
      message: 'Claude Code finished without a result.',
    });
  });
});

describe('endsWithQuestion', () => {
  it.each([
    ['Should I also update the docs?', true],
    ['Done.\n\nWant me to open a PR?**', true],
    ['Which one?\n\nI went with the first option.', false],
    ['Fixed the `foo?` helper.', false],
    ['', false],
  ])('%j → %s', (text, expected) => {
    expect(endsWithQuestion(text)).toBe(expected);
  });
});
