# utils

**Selfware**: small utilities I build for myself, shared in case they're useful to you too.

They're made to scratch my own itches, so expect opinions and rough edges. Issues and ideas are
welcome, but there's no roadmap or support promise.

## Utilities

| Utility | Platforms | What it does |
| --- | --- | --- |
| [PDF Maker](apps/pdf-maker) | macOS, Windows | Drop in PDFs and images, arrange and rotate pages, pick a page size, save one PDF |
| [Prompt Queue](apps/prompt-queue) | macOS, Windows | Queue prompts for Claude Code across your repos, prioritise them, and run them as your usage limits allow |

Downloads, when available, are on the [releases page](https://github.com/scottmallinson/utils/releases).

## Development

Requires Node 22+ and [pnpm](https://pnpm.io) (`corepack enable` sets up the pinned version).

```sh
pnpm install
pnpm check      # lint, typecheck and unit tests for every utility
```

Each utility lives in `apps/<name>` with its own README. Commits follow
[Conventional Commits](https://www.conventionalcommits.org/) (enforced by a git hook and CI).
[`AGENTS.md`](AGENTS.md) describes the conventions for humans and coding agents alike.

## License

[MIT](LICENSE)
