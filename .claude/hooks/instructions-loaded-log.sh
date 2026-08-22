#!/usr/bin/env bash
# InstructionsLoaded hook: log which CLAUDE.md files were auto-loaded.
#
# Fires AFTER Claude Code auto-loads the layered CLAUDE.md system at session
# start / on directory entry. Per https://code.claude.com/docs/en/hooks this
# is the recommended observability hook for the memory system; the input JSON
# carries the list of loaded files so we can answer "why didn't this rule
# fire?" by replaying the loaded set after the fact.
#
# Output: one CSV-ish line per invocation appended to a per-project log file
# at $XDG_STATE_HOME/claude/instructions-loaded/<project-slug>.log (default:
# ~/.local/state/claude/instructions-loaded/<project-slug>.log).
#
# Why per-project: the previous `/tmp/claude-instructions-loaded.log` path
# interleaved every project on the machine into one file, making per-session
# replay useless. Namespacing by basename of cwd separates streams.
#
# Pure observability: exits 0 always. Never blocks. Silent on jq absence.

set -euo pipefail

LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude/instructions-loaded"
PROJECT_SLUG=$(basename "$(pwd)" 2>/dev/null || echo "unknown")
LOG_FILE="$LOG_DIR/${PROJECT_SLUG}.log"
mkdir -p "$LOG_DIR" 2>/dev/null || true

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)

# Extract the loaded-instructions list. The exact JSON shape per the Claude
# Code hooks docs uses `instructions` (an array of objects each with `path`).
# Fall back to a few alternate shapes defensively so a schema rename does
# not silently break the log: we try `.instructions[].path`,
# `.tool_input.instructions[].path`, then `.files[].path`. Whichever yields a
# non-empty result is used.
FILES=""
for selector in '.instructions // [] | map(.path // empty) | join(",")' \
                '.tool_input.instructions // [] | map(.path // empty) | join(",")' \
                '.files // [] | map(.path // empty) | join(",")' \
                '.hookSpecificOutput.files // [] | map(.path // empty) | join(",")'; do
  CANDIDATE=$(printf '%s' "$INPUT" | jq -r "$selector" 2>/dev/null || true)
  if [[ -n "$CANDIDATE" && "$CANDIDATE" != "null" ]]; then
    FILES="$CANDIDATE"
    break
  fi
done

# Even if the schema yielded nothing, still log the invocation with a
# placeholder so the log shows the hook fired (helps detect "hook never ran
# even though session started").
#
# This repo currently holds ZERO CLAUDE.md files, so the empty case here is the NORMAL
# state, not evidence of a schema break — and the two are indistinguishable from inside
# this hook. Name both readings rather than asserting the alarming one.
if [[ -z "$FILES" ]]; then
  FILES="(no file list in input: either no CLAUDE.md was loaded, or the hook input schema changed)"
fi

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Append atomically enough for our scale. POSIX guarantees that write(2)
# calls to a file opened with O_APPEND of <= PIPE_BUF bytes (4096 on
# Linux/macOS) are atomic with respect to other O_APPEND writers. One
# loaded-instruction line is timestamp (20B) + tab + a CSV of CLAUDE.md
# paths -- well under 4KB even with the full layered set loaded. A
# tmp+mv swap would give true atomicity for arbitrary sizes but is
# overkill here: log lines do not exceed PIPE_BUF in practice.
printf '%s\t%s\n' "$TS" "$FILES" >> "$LOG_FILE" 2>/dev/null || true

exit 0
