#!/usr/bin/env node
// A stand-in for the `claude` CLI in e2e tests. It prints the same stream-json
// messages as `claude -p --output-format stream-json --verbose`, choosing what
// happens from markers in the prompt:
//   [question]  ends with a question (waiting on feedback)
//   [deny]      reports a denied tool (waiting on feedback)
//   [limit]     hits the 5-hour limit
//   [fail]      crashes with an error on stderr
//   [slow]      takes a couple of seconds
// Each run is appended to $FAKE_CLAUDE_LOG as a JSON line, if set.

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.0 (Claude Code, fake)');
  process.exit(0);
}

const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const sessionId = flag('--resume') ?? flag('--session-id') ?? 'no-session';

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({ args, prompt, cwd: process.cwd() })}\n`,
  );
}

const emit = (message) =>
  process.stdout.write(`${JSON.stringify({ ...message, session_id: sessionId })}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pause = prompt.includes('[slow]') ? 1500 : 50;
const inHours = (hours) => Math.round(Date.now() / 1000 + hours * 3600);
const assistant = (content, extra = {}) =>
  emit({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content },
    ...extra,
  });
const result = (text, extra = {}) =>
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    duration_ms: 1234,
    num_turns: 3,
    total_cost_usd: 0.0421,
    permission_denials: [],
    ...extra,
  });

emit({ type: 'system', subtype: 'init', cwd: process.cwd(), model: 'claude-fake', tools: [] });
emit({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed_warning',
    rateLimitType: 'five_hour',
    utilization: 0.42,
    resetsAt: inHours(3),
  },
});
emit({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed_warning',
    rateLimitType: 'seven_day',
    utilization: 0.18,
    resetsAt: inHours(80),
  },
});
await sleep(pause);
assistant([{ type: 'text', text: 'Looking at the code.' }]);
await sleep(pause);
assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/index.ts' } }]);
await sleep(pause);

if (prompt.includes('[fail]')) {
  process.stderr.write('Error: something broke\n');
  process.exit(1);
}

if (prompt.includes('[limit]')) {
  emit({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: inHours(2) },
  });
  const text = "You've hit your limit · resets 5pm";
  assistant([{ type: 'text', text }], { error: 'rate_limit' });
  result(text, { is_error: true });
  process.exit(1);
}

if (prompt.includes('[question]')) {
  result('I found two ways to do this. Should I use the existing helper or write a new one?');
} else if (prompt.includes('[deny]')) {
  result('I need to run the tests to check this.', {
    permission_denials: [
      { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'npm test' } },
    ],
  });
} else {
  assistant([{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'src/index.ts' } }]);
  result(`Done: ${prompt.trim().split('\n')[0]}`);
}
