#!/usr/bin/env bash
# Pre-commit DoD hook.
#
# Two modes:
#   blocking (default):      run `bun run dod`. Exit 2 with a violation list if it fails.
#   --warn-if-uncommitted:   same gate, but never blocks. If uncommitted changes exist, emit a
#                            stderr reminder and still exit 0. Registered on Stop so the session
#                            is nudged without being killed.
#
# Triggered by .claude/settings.json:
#   PreToolUse + Bash (filtered in-script to a `git commit` first-token match) -> blocking
#   Stop                                                                       -> --warn-if-uncommitted
#
# Scope note: this detects `git commit` and `git "commit"` via a quote-aware tokenizer. It does
# NOT resolve user aliases such as `git ci`; that would mean reading .gitconfig, which is a much
# larger surface than this hook covers.
#
# UNLIKE THE ULTRAVISOR PLANE REPO, THIS HOOK IS NOT THE ONLY GATE SURFACE. .github/workflows/ci.yml
# triggers on pull_request and re-runs the same command set, so skipping this layer defers the gate
# rather than removing it. That is a real difference and it is why this hook does not need to
# reproduce the plane's five-step generated-hook arrangement.

set -euo pipefail

MODE="blocking"
if [[ "${1:-}" == "--warn-if-uncommitted" ]]; then
  MODE="warn"
fi

# jq parses the tool_input JSON. This is a BLOCKING gate, so say out loud that it is skipping
# rather than skipping silently: a blocking gate that silently no-ops looks exactly like a
# passing one.
if ! command -v jq >/dev/null 2>&1; then
  if [[ "$MODE" == "blocking" ]]; then
    echo "[advisory] jq missing -- pre-commit DoD gate skipped. Install with: brew install jq" >&2
  fi
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
PROJECT_DIR="${CWD:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
fi
cd "$PROJECT_DIR" || exit 0

# shellcheck source=.claude/hooks/_lib-tokenize.sh
if [[ -r "$PROJECT_DIR/.claude/hooks/_lib-tokenize.sh" ]]; then
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.claude/hooks/_lib-tokenize.sh"
else
  echo "[advisory] _lib-tokenize.sh missing -- pre-commit DoD gate cannot parse the command; refusing." >&2
  [[ "$MODE" == "warn" ]] && exit 0
  exit 2
fi

# Does any SEGMENT of the command line invoke `git commit`? Splitting on &&, ||, ;, | and
# subshell punctuation first is what makes `bun run build && git commit -m x` gate: a walk over
# the whole line's tokens would find `bun` in first position and return early. Splitting can
# only ADD segments to check, never skip one.
__dod_commits() {
  local seg
  while IFS= read -r seg; do
    [[ -n "${seg// /}" ]] || continue
    local TOKENS=()
    local tok
    while IFS= read -r tok; do
      TOKENS+=("$tok")
    done < <(printf '%s\n' "$seg" | __claude_hook_tokenize)
    [[ ${#TOKENS[@]} -gt 0 ]] || continue
    __claude_hook_strip_env_vars TOKENS
    if [[ $((START_IDX + 1)) -lt ${#TOKENS[@]} ]] \
      && [[ "${TOKENS[$START_IDX]}" == "git" ]] \
      && [[ "${TOKENS[$((START_IDX + 1))]}" == "commit" ]]; then
      return 0
    fi
  done < <(printf '%s\n' "$1" | __claude_hook_split_commands)
  return 1
}

if [[ "$MODE" == "blocking" ]]; then
  if [[ -z "$COMMAND" ]]; then
    exit 0
  fi
  if ! __dod_commits "$COMMAND"; then
    exit 0
  fi
fi

if [[ "$MODE" == "warn" ]]; then
  # Outside a work tree, `git diff` prints its usage banner and the guard below would drop
  # through into a full DoD run against the wrong cwd.
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
  fi
  # --porcelain is the single source of truth across staged, unstaged and untracked. A
  # `git diff` pair misses an untracked-only session.
  if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
    exit 0
  fi
  echo "=== DoD reminder (Stop event) ===" >&2
  echo "  You have uncommitted changes. Before declaring done, run:" >&2
  echo "    bun run dod" >&2
  echo "  (build, tsc, lint:effect, test:unit:once, lint:ast, lint:claude-md, check:ci)" >&2
  echo "" >&2
  echo "  NOT covered by that run, because it packs and installs real tarballs:" >&2
  echo "    bun run test:e2e     # proves a consumer installs what npm would receive" >&2
  echo "" >&2
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "  bun not found; cannot run the DoD gate." >&2
  exit 2
fi

# Wall-clock ceiling per check. This is a HANG-GUARD, not a perf budget: a wedged child must not
# deadlock the commit. `timeout` is GNU coreutils (Linux); `gtimeout` is its Homebrew name on
# macOS. With neither, fall back to a SECONDS-based soft timeout that reports "this took too
# long" but cannot SIGTERM the child.
TIMEOUT_DOD_SEC=1800
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
else
  echo "  [advisory] neither 'timeout' nor 'gtimeout' found; using bash SECONDS soft-timeout." >&2
  echo "  [advisory] On macOS: brew install coreutils  (gives gtimeout, hard SIGTERM on hang)." >&2
fi

FAILURES=()

run_check() {
  local NAME="$1"
  shift
  echo "  [$NAME] running: $*" >&2
  # Capture to a temp log rather than streaming. A clean run emits a large volume of
  # per-package output; streaming it to stderr floods the caller's context on every commit.
  # Only a bounded tail is surfaced, and only on failure.
  #
  # Bash gotcha: inside `if ! cmd; then RC=$?; fi` the value of $? is the INVERTED test result,
  # never the child's exit code. The `cmd || RC=$?` form below preserves the real rc.
  local RC=0
  local TSEC="${CHECK_TIMEOUT_SEC:-$TIMEOUT_DOD_SEC}"
  local __log
  __log=$(mktemp -t precommit-dod.XXXXXX)
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" "$TSEC" "$@" >"$__log" 2>&1 || RC=$?
    if [[ $RC -eq 124 ]]; then
      FAILURES+=("$NAME (timed out after ${TSEC}s)")
      echo "  [$NAME] TIMED OUT" >&2
      rm -f "$__log"
      return 0
    fi
  else
    local __t0=$SECONDS
    "$@" >"$__log" 2>&1 || RC=$?
    local __elapsed=$((SECONDS - __t0))
    if [[ $__elapsed -ge $TSEC ]]; then
      FAILURES+=("$NAME (took ${__elapsed}s, soft-timeout exceeded)")
      echo "  [$NAME] SOFT TIMEOUT (${__elapsed}s; install coreutils for a hard kill)" >&2
      rm -f "$__log"
      return 0
    fi
  fi
  if [[ $RC -ne 0 ]]; then
    FAILURES+=("$NAME")
    echo "  [$NAME] FAILED (exit $RC); last 40 lines:" >&2
    tail -n 40 "$__log" | sed 's/^/    /' >&2
  else
    echo "  [$NAME] OK" >&2
  fi
  rm -f "$__log"
}

echo "=== DoD GATE: running blocking checks ===" >&2

run_check "dod" bun run dod

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "" >&2
  echo "=== DoD GATE: FAILURES ===" >&2
  for f in "${FAILURES[@]}"; do
    echo "  - $f" >&2
  done
  echo "" >&2
  echo "  Fix the above before committing. Do not use --no-verify." >&2
  exit 2
fi

echo "" >&2
echo "=== DoD GATE: all checks passed ===" >&2
exit 0
