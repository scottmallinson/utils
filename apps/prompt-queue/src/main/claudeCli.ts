// Finds the user's own Claude Code install. Apps opened from the Finder or Start
// menu don't get the shell's PATH, so this also asks the login shell for it and
// checks the usual install locations.

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { CliCheck } from '../preload/api';

export interface ResolvedCli {
  path: string;
  env: NodeJS.ProcessEnv;
}

/** Install locations to check besides PATH. */
export function extraDirs(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv) {
  if (platform === 'win32') {
    return [join(home, '.local', 'bin'), env.APPDATA ? join(env.APPDATA, 'npm') : undefined].filter(
      (dir): dir is string => Boolean(dir),
    );
  }
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
  ];
}

export function executableNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
}

/** Joins PATH lists, dropping blanks and duplicates but keeping the first occurrence's order. */
export function mergePathLists(lists: (string | undefined)[], separator = delimiter): string {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const dir of list?.split(separator) ?? []) {
      if (dir.trim()) seen.add(dir);
    }
  }
  return [...seen].join(separator);
}

export async function findExecutable(
  dirs: string[],
  names: string[],
  isExecutable: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

let shellPath: Promise<string | undefined> | undefined;

/** The PATH a login shell would have (macOS and Linux), or undefined if it can't be read. */
function loginShellPath(): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined);
  shellPath ??= new Promise((resolve) => {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const marker = '__PROMPT_QUEUE_PATH__';
    execFile(
      shell,
      ['-ilc', `printf '%s%s%s' '${marker}' "$PATH" '${marker}'`],
      { timeout: 5000, encoding: 'utf8' },
      (_error, stdout) => {
        const match = new RegExp(`${marker}(.*)${marker}`).exec(stdout ?? '');
        resolve(match?.[1] || undefined);
      },
    );
  });
  return shellPath;
}

/**
 * Resolves the `claude` executable and the environment to run it with.
 * `configured` is the path from settings; empty means search.
 */
export async function resolveClaude(configured: string): Promise<ResolvedCli> {
  const home = homedir();
  const extra = extraDirs(process.platform, home, process.env);
  const PATH = mergePathLists([await loginShellPath(), process.env.PATH, extra.join(delimiter)]);
  // Windows env var names are case-insensitive; keep whichever spelling exists.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: PATH };

  const explicit = configured || process.env.PROMPT_QUEUE_CLAUDE_PATH || '';
  if (explicit) {
    if (await isExecutable(explicit)) return { path: explicit, env };
    throw new Error(`Couldn’t run Claude Code at ${explicit}. Check the path in Settings.`);
  }
  const found = await findExecutable(
    PATH.split(delimiter),
    executableNames(process.platform),
    isExecutable,
  );
  if (!found) {
    throw new Error(
      'Couldn’t find Claude Code. Install it (https://code.claude.com), or set its path in Settings.',
    );
  }
  return { path: found, env };
}

/** Runs `claude --version` to confirm the CLI works. */
export async function checkClaude(configured: string): Promise<CliCheck> {
  let cli: ResolvedCli;
  try {
    cli = await resolveClaude(configured);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return new Promise((resolve) => {
    const useShell = /\.(cmd|bat)$/i.test(cli.path);
    execFile(
      useShell ? `"${cli.path}"` : cli.path,
      ['--version'],
      { env: cli.env, timeout: 15_000, encoding: 'utf8', shell: useShell, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, path: cli.path, error: (stderr || error.message).trim() });
        } else {
          resolve({ ok: true, path: cli.path, version: stdout.trim().split('\n')[0] });
        }
      },
    );
  });
}
