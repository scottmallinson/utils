// Owns the app state in the main process: applies commands, starts runs when the
// scheduler says so, and turns each run's output into state changes. It has no
// Electron imports, so it's tested in Node with a fake runner.

import { buildClaudeArgs } from '../shared/claude/args';
import { type RunStats, RunTracker } from '../shared/claude/run';
import { parseStreamLine } from '../shared/claude/stream';
import type { Command } from '../shared/commands';
import { nextLimitChange } from '../shared/limits';
import { type Action, type FinishOutcome, reduce } from '../shared/queue';
import { planQueue } from '../shared/scheduler';
import type { AppState, OutputEntry, QueueItem } from '../shared/types';

export interface RunRequest {
  cwd: string;
  prompt: string;
  args: string[];
  /** The `claude` path from settings; empty to find it. */
  claudePath: string;
}

export interface RunExit {
  exitCode: number | null;
  stderr: string;
  /** Set when the process couldn't be started at all. */
  spawnError?: string;
  cancelled: boolean;
}

export interface RunCallbacks {
  onLine(line: string): void;
  onExit(exit: RunExit): void;
}

export type StartRun = (request: RunRequest, callbacks: RunCallbacks) => { cancel(): void };

export type Notice =
  | { kind: 'needs-feedback' | 'error' | 'completed'; item: QueueItem }
  | { kind: 'limited'; message: string }
  | { kind: 'paused'; message: string }
  | { kind: 'drained' };

export interface EngineDeps {
  state: AppState;
  startRun: StartRun;
  /** Called after every change. */
  onChange(state: AppState): void;
  onNotice?(notice: Notice): void;
  now?: () => number;
  newId?: () => string;
  newSessionId?: () => string;
  setTimer?: (callback: () => void, ms: number) => () => void;
}

/** Longest single timer; limit resets further out are re-checked after this. */
const MAX_TIMER_MS = 60 * 60_000;

