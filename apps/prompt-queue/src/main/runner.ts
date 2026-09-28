// Runs Claude Code as a child process. The prompt goes in on stdin; events come
// back as stream-json lines on stdout.

import { type ChildProcess, spawn } from 'node:child_process';
import { LineSplitter } from '../shared/claude/stream';
import { resolveClaude } from './claudeCli';
import type { StartRun } from './engine';

const MAX_STDERR = 8_000;
const KILL_GRACE_MS = 5_000;

export const startClaudeRun: StartRun = (request, callbacks) => {
  let child: ChildProcess | undefined;
  let cancelled = false;
  let exited = false;
  let stderr = '';

  const finish = (exitCode: number | null, spawnError?: string) => {
    if (exited) return;
    exited = true;
    callbacks.onExit({ exitCode, stderr, spawnError, cancelled });
  };

  void resolveClaude(request.claudePath).then(
    (cli) => {
      if (cancelled) return finish(null);
      // npm installs are `claude.cmd` on Windows, which only runs through a shell.
      // Every argument is a fixed flag or validated token, so nothing needs quoting.
      const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli.path);
      child = spawn(useShell ? `"${cli.path}"` : cli.path, request.args, {
        cwd: request.cwd,
        env: cli.env,
        shell: useShell,
        windowsHide: true,
        // Its own process group, so cancelling also stops the commands it runs.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const lines = new LineSplitter();
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        for (const line of lines.push(chunk)) callbacks.onLine(line);
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-MAX_STDERR);
      });
      child.on('error', (error) => finish(null, error.message));
      child.on('close', (code) => {
        for (const line of lines.flush()) callbacks.onLine(line);
        finish(code);
      });

      child.stdin?.on('error', () => {
        // The process exited before reading the prompt; `close` reports why.
      });
      child.stdin?.end(request.prompt);
    },
    (error: unknown) => finish(null, error instanceof Error ? error.message : String(error)),
  );

  return {
    cancel() {
      if (cancelled || exited) return;
      cancelled = true;
      if (child) killTree(child);
    },
  };
};

function killTree(child: ChildProcess) {
  const { pid } = child;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      // Already gone.
    }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
  child.once('close', () => clearTimeout(timer));
}
