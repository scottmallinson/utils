// Parses Claude Code's `--output-format stream-json` output: one JSON message per line.
// Only the fields Prompt Queue needs are read, and anything unexpected is ignored,
// so newer CLI versions that add fields or message types keep working.

import type { LimitReport } from '../limits';

export type ClaudeEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'limit'; report: LimitReport }
  /** An assistant message the CLI synthesised from an API error, e.g. a usage limit. */
  | { type: 'api-error'; error: string; text: string }
  | {
      type: 'result';
      isError: boolean;
      subtype: string;
      text: string;
      sessionId?: string;
      costUsd?: number;
      durationMs?: number;
      numTurns?: number;
      /** Tools the agent wanted but wasn't allowed to use, e.g. `Bash (npm test)`. */
      denials: string[];
    };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseStreamLine(line: string): ClaudeEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let message: unknown;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isObject(message)) return [];

  switch (message.type) {
    case 'system': {
      const sessionId = string(message.session_id);
      if (message.subtype === 'init' && sessionId) {
        return [{ type: 'init', sessionId, model: string(message.model) }];
      }
      return [];
    }
    case 'assistant':
      return parseAssistant(message);
    case 'rate_limit_event': {
      const report = parseRateLimitInfo(message.rate_limit_info);
      return report ? [{ type: 'limit', report }] : [];
    }
    case 'result':
      return [parseResult(message)];
    default:
      return [];
  }
}

function parseAssistant(message: Json): ClaudeEvent[] {
  // Skip subagents' messages; the main agent summarises their work.
  if (message.parent_tool_use_id) return [];
  const content = isObject(message.message) ? message.message.content : undefined;
  const blocks = Array.isArray(content) ? content.filter(isObject) : [];
  const error = string(message.error);
  if (error) {
    const text = blocks
      .map((block) => string(block.text) ?? '')
      .join('\n')
      .trim();
    return [{ type: 'api-error', error, text }];
  }
  const events: ClaudeEvent[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = string(block.text)?.trim();
      if (text) events.push({ type: 'text', text });
    } else if (block.type === 'tool_use') {
      const name = string(block.name) ?? 'Tool';
      events.push({ type: 'tool', name, detail: toolDetail(block.input) });
    }
  }
  return events;
}

const STATUS: Record<string, LimitReport['status']> = {
  allowed: 'ok',
  allowed_warning: 'warning',
  rejected: 'limited',
};

export function parseRateLimitInfo(info: unknown): LimitReport | undefined {
  if (!isObject(info)) return undefined;
  const status = STATUS[string(info.status) ?? ''];
  if (!status) return undefined;
  const window = string(info.rateLimitType);
  // An "allowed" report without a window says nothing useful.
  if (!window && status !== 'limited') return undefined;
  const resetsAt = number(info.resetsAt);
  const utilization = number(info.utilization);
  return {
    window: window ?? 'usage',
    status,
    // The CLI sends epoch seconds and a 0-1 fraction.
    resetsAt: resetsAt === undefined ? undefined : resetsAt < 1e12 ? resetsAt * 1000 : resetsAt,
    utilization:
      utilization === undefined
        ? undefined
        : Math.min(100, Math.max(0, utilization <= 1 ? utilization * 100 : utilization)),
  };
}

function parseResult(message: Json): ClaudeEvent {
  const denials = Array.isArray(message.permission_denials)
    ? message.permission_denials.filter(isObject).map((denial) => {
        const name = string(denial.tool_name) ?? 'Tool';
        const detail = toolDetail(denial.tool_input);
        return detail ? `${name} (${detail})` : name;
      })
    : [];
  const errors = Array.isArray(message.errors) ? message.errors.filter(string) : [];
  return {
    type: 'result',
    isError: message.is_error === true || message.subtype !== 'success',
    subtype: string(message.subtype) ?? 'unknown',
    text: string(message.result) ?? errors.join('\n'),
    sessionId: string(message.session_id),
    costUsd: number(message.total_cost_usd),
    durationMs: number(message.duration_ms),
    numTurns: number(message.num_turns),
    denials: [...new Set(denials)],
  };
}

const DETAIL_KEYS = [
  'file_path',
  'notebook_path',
  'path',
  'command',
  'pattern',
  'url',
  'query',
  'description',
  'prompt',
];

/** A short, single-line hint of what a tool call does, e.g. its file or command. */
export function toolDetail(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  for (const key of DETAIL_KEYS) {
    const value = string(input[key])?.replace(/\s+/g, ' ').trim();
    if (value) return value.length > 120 ? `${value.slice(0, 119)}…` : value;
  }
  return undefined;
}

/** Splits a stream of chunks into complete lines. */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    return lines;
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? [rest] : [];
  }
}
