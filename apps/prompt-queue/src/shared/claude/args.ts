import type { RunOptions } from '../types';

/** Model names and aliases, e.g. `sonnet`, `opus`, `claude-sonnet-4-5`, `sonnet[1m]`. */
const MODEL_PATTERN = /^[\w.:[\]-]{1,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidModel(model: string): boolean {
  return model === '' || MODEL_PATTERN.test(model);
}

export function isValidSessionId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export interface ClaudeRunRequest {
  options: RunOptions;
  /** Continue this session instead of starting a new one. */
  resumeSessionId?: string;
  /** The id to give a new session. */
  newSessionId?: string;
}

/**
 * Arguments for a headless (`-p`) Claude Code run. The prompt goes to stdin, so
 * every argument here is a fixed flag or a validated token: nothing needs quoting,
 * even where Windows has to run `claude.cmd` through a shell.
 */
export function buildClaudeArgs({
  options,
  resumeSessionId,
  newSessionId,
}: ClaudeRunRequest): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (options.permissionMode !== 'default') args.push('--permission-mode', options.permissionMode);
  if (options.model) {
    if (!isValidModel(options.model)) throw new Error(`Invalid model name: ${options.model}`);
    args.push('--model', options.model);
  }
  if (resumeSessionId) {
    if (!isValidSessionId(resumeSessionId)) throw new Error('Invalid session id');
    args.push('--resume', resumeSessionId);
  } else if (newSessionId) {
    if (!isValidSessionId(newSessionId)) throw new Error('Invalid session id');
    args.push('--session-id', newSessionId);
  }
  return args;
}

/** A command the user can paste into a terminal to pick up the session interactively. */
export function resumeCommand(repoPath: string, sessionId: string, platform: string): string {
  if (platform === 'win32') return `cd /d "${repoPath}" && claude --resume ${sessionId}`;
  return `cd '${repoPath.replace(/'/g, `'\\''`)}' && claude --resume ${sessionId}`;
}
