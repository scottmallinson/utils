import { describe, expect, it } from 'vitest';
import { LineSplitter, parseStreamLine, toolDetail } from './stream';

const line = (value: unknown) => JSON.stringify(value);

describe('parseStreamLine', () => {
  it('reads the session from the init message', () => {
    expect(
      parseStreamLine(line({ type: 'system', subtype: 'init', session_id: 's1', model: 'opus' })),
    ).toEqual([{ type: 'init', sessionId: 's1', model: 'opus' }]);
  });

  it('reads assistant text and tool calls', () => {
    const events = parseStreamLine(
      line({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: ' Let me look. ' },
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x' } },
          ],
        },
      }),
    );
    expect(events).toEqual([
      { type: 'text', text: 'Let me look.' },
      { type: 'tool', name: 'Edit', detail: 'src/a.ts' },
    ]);
  });

  it('skips subagent messages', () => {
    expect(
      parseStreamLine(
        line({
          type: 'assistant',
          parent_tool_use_id: 'tool-1',
          message: { content: [{ type: 'text', text: 'sub' }] },
        }),
      ),
    ).toEqual([]);
  });

  it('reads API errors synthesised as assistant messages', () => {
    expect(
      parseStreamLine(
        line({
          type: 'assistant',
          error: 'rate_limit',
          message: { content: [{ type: 'text', text: "You've hit your limit · resets 3pm" }] },
        }),
      ),
    ).toEqual([
      { type: 'api-error', error: 'rate_limit', text: "You've hit your limit · resets 3pm" },
    ]);
  });

  it('normalises rate limit events', () => {
    expect(
      parseStreamLine(
        line({
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'allowed_warning',
            rateLimitType: 'seven_day',
            utilization: 0.82,
            resetsAt: 1760000000,
          },
        }),
      ),
    ).toEqual([
      {
        type: 'limit',
        report: {
          window: 'seven_day',
          status: 'warning',
          utilization: 82,
          resetsAt: 1760000000000,
        },
      },
    ]);
    expect(
      parseStreamLine(line({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })),
    ).toEqual([
      {
        type: 'limit',
        report: { window: 'usage', status: 'limited', utilization: undefined, resetsAt: undefined },
      },
    ]);
    // Nothing to learn from an "allowed" with no window.
    expect(
      parseStreamLine(line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })),
    ).toEqual([]);
  });

  it('reads results, including permission denials', () => {
    const [event] = parseStreamLine(
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done.',
        session_id: 's1',
        total_cost_usd: 0.12,
        duration_ms: 3000,
        num_turns: 4,
        permission_denials: [
          { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' } },
          { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'npm test' } },
        ],
      }),
    );
    expect(event).toEqual({
      type: 'result',
      isError: false,
      subtype: 'success',
      text: 'Done.',
      sessionId: 's1',
      costUsd: 0.12,
      durationMs: 3000,
      numTurns: 4,
      denials: ['Bash (npm test)'],
    });
  });

  it('treats error subtypes as errors', () => {
    const [event] = parseStreamLine(
      line({ type: 'result', subtype: 'error_max_turns', is_error: false, errors: ['Too many'] }),
    );
    expect(event).toMatchObject({ isError: true, subtype: 'error_max_turns', text: 'Too many' });
  });

  it('ignores junk and unknown messages', () => {
    expect(parseStreamLine('')).toEqual([]);
    expect(parseStreamLine('Loading…')).toEqual([]);
    expect(parseStreamLine('{"type":')).toEqual([]);
    expect(parseStreamLine(line({ type: 'stream_event' }))).toEqual([]);
    expect(parseStreamLine('[1,2]')).toEqual([]);
  });
});

describe('toolDetail', () => {
  it('picks the most useful field and keeps it short', () => {
    expect(toolDetail({ command: 'ls\n  -la' })).toBe('ls -la');
    expect(toolDetail({ pattern: 'TODO', path: 'src' })).toBe('src');
    expect(toolDetail({ command: 'x'.repeat(200) })).toHaveLength(120);
    expect(toolDetail({ other: 1 })).toBeUndefined();
    expect(toolDetail('nope')).toBeUndefined();
  });
});

describe('LineSplitter', () => {
  it('joins partial chunks into lines', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a":')).toEqual([]);
    expect(splitter.push('1}\r\n{"b"')).toEqual(['{"a":1}']);
    expect(splitter.push(':2}\n')).toEqual(['{"b":2}']);
    expect(splitter.push('tail')).toEqual([]);
    expect(splitter.flush()).toEqual(['tail']);
    expect(splitter.flush()).toEqual([]);
  });
});