export class Engine {
  private state: AppState;
  private readonly runs = new Map<string, { cancel(): void }>();
  private clearTimer?: () => void;
  private scheduling = false;
  private rescheduleNeeded = false;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly newSessionId: () => string;
  private readonly setTimer: (callback: () => void, ms: number) => () => void;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.newSessionId = deps.newSessionId ?? (() => crypto.randomUUID());
    this.setTimer =
      deps.setTimer ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      });
    this.state = reduce(deps.state, { type: 'recover' }, this.context());
  }

  getState(): AppState {
    return this.state;
  }

  /** Starts whatever can run. Call once after construction. */
  start() {
    this.schedule();
  }

  command(command: Command) {
    if (command.type === 'cancel' && this.runs.has(command.itemId)) {
      this.runs.get(command.itemId)?.cancel();
      return;
    }
    this.dispatch(command);
  }

  addRepo(name: string, path: string) {
    this.dispatch({ type: 'addRepo', name, path });
  }

  hasRunning(): boolean {
    return this.runs.size > 0;
  }

  /** Stops every run, e.g. when quitting. Items are left marked as running until they exit. */
  cancelAll() {
    for (const run of this.runs.values()) run.cancel();
  }

  dispose() {
    this.clearTimer?.();
    this.cancelAll();
  }

  private context() {
    return { now: this.now(), id: this.newId };
  }

  private dispatch(action: Action) {
    const next = reduce(this.state, action, this.context());
    if (next === this.state) return;
    this.state = next;
    this.deps.onChange(next);
    this.schedule();
  }

  private schedule() {
    // Starting a run dispatches, which schedules again: finish this pass first.
    if (this.scheduling) {
      this.rescheduleNeeded = true;
      return;
    }
    this.scheduling = true;
    try {
      do {
        this.rescheduleNeeded = false;
        for (const planned of planQueue(this.state, this.now()).start) {
          const item = this.state.items.find((candidate) => candidate.id === planned.id);
          if (item?.status === 'queued') this.startItem(item);
        }
      } while (this.rescheduleNeeded);
    } finally {
      this.scheduling = false;
    }

    const now = this.now();
    // Wake up when a limit resets or a pause ends.
    this.clearTimer?.();
    this.clearTimer = undefined;
    const next = nextLimitChange(this.state.limits['claude-code'], now);
    if (next !== undefined) {
      this.clearTimer = this.setTimer(
        () => {
          this.clearTimer = undefined;
          this.deps.onChange(this.state);
          this.schedule();
        },
        Math.min(MAX_TIMER_MS, next - now + 50),
      );
    }
  }

  private startItem(item: QueueItem) {
    const repo = this.state.repos.find((candidate) => candidate.id === item.repoId);
    const turn = item.turns.at(-1);
    if (!repo || !turn) return;

    // A first prompt starts a new session; replies and continuations resume it.
    const resumeSessionId = turn.kind === 'prompt' ? undefined : item.sessionId;
    const newSessionId = resumeSessionId ? undefined : this.newSessionId();
    let args: string[];
    try {
      if (turn.kind !== 'prompt' && !resumeSessionId) throw new Error('No session to continue.');
      args = buildClaudeArgs({ options: item.options, resumeSessionId, newSessionId });
    } catch (error) {
      this.dispatch({ type: 'runStarted', itemId: item.id });
      this.finishRun(item.id, { kind: 'error', message: errorMessage(error) }, {});
      return;
    }

    const tracker = new RunTracker();
    tracker.sessionId = resumeSessionId ?? newSessionId;
    // Mark it running before starting, so the scheduler doesn't pick it again.
    this.runs.set(item.id, { cancel: () => {} });
    this.dispatch({ type: 'runStarted', itemId: item.id, sessionId: tracker.sessionId });

    const handle = this.deps.startRun(
      { cwd: repo.path, prompt: turn.prompt, args, claudePath: this.state.settings.claudePath },
      {
        onLine: (line) => {
          const entries: OutputEntry[] = [];
          for (const event of parseStreamLine(line)) {
            if (event.type === 'limit') {
              this.dispatch({ type: 'limitReport', toolId: item.toolId, report: event.report });
            }
            const entry = tracker.handle(event);
            if (entry) entries.push({ ...entry, at: this.now() });
          }
          if (entries.length > 0) this.dispatch({ type: 'runOutput', itemId: item.id, entries });
        },
        onExit: (exit) => {
          this.runs.delete(item.id);
          if (exit.cancelled) {
            this.finishRun(item.id, { kind: 'cancelled' }, tracker.stats());
          } else if (exit.spawnError) {
            // Without a working CLI every prompt would fail, so stop the queue first.
            this.dispatch({ type: 'setPaused', paused: true });
            this.finishRun(item.id, { kind: 'error', message: exit.spawnError }, tracker.stats());
            this.deps.onNotice?.({ kind: 'paused', message: exit.spawnError });
          } else {
            const outcome = tracker.finish({
              exitCode: exit.exitCode,
              stderr: exit.stderr,
              now: this.now(),
              questionsNeedFeedback: this.state.settings.questionsNeedFeedback,
            });
            this.finishRun(item.id, outcome, tracker.stats());
          }
        },
      },
    );
    if (this.runs.has(item.id)) this.runs.set(item.id, handle);
  }

  private finishRun(itemId: string, outcome: FinishOutcome, stats: RunStats) {
    this.dispatch({ type: 'runFinished', itemId, outcome, stats });
    const item = this.state.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (outcome.kind === 'limited') {
      this.deps.onNotice?.({ kind: 'limited', message: outcome.message });
    } else if (item.status === 'needs-feedback' || item.status === 'error') {
      this.deps.onNotice?.({ kind: item.status, item });
    } else if (item.status === 'completed') {
      this.deps.onNotice?.({ kind: 'completed', item });
    }
    const idle = !this.state.items.some(
      (candidate) => candidate.status === 'running' || candidate.status === 'queued',
    );
    if (idle && outcome.kind !== 'cancelled') this.deps.onNotice?.({ kind: 'drained' });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
