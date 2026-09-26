#!/usr/bin/env bash
# Installs dependencies in fresh Claude Code on the web sessions so lint,
# typecheck and tests work straight away. Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || npm install --global pnpm >/dev/null
fi

pnpm install --frozen-lockfile
