// Follows one Claude Code run and decides how it ended.

import { type LimitReport, windowLabel } from '../limits';
import type { OutputEntry } from '../types';
import { isUsageLimitMessage, parseResetTime } from './limitText';
import type { ClaudeEvent } from './stream';

export type RunOutcome =
  | { kind: 'completed'; result: string }
  | { kind: 'needs-feedback'; reason: string; result: string }
  | { kind: 'limited'; message: string; resetsAt?: number; madeProgress: boolean }
  | { kind: 'error'; message: string };

export interface RunStats {
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
}

export interface FinishInput {
  exitCode: number | null;
  stderr: string;
  now: number;
  questionsNeedFeedback: boolean;
}

const RESULT_ERRORS: Record<string, string> = {
  error_max_turns: 'Stopped after reaching the maximum number of turns.',
  error_max_budget_usd: 'Stopped after reaching the spending limit.',
  error_during_execution: 'Claude Code hit an error while working.',
};

export class RunTracker {
  sessionId?: string;
  private madeProgress = false;
  private limitReport?: LimitReport;
  private apiError?: { error: string; text: string };
  private result?: Extract<ClaudeEvent, { type: 'result' }>;

  /** Records an event and returns what to show in the item's output, if anything. */
  handle(event: ClaudeEvent): Omit<OutputEntry, 'at'> | undefined {
    switch (event.type) {
      case 'init':
        this.sessionId = event.sessionId;
        return undefined;
      case 'text':
        this.madeProgress = true;
        return { kind: 'text', text: event.text };
      case 'tool':
        this.madeProgress = true;
        return { kind: 'tool', text: event.detail ? `${event.name}: ${event.detail}` : event.name };
      case 'limit':
        return this.handleLimit(event.report);
      case 'api-error':
        this.apiError = { error: event.error, text: event.text };
        return { kind: 'error', text: event.text || `API error: ${event.error}` };
      case 'result':
        this.result = event;
        if (event.sessionId) this.sessionId = event.sessionId;
        return event.isError && event.text && event.text !== this.apiError?.text
          ? { kind: 'error', text: event.text }
          : undefined;
    }
  }

  private handleLimit(report: LimitReport): Omit<OutputEntry, 'at'> | undefined {
    const label = windowLabel(report.window);
    if (report.status === 'limited') {
      this.limitReport = report;
      return {
        kind: 'info',
        text: `${label} limit reached${report.resetsAt ? `, resets ${new Date(report.resetsAt).toLocaleString()}` : ''}`,
      };
    }
    if (report.status === 'warning' && report.utilization !== undefined) {
      return { kind: 'info', text: `${label} limit ${Math.round(report.utilization)}% used` };
    }
    return undefined;
  }

  stats(): RunStats {
    return {
      sessionId: this.sessionId,
      costUsd: this.result?.costUsd,
      durationMs: this.result?.durationMs,
      numTurns: this.result?.numTurns,
    };
  }

  finish({ exitCode, stderr, now, questionsNeedFeedback }: FinishInput): RunOutcome {
    const result = this.result;
    const limitText = [this.apiError?.text, result?.isError ? result.text : undefined, stderr]
      .filter((text): text is string => Boolean(text))
      .map((text) => text.trim())
      .find(isUsageLimitMessage);

    if (this.limitReport || limitText || this.apiError?.error === 'rate_limit') {
      const message = limitText ?? this.apiError?.text ?? 'Usage limit reached';
      return {
        kind: 'limited',
        message: firstLine(message),
        resetsAt:
          this.limitReport?.resetsAt ?? (limitText ? parseResetTime(limitText, now) : undefined),
        madeProgress: this.madeProgress,
      };
    }

    if (result && !result.isError) {
      if (result.denials.length > 0) {
        return {
          kind: 'needs-feedback',
          reason: `Needs permission: ${result.denials.join(', ')}`,
          result: result.text,
        };
      }
      if (questionsNeedFeedback && endsWithQuestion(result.text)) {
        return { kind: 'needs-feedback', reason: 'Claude asked a question', result: result.text };
      }
      return { kind: 'completed', result: result.text };
    }

    if (this.apiError?.error === 'authentication_failed') {
      return {
        kind: 'error',
        message: 'Claude Code isn’t signed in. Run `claude` in a terminal and log in, then retry.',
      };
    }
    if (result) {
      return {
        kind: 'error',
        message: result.text || RESULT_ERRORS[result.subtype] || 'Claude Code reported an error.',
      };
    }
    if (this.apiError) return { kind: 'error', message: this.apiError.text || this.apiError.error };
    const detail = lastLines(stderr);
    if (exitCode !== 0) {
      return {
        kind: 'error',
        message: detail || `Claude Code exited with code ${exitCode ?? 'unknown'}.`,
      };
    }
    return { kind: 'error', message: detail || 'Claude Code finished without a result.' };
  }
}

/** Whether the agent's final message ends by asking something. */
export function endsWithQuestion(text: string): boolean {
  const lastParagraph =
    text
      .trim()
      .split(/\n\s*\n/)
      .pop() ?? '';
  return /\?$/.test(lastParagraph.replace(/[\s*_`)"'”’\]]+$/, ''));
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? text;
}

function lastLines(text: string, max = 600): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}
