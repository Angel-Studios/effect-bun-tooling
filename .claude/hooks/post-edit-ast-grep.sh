#!/usr/bin/env bash
# Post-edit hook: scoped ast-grep scan of the file just written.
#
# Triggered by .claude/settings.json on PostToolUse + Edit|Write. Filters in-script to the
# extensions the rule corpus targets. Advisory: exit 0 always.
#
# Why this exists. `lint-ast` is a BLOCKING DoD gate, and in this repo the commit hook plus
# `bun run dod` are the only surfaces that run it — nothing tells the author they added a
# violation until the moment they try to commit. Surfacing the finding at authorship is the
# cheapest place to catch it: the author still holds the context, and the fix is usually a
# one-line swap to a helper the repo already has.
#
# It does NOT block. `lint-ast` counts whole-repo violations; a per-file blocking gate here
# would fire on pre-existing debt in any file an author happens to touch, which would punish
# them for inherited debt. Advisory is the correct mode.

set -euo pipefail

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

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

PROJECT_DIR="${CWD:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
fi
cd "$PROJECT_DIR" || exit 0

# sgconfig.yml lives at the repo root and every ruleDir in it is resolved relative to that
# file, so the scan must run from there. A nested cwd would find no config and scan with
# ZERO rules — a silent no-op indistinguishable from a clean file.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT_DIR")"
if [[ ! -f "$REPO_ROOT/sgconfig.yml" ]]; then
  exit 0
fi
cd "$REPO_ROOT" || exit 0

if ! bun x ast-grep --version >/dev/null 2>&1; then
  exit 0
fi

TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

SCAN_OUT=""
if [[ -n "$TIMEOUT_BIN" ]]; then
  SCAN_OUT=$("$TIMEOUT_BIN" 20 bun x ast-grep scan --report-style short "$FILE_PATH" 2>/dev/null || true)
else
  SCAN_OUT=$(bun x ast-grep scan --report-style short "$FILE_PATH" 2>/dev/null || true)
fi

if [[ -z "$SCAN_OUT" ]]; then
  exit 0
fi

# `--report-style short` emits one `path:line:col: severity[rule-id] message` line per finding.
# Cap the surfaced set: the point is to show what was just added, not to paginate the backlog.
FINDING_COUNT=$(printf '%s\n' "$SCAN_OUT" | grep -c . || true)
echo "=== ast-grep: $FINDING_COUNT finding(s) in $FILE_PATH ===" >&2
printf '%s\n' "$SCAN_OUT" | head -10 | sed 's/^/  /' >&2
if [[ "$FINDING_COUNT" -gt 10 ]]; then
  echo "  ... $((FINDING_COUNT - 10)) more (run: bun x ast-grep scan '$FILE_PATH')" >&2
fi
echo "" >&2
echo "  Advisory. The lint-ast DoD gate BLOCKS at commit on any error-severity finding." >&2
echo "  Check the whole-repo position:  bun run lint:ast" >&2
echo "" >&2

exit 0
