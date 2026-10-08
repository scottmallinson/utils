# Agent guide

This repository is **selfware**: small utilities Scott builds for his own use and shares publicly
in case they help others. Each utility is a self-contained app under `apps/`. Optimise for
utilities that are simple, dependable, and easy to pick back up months later.

## Layout

```
apps/<name>/        One directory per utility (pnpm workspace package)
  AGENTS.md         Utility-specific notes for agents: architecture, commands, gotchas
  README.md         User-facing docs: what it does, how to install and use it
packages/<name>/    Code shared by several utilities, e.g. desktop-updater (auto-updates)
.github/workflows/  CI (lint, typecheck, unit tests, e2e) and per-app release workflows
.claude/            Claude Code settings, hooks and skills
```

Current utilities:

| App | What it is |
| --- | --- |
| [`apps/pdf-maker`](apps/pdf-maker) | Desktop app (macOS, Windows): drop in PDFs and images, arrange pages, save one PDF |
| [`apps/prompt-queue`](apps/prompt-queue) | Desktop app (macOS, Windows): queue prompts for Claude Code across repos, run them as usage limits allow |

## Commands

Use **pnpm** (version pinned in `package.json`) and Node 22+. Run from the repo root:

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspace dependencies |
| `pnpm check` | Lint + typecheck + unit tests for everything. **Run before every commit.** |
| `pnpm lint` / `pnpm format` | Biome lint + format check / auto-fix |
| `pnpm typecheck` | TypeScript in every app |
| `pnpm test` | Unit tests (Vitest) in every app |
| `pnpm --filter <app> <script>` | Run one app's script, e.g. `pnpm --filter pdf-maker test:e2e` |

Each app's `AGENTS.md` lists its own scripts (dev server, e2e, packaging).

## Conventions

- **TypeScript, strict.** No `any` unless unavoidable and commented.
- **Biome** formats and lints (2-space indent, single quotes, 100 columns). Don't hand-format;
  run `pnpm format`.
- **Keep logic pure and tested.** Put behaviour in plain modules with Vitest tests next to them
  (`foo.ts` + `foo.test.ts`); keep UI components and platform glue thin.
- **Verify in the real app.** For UI changes, run the app's e2e tests or drive it with Playwright
  and look at a screenshot; don't rely on unit tests alone.
- **Few dependencies.** Prefer the platform and small, well-maintained libraries.
- **Privacy by default.** Utilities work offline and never send user data anywhere.

## Commits and pull requests

- Use **[Conventional Commits](https://www.conventionalcommits.org/)**:
  `<type>(<scope>): <summary>`, e.g. `feat(pdf-maker): support WebP images`.
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
    `revert`. Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
  - Scope: the app directory name (`pdf-maker`), or `repo`, `ci`, `deps`, `claude` for
    repo-wide changes.
  - Summary in the imperative mood, lower case, no trailing full stop.
  - A husky `commit-msg` hook runs commitlint locally; CI checks commits and PR titles too.
- PRs are squash-merged, so the **PR title must also be a conventional commit**.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, "Generated with" lines,
  session links or tool footers in commits, PR descriptions, issues or comments.
- Keep PRs focused on one change. Fill in the PR template.

## Adding a new utility

1. Create `apps/<name>/` with a `package.json` (`"private": true`) that defines `typecheck` and
   `test` scripts, so the root commands pick it up.
2. Add `apps/<name>/README.md` (for users) and `apps/<name>/AGENTS.md` (for agents), plus a
   `CLAUDE.md` containing `@AGENTS.md`.
3. Add it to the table above and to the root `README.md`.
4. If it ships binaries, add a release workflow modelled on `.github/workflows/release-pdf-maker.yml`.
