#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ "$(node --version 2>/dev/null || true)" != v24.* ]]; then
  if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then
    export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
  elif [[ -x /usr/local/opt/node@24/bin/node ]]; then
    export PATH="/usr/local/opt/node@24/bin:$PATH"
  else
    echo "Node.js 24 is required. Install it before running Ralph." >&2
    exit 1
  fi
fi

if [[ "$(node --version)" != v24.* ]]; then
  echo "Expected Node.js 24, found $(node --version)." >&2
  exit 1
fi

if ! command -v ralph >/dev/null 2>&1; then
  echo "ralph was not found in PATH." >&2
  exit 1
fi

export RALPH_VERIFY_MODEL="${RALPH_VERIFY_MODEL:-gpt-5.6-luna}"
export RALPH_VERIFY_EFFORT="${RALPH_VERIFY_EFFORT:-xhigh}"

if [[ "${1:-}" == "--check-env" ]]; then
  git rev-parse --is-inside-work-tree >/dev/null
  test -f docs/features/x-cleaner-v1/project-phases.md
  test "$(grep -cE '^## Phase [0-9]+: ' docs/features/x-cleaner-v1/project-phases.md)" -gt 0

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "The Git worktree is not clean." >&2
    git status --short >&2
    exit 1
  fi

  command -v codex >/dev/null
  codex login status >/dev/null

  echo "Environment ready: Node $(node --version), Ralph $(command -v ralph)."
  echo "Implementation model: gpt-5.6-luna (effort: xhigh)"
  echo "Verification model: $RALPH_VERIFY_MODEL (effort: $RALPH_VERIFY_EFFORT)"
  echo "Gate 2: npm run check"
  echo "Plan: docs/features/x-cleaner-v1/project-phases.md"
  exit 0
fi

exec ralph \
  docs/features/x-cleaner-v1/project-phases.md \
  --engine codex \
  --model gpt-5.6-luna \
  --effort xhigh \
  --test-cmd "npm run check" \
  --dashboard \
  "$@"
