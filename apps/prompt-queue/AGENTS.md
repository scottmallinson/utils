# Prompt Queue: agent notes

Electron desktop app (macOS, Windows) that queues prompts for AI coding agents across repos and
runs them through the agent's own CLI as usage limits allow. Only Claude Code is supported so
far. See `README.md` for the user-facing feature list, including the terms-of-service stance,
which is a hard requirement (see "Rules" below).

## Stack

- **Electron** + **electron-vite** + **electron-builder**, as in `apps/pdf-maker`.
- **React** renderer with no state library: the main process owns the state and pushes it.
- **@dnd-kit/sortable** for dragging queue items.
- **Vitest** unit tests, **Playwright** e2e tests against the built app with a fake `claude`.

## Architecture

```
src/shared/                Pure logic used by main and renderer (all unit tested)
  types.ts                 AppState, Repo, QueueItem, Turn, Settings, ToolLimits
  commands.ts              Commands from the UI, and parseCommand() to validate them
  queue.ts                 reduce(state, action, ctx): every state change goes through here
  ordering.ts              Queue order (priority, then rank) and drag/move placement
  scheduler.ts             planQueue(): what starts now, and why everything else waits
  limits.ts                Usage-limit windows: apply reports, expiry, pauses
  persist.ts               loadState(): defensive loading of the saved JSON
  claude/args.ts           `claude -p` arguments (prompt goes to stdin, never argv)
  claude/stream.ts         stream-json line parser -> ClaudeEvent
  claude/run.ts            RunTracker: events + exit -> completed/feedback/limited/error
  claude/limitText.ts      Fallback parsing of "You've hit your limit · resets 3pm"
src/main/
  index.ts                 Window, menu, IPC, notifications, power-save blocker, quit prompt
  engine.ts                Owns state, runs the scheduler, turns run output into actions
  runner.ts                Spawns claude, streams lines, kills the process tree on cancel
  claudeCli.ts             Finds claude (PATH, login shell PATH, install dirs), --version check
  store.ts                 Debounced, atomic JSON persistence in userData/state.json
src/preload/               contextBridge API exposed as window.api (types in api.ts)
src/renderer/src/
  App.tsx                  Subscribes to state, layout, menu commands, optimistic reorders
  components/              Sidebar, TopBar (limit meters), Composer, QueueView, ItemCard,
                           ItemDetail (turns, activity, reply), SettingsDialog
  lib/view.ts, format.ts   Pure display helpers (tested)
e2e/fake-claude.mjs        Stand-in CLI emitting real stream-json; behaviour set by prompt markers
```

Key ideas:

- **State flows one way.** The renderer sends `Command`s; main validates them (`parseCommand`),
  applies them with `reduce`, persists, and broadcasts the whole state (throttled to ~7/s). The
  renderer applies reorder commands optimistically with the same reducer so drags don't snap.
- **Statuses are stored; waiting reasons are derived.** Items are `queued`, `running`,
  `needs-feedback`, `completed`, `error` or `cancelled`. Why a queued item isn't running
  (paused, repo busy, repo waiting on feedback, limit, reserve threshold, capacity) comes from
  `planQueue`, which both the engine and the UI call.
- **Turns.** An item is a conversation: the first turn is the prompt, later turns are replies or
  automatic continuations after a limit. A first-turn run gets a new `--session-id`; later turns
  `--resume` it.
- **Limits.** Claude Code emits `rate_limit_event` messages (`status` allowed / allowed_warning /
  rejected, `rateLimitType` five_hour / seven_day / ..., `utilization` as a 0-1 fraction, only on
  warnings, and `resetsAt` in epoch seconds). A rejection pauses the tool until the reset plus a
  minute; with no reset time, for an hour. If the run had done work, the item is requeued with a
  "Continue" turn, otherwise the same turn reruns.
- **Feedback.** A successful result becomes `needs-feedback` if it has `permission_denials` or
  (setting) its last paragraph ends with a question.
- **One run per repo**, plus a global `maxConcurrent` (default 1, max 4).

## Rules

These keep the app within the AI tools' terms. Don't change them without Scott's say-so:

- Only ever drive the **user's installed CLI** as a subprocess. Never read, copy or use its
  credentials or OAuth tokens, and never call vendor APIs directly.
- **Never work around limits**: no account rotation, no hammering after a rejection, no
  concurrency beyond `MAX_CONCURRENT`.
- **Never auto-approve**: the default permission mode is `acceptEdits`, and denied permissions
  surface to the user as feedback.
- The app sends no prompts the user didn't write, except the fixed `CONTINUE_PROMPT` after a
  limit resets.

## Commands

Run from this directory, or from the root with `pnpm --filter prompt-queue <script>`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app with hot reload |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | Build, then drive the real app with Playwright and `e2e/fake-claude.mjs` |
| `pnpm typecheck` | Typecheck main/preload/shared, renderer and tests |
| `pnpm package` | Build installers for the current OS into `release/` |

On Linux without a display (cloud sessions, CI) wrap Electron commands in Xvfb:
`xvfb-run -a pnpm test:e2e`. If Electron says it "failed to install correctly", run
`node node_modules/electron/install.js` to download its binary.

To try the UI without spending usage, point the app at the fake CLI:
`PROMPT_QUEUE_CLAUDE_PATH=$PWD/e2e/fake-claude.mjs pnpm dev`, then use prompts containing
`[question]`, `[deny]`, `[limit]`, `[fail]` or `[slow]`.

## Gotchas

- GUI apps on macOS don't inherit the shell's PATH, so `claudeCli.ts` asks the login shell
  (`$SHELL -ilc`) once and merges that with known install dirs (`~/.local/bin`, Homebrew, npm).
- npm installs `claude.cmd` on Windows, which Node can only spawn through a shell. That's safe
  here because the prompt goes via stdin and every argument is a validated token.
- On macOS and Linux the CLI runs in its own process group (`detached`) so cancelling kills the
  commands it started too; Windows uses `taskkill /T`.
- `--output-format stream-json` needs `--verbose` with `-p`.
- Closing the window with prompts running asks first (Windows/Linux); on macOS the app keeps
  running in the background like other Mac apps. Playwright's `app.close()` will hang on that
  prompt, so e2e tests must let runs finish before closing.
- The engine's `schedule()` is re-entrant-safe: starting a run dispatches, which schedules again.
- `vite` is held at v7 and Electron at v43 for the same reasons as pdf-maker (see its AGENTS.md).
