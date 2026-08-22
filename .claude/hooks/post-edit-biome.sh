#!/usr/bin/env bash
# Post-edit hook: Biome auto-fix on the modified file.
#
# Triggered by .claude/settings.json on PostToolUse + Edit|Write. Filters in-script to the
# extensions biome owns here. Runs `biome check --write` scoped to the one file so the fix
# lands at authorship rather than at the commit gate. Advisory: exit 0 always, even when
# unfixable findings remain — the `biome-check` DoD gate blocks on those.
#
# bun, not pnpm: this repo declares `packageManager: bun` and bunfig.toml sets `[run] bun = true`
# so a bin carrying a `#!/usr/bin/env node` shebang still runs under bun. Reaching for pnpm here
# would spawn a package manager the repo does not install with.

set -euo pipefail

# jq parses the tool_input JSON. Absent jq the hook stays silent — it is advisory, so a
# skip costs a nudge, not a gate. (The BLOCKING hooks say so out loud instead.)
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.svelte) ;;
  *) exit 0 ;;
esac

# Gone from disk (a delete routed through Edit) — nothing to format.
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

PROJECT_DIR="${CWD:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
fi
cd "$PROJECT_DIR" || exit 0

if ! command -v bun >/dev/null 2>&1; then
  exit 0
fi
if [[ ! -f "package.json" ]]; then
  exit 0
fi

echo "=== BIOME POST-EDIT: $FILE_PATH ===" >&2

if bun x biome check --write "$FILE_PATH" >&2 2>&1; then
  echo "  Biome auto-fix clean." >&2
else
  echo "" >&2
  echo "  Biome auto-fixed what it could; unfixable findings remain above." >&2
  echo "  Advisory here — the biome-check DoD gate blocks on them at commit." >&2
fi

exit 0
