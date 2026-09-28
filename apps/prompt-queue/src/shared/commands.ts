// Commands the UI sends to the main process. Everything from the renderer is
// untrusted input, so `parseCommand` checks every field before the queue sees it.

import { isValidModel } from './claude/args';
import {
  MAX_CONCURRENT,
  PERMISSION_MODES,
  type PermissionMode,
  PRIORITIES,
  type Priority,
  type RunOptions,
  type Settings,
  type ToolId,
} from './types';

export const MAX_PROMPT_LENGTH = 100_000;

export type Command =
  | {
      type: 'add';
      repoId: string;
      prompt: string;
      priority: Priority;
      options: RunOptions;
      /** Put it at the front of its priority instead of the back. */
      atTop?: boolean;
    }
  | { type: 'edit'; itemId: string; prompt?: string; options?: Partial<RunOptions> }
  /** Moves an item to where `targetId` is in the queue as shown (optionally filtered to a repo). */
  | { type: 'move'; itemId: string; targetId: string; repoId?: string }
  | { type: 'moveToEnd'; itemId: string; end: 'top' | 'bottom'; repoId?: string }
  | { type: 'setPriority'; itemId: string; priority: Priority }
  | { type: 'cancel'; itemId: string }
  | { type: 'retry'; itemId: string }
  | { type: 'reply'; itemId: string; text: string; options?: Partial<RunOptions> }
  | { type: 'resolve'; itemId: string }
  | { type: 'remove'; itemId: string }
  | { type: 'clearFinished'; repoId?: string }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setRepoPaused'; repoId: string; paused: boolean }
  | { type: 'removeRepo'; repoId: string }
  | { type: 'resumeTool'; toolId: ToolId }
  | { type: 'updateSettings'; settings: Partial<Settings> };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const id = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : undefined;

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_PROMPT_LENGTH ? trimmed : undefined;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

const optionalRepo = (value: unknown): string | undefined | null =>
  value === undefined ? undefined : (id(value) ?? null);

function parseOptions(value: unknown): Partial<RunOptions> | undefined {
  if (value === undefined) return {};
  if (!isObject(value)) return undefined;
  const options: Partial<RunOptions> = {};
  if (value.model !== undefined) {
    if (typeof value.model !== 'string' || !isValidModel(value.model.trim())) return undefined;
    options.model = value.model.trim();
  }
  if (value.permissionMode !== undefined) {
    const mode = oneOf<PermissionMode>(value.permissionMode, PERMISSION_MODES);
    if (!mode) return undefined;
    options.permissionMode = mode;
  }
  return options;
}

export function parseCommand(value: unknown): Command | undefined {
  if (!isObject(value)) return undefined;
  const itemId = id(value.itemId);
  switch (value.type) {
    case 'add': {
      const repoId = id(value.repoId);
      const prompt = text(value.prompt);
      const priority = oneOf(value.priority, PRIORITIES);
      const options = parseOptions(value.options);
      if (!repoId || !prompt || !priority || !options) return undefined;
      if (options.model === undefined || options.permissionMode === undefined) return undefined;
      return {
        type: 'add',
        repoId,
        prompt,
        priority,
        options: { model: options.model, permissionMode: options.permissionMode },
        atTop: value.atTop === true,
      };
    }
    case 'edit': {
      const prompt = value.prompt === undefined ? undefined : text(value.prompt);
      const options = parseOptions(value.options);
      if (!itemId || !options || (value.prompt !== undefined && !prompt)) return undefined;
      return { type: 'edit', itemId, prompt, options };
    }
    case 'move': {
      const targetId = id(value.targetId);
      const repoId = optionalRepo(value.repoId);
      if (!itemId || !targetId || repoId === null) return undefined;
      return { type: 'move', itemId, targetId, repoId };
    }
    case 'moveToEnd': {
      const end = oneOf(value.end, ['top', 'bottom'] as const);
      const repoId = optionalRepo(value.repoId);
      if (!itemId || !end || repoId === null) return undefined;
      return { type: 'moveToEnd', itemId, end, repoId };
    }
    case 'setPriority': {
      const priority = oneOf(value.priority, PRIORITIES);
      return itemId && priority ? { type: 'setPriority', itemId, priority } : undefined;
    }
    case 'cancel':
    case 'retry':
    case 'resolve':
    case 'remove':
      return itemId ? { type: value.type, itemId } : undefined;
    case 'reply': {
      const replyText = text(value.text);
      const options = parseOptions(value.options);
      return itemId && replyText && options
        ? { type: 'reply', itemId, text: replyText, options }
        : undefined;
    }
    case 'clearFinished': {
      const repoId = optionalRepo(value.repoId);
      return repoId === null ? undefined : { type: 'clearFinished', repoId };
    }
    case 'setPaused':
      return typeof value.paused === 'boolean'
        ? { type: 'setPaused', paused: value.paused }
        : undefined;
    case 'setRepoPaused': {
      const repoId = id(value.repoId);
      return repoId && typeof value.paused === 'boolean'
        ? { type: 'setRepoPaused', repoId, paused: value.paused }
        : undefined;
    }
    case 'removeRepo': {
      const repoId = id(value.repoId);
      return repoId ? { type: 'removeRepo', repoId } : undefined;
    }
    case 'resumeTool':
      return value.toolId === 'claude-code'
        ? { type: 'resumeTool', toolId: 'claude-code' }
        : undefined;
    case 'updateSettings':
      return isObject(value.settings)
        ? { type: 'updateSettings', settings: value.settings as Partial<Settings> }
        : undefined;
    default:
      return undefined;
  }
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Applies whichever fields of `input` are valid on top of `current`. */
export function mergeSettings(current: Settings, input: unknown): Settings {
  if (!isObject(input)) return current;
  const model =
    typeof input.defaultModel === 'string' && isValidModel(input.defaultModel.trim())
      ? input.defaultModel.trim()
      : current.defaultModel;
  const claudePath =
    typeof input.claudePath === 'string' && input.claudePath.length <= 1024
      ? input.claudePath.trim()
      : current.claudePath;
  return {
    maxConcurrent: clamp(input.maxConcurrent, 1, MAX_CONCURRENT, current.maxConcurrent),
    holdLowAbove: clamp(input.holdLowAbove, 0, 100, current.holdLowAbove),
    holdNormalAbove: clamp(input.holdNormalAbove, 0, 100, current.holdNormalAbove),
    pauseRepoOnFeedback: bool(input.pauseRepoOnFeedback, current.pauseRepoOnFeedback),
    questionsNeedFeedback: bool(input.questionsNeedFeedback, current.questionsNeedFeedback),
    notifications: bool(input.notifications, current.notifications),
    defaultPermissionMode:
      oneOf(input.defaultPermissionMode, PERMISSION_MODES) ?? current.defaultPermissionMode,
    defaultModel: model,
    claudePath,
  };
}
