#!/usr/bin/env bash
# Pre-edit hook: CLAUDE.md hygiene reminder + scoped lint.
#
# Triggered by .claude/settings.json on PreToolUse + Edit|Write + path matches **/CLAUDE.md.
# Always advisory (exit 0). Emits stderr warnings if scoped lint finds issues or if the
# edit target is a CLAUDE.md (regardless of lint outcome) to nudge Claude toward the
# add-claude-md skill rather than direct edits.

set -euo pipefail

# jq is required to parse the tool_input JSON; exit cleanly if absent so the
# hook stays silent in environments where jq is not installed (matches the
# pattern used by pre-commit-dod.sh).
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

# Only act on Edit/Write tool calls (coarse matcher in settings; re-filter here).
if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

# Only act on CLAUDE.md files.
case "$FILE_PATH" in
  *CLAUDE.md|*/CLAUDE.md) ;;
  *) exit 0 ;;
esac

# Resolve project dir: payload .cwd, else git toplevel, else $CLAUDE_PROJECT_DIR, else ".".
PROJECT_DIR="${CWD:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-.}")"
fi
cd "$PROJECT_DIR" 2>/dev/null || true

echo "Tip: review the add-claude-md skill before adding new rules to a CLAUDE.md." >&2

# Run the scoped lint if available. Treat failures as warnings, not blockers.
# The lint output IS the real value of this hook; the advisory line above is
# a single-line nudge so Claude does not need to remember the skill name.
LINT="$PROJECT_DIR/.claude/hooks/lib/claude-md-lint.sh"
if [[ -x "$LINT" ]]; then
  if ! "$LINT" "$FILE_PATH" >&2 2>&1; then
    echo "  claude-md-lint reported issues above; the governance DoD gate at commit will block on these." >&2
  fi
elif [[ -f "$LINT" ]]; then
  if ! bash "$LINT" "$FILE_PATH" >&2 2>&1; then
    echo "  claude-md-lint reported issues above; the governance DoD gate at commit will block on these." >&2
  fi
fi

exit 0
