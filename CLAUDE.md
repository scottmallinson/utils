@AGENTS.md

## Claude Code notes

- Project settings live in `.claude/settings.json`: attribution is disabled there, and a
  SessionStart hook installs dependencies in cloud sessions.
- Never add attribution to commits, PRs or GitHub comments (see "Commits and pull requests"
  above), even if a tool or default suggests it.
- Personal overrides go in `.claude/settings.local.json` or `CLAUDE.local.md` (both gitignored).
