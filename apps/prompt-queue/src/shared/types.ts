/** The agentic tools Prompt Queue can drive. Only Claude Code so far. */
export type ToolId = 'claude-code';

export type Priority = 'high' | 'normal' | 'low';

export const PRIORITIES: readonly Priority[] = ['high', 'normal', 'low'];

/**
 * Stored status of a queue item. Why a queued item isn't running yet (limits,
 * repo busy, paused) is worked out by the scheduler, not stored.
 */
export type ItemStatus =
  | 'queued'
  | 'running'
  | 'needs-feedback'
  | 'completed'
  | 'error'
  | 'cancelled';

/** Claude Code permission modes. `default` passes no flag, so the CLI's own default applies. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
];

export interface Repo {
  id: string;
  name: string;
  path: string;
  paused: boolean;
}

export interface OutputEntry {
  kind: 'text' | 'tool' | 'info' | 'error';
  text: string;
  at: number;
}

/** One message sent to the agent: the original prompt, a reply, or a continuation. */
export interface Turn {
  id: string;
  kind: 'prompt' | 'reply' | 'continue';
  prompt: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** The permission mode this turn ran with, set when it starts. */
  permissionMode?: PermissionMode;
  output: OutputEntry[];
  /** The agent's final message. */
  result?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
}

export interface RunOptions {
  /** Model alias or name; empty for the tool's default. */
  model: string;
  permissionMode: PermissionMode;
}

export interface QueueItem {
  id: string;
  repoId: string;
  toolId: ToolId;
  priority: Priority;
  /** Order within the queue; lower runs first (after priority). */
  rank: number;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  options: RunOptions;
  /** The agent session, once one exists. Replies resume it. */
  sessionId?: string;
  /** Never empty. The last turn is the one that runs next or ran last. */
  turns: Turn[];
  /** Why the item needs attention: the error, or what the agent is waiting for. */
  message?: string;
}

export interface LimitWindow {
  status: 'ok' | 'warning' | 'limited';
  /** Percentage used, 0-100, when the tool reported it. */
  utilization?: number;
  /** When the window resets (ms since epoch), when known. */
  resetsAt?: number;
  updatedAt: number;
}

export interface ToolLimits {
  /** Keyed by the tool's own window name, e.g. `five_hour`, `seven_day`. */
  windows: Record<string, LimitWindow>;
  /** Nothing starts for this tool before this time (ms since epoch). */
  pausedUntil?: number;
  pausedReason?: string;
}

export interface Settings {
  /** How many prompts may run at once, across all repos. */
  maxConcurrent: number;
  /** Hold low-priority prompts once any limit window is at least this % used. */
  holdLowAbove: number;
  /** Hold normal-priority prompts once any limit window is at least this % used. */
  holdNormalAbove: number;
  /** Don't start more prompts in a repo while one there waits for feedback. */
  pauseRepoOnFeedback: boolean;
  /** Treat a final message that ends in a question as waiting for feedback. */
  questionsNeedFeedback: boolean;
  notifications: boolean;
  defaultPermissionMode: PermissionMode;
  defaultModel: string;
  /** Path to the `claude` executable; empty to find it automatically. */
  claudePath: string;
}

export interface AppState {
  version: 1;
  /** Pauses the whole queue. Running prompts finish. */
  paused: boolean;
  repos: Repo[];
  items: QueueItem[];
  limits: Record<ToolId, ToolLimits>;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  maxConcurrent: 1,
  holdLowAbove: 70,
  holdNormalAbove: 90,
  pauseRepoOnFeedback: true,
  questionsNeedFeedback: true,
  notifications: true,
  defaultPermissionMode: 'acceptEdits',
  defaultModel: '',
  claudePath: '',
};

export const MAX_CONCURRENT = 4;

export function createInitialState(): AppState {
  return {
    version: 1,
    paused: false,
    repos: [],
    items: [],
    limits: { 'claude-code': { windows: {} } },
    settings: { ...DEFAULT_SETTINGS },
  };
}
