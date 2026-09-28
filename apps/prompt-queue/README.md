# Prompt Queue

A desktop app for macOS (12 Monterey or later) and Windows that queues prompts for AI coding
agents across your repos, and runs them as your usage limits allow. It works with
[Claude Code](https://code.claude.com) today; other agents are planned.

- **Queue prompts per repo or across all of them.** Pick a repo, write the prompt, and add it
  to the queue (⌘↵ / Ctrl+Enter). Prompts run one at a time in each repo, in the order you choose.
- **Prioritise and reorder.** Give prompts high, normal or low priority, drag them into order,
  move them up and down, or send one to the top. The queue always shows the order they'll run in.
- **Respect usage limits.** Prompt Queue shows Claude Code's 5-hour and weekly limits as they're
  reported. When a limit is hit, the prompt goes back to the front of the queue and everything
  waits until the limit resets, then carries on where it stopped. As a window fills up, low and
  then normal priority prompts are held back so there's room for the important ones (you choose
  the thresholds).
- **See where everything is.** Each prompt shows its status: queued, waiting for a limit, in
  progress (with what Claude is doing right now), waiting on feedback, completed, error or
  cancelled. Open one to see the full activity, Claude's reply, time taken and estimated cost.
- **Answer when Claude needs you.** A prompt waits on feedback when Claude ends with a question,
  or needed permission for something it wasn't allowed to do. Reply in the app to continue the
  same session, or copy a command to pick it up in your terminal. While a prompt waits, the rest
  of that repo's queue waits too (you can turn this off).
- **Pause** the whole queue, or one repo. Get a notification when a prompt needs you, fails, or
  the queue finishes. Your Mac or PC stays awake while prompts run.

A command-line interface is planned for a later release.

## Staying within the terms of service

Prompt Queue is built to use Claude Code the way Anthropic documents and allows, not to get
around anything:

- It runs **your own Claude Code install**, signed in as you, in its documented
  [non-interactive mode](https://code.claude.com/docs/en/headless) (`claude -p`), exactly as
  you could from a terminal or script. It never reads, copies or stores your login or API key,
  and never talks to Anthropic's servers itself.
- Every prompt is **one you wrote**. The only thing it adds on its own is "Continue from where you
  left off." when a prompt was cut short by a usage limit and the limit has reset.
- It **waits for limits to reset** rather than working around them: no extra accounts, no
  switching logins, no retry storms. By default one prompt runs at a time (up to four across
  different repos if you allow it).
- Anything Claude Code would normally ask permission for is **denied**, not approved, unless
  you've chosen otherwise. You pick the permission mode per prompt, and can change it at any
  point in the session.

You're still responsible for following the terms of your Claude plan (and of any other tool you
use), and your usage counts against your limits just as it would in the terminal.

## Install

1. Install [Claude Code](https://code.claude.com) and sign in by running `claude` once in a
   terminal.
2. Download the latest `prompt-queue` release for your platform from the
   [releases page](https://github.com/scottmallinson/utils/releases):
   - **macOS**: `prompt-queue-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for
     Intel.
   - **Windows**: the installer, `prompt-queue-<version>-win-x64.exe` (or `-win-arm64.exe` on Arm
     PCs), or `prompt-queue-<version>-win-portable.exe`, which runs without installing.

The app isn't code-signed yet, so the first launch needs a nudge:

- **macOS**: right-click the app, choose **Open**, then **Open** again. If macOS says the app is
  damaged, run `xattr -cr "/Applications/Prompt Queue.app"`.
- **Windows**: on the SmartScreen prompt, choose **More info** → **Run anyway**.

Prompt Queue finds `claude` on your PATH and in the usual install locations. If it can't, set
the path in **Settings**.

## Using it

1. **Add repository** and pick a project folder (a git repo, or any folder you'd run Claude
   Code in).
2. Write a prompt, choose its priority and permission mode, and **Add to queue**.
3. Leave it running. Check back on anything under **Needs you**.

### Permission modes

Prompts run unattended, so there's nobody to answer Claude Code's permission prompts. Anything
it would ask about is denied, and the prompt waits on your feedback, listing what it needed.

| Mode | What Claude can do |
| --- | --- |
| Default | Only what your Claude Code settings already allow |
| Accept edits (the default here) | Also edit files in the repo |
| Plan only | Read and plan, but change nothing |
| Auto | Let Claude Code's auto mode decide (if your plan has it) |
| Bypass (risky) | Anything, including running commands. Only for repos you're happy to let it loose in |

You can change the permission mode partway through a session. When you reply, choose the mode
for that reply, for example to allow edits after Claude was denied one. While a prompt is queued
or running, change it from the prompt's details; a turn that's already running keeps the mode it
started with, and the change applies from the next turn. Each turn shows the mode it ran with.

To allow specific commands (say, `npm test`) without bypassing everything, add them to the
repo's [Claude Code permission settings](https://code.claude.com/docs/en/settings).

### Usage limits

Claude Code reports your plan's limits as it runs, so the meters fill in after the first prompt
(if you use Claude Code with an API key instead of a Claude plan, there are no plan limits to
show). They
show how much of each window is used (once Claude Code starts warning about it) and when it
resets. In **Settings** you choose when to start holding back prompts: by default, low priority
waits once a window is 70% used, and normal priority at 90%. High priority prompts run until a
limit is actually reached.

If a limit is hit and you'd rather not wait, for example because you've upgraded your plan,
choose **Try now**.

## Notes and limits

- Prompt Queue keeps its queue in a file in your user data folder. Prompts, Claude's replies and
  its activity never leave your computer, except as Claude Code itself sends them to Anthropic.
- Quitting stops running prompts. Next time they're marked as interrupted: retry them, or
  reply to continue their sessions.
- Costs shown are Claude Code's own estimates at API prices, useful for comparing prompts. On a
  subscription you aren't billed them.
- Only Claude Code is supported so far. The design allows adding other agents' CLIs (GitHub
  Copilot CLI, Cursor, Gemini CLI and so on) later.

## Development

From the repo root, `pnpm install`, then in this directory:

```sh
pnpm dev          # run with hot reload
pnpm test         # unit tests
pnpm test:e2e     # build and drive the real app with Playwright (uses a fake claude)
pnpm package      # build installers for your OS into release/
```

Releases are built by GitHub Actions: bump `version` in `package.json`, merge, then push a
`prompt-queue-v<version>` tag. See [`AGENTS.md`](AGENTS.md) for the architecture.
