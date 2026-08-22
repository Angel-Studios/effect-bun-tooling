#!/usr/bin/env bash
# Pre-Bash hook: block destructive git operations.
#
# Root CLAUDE.md lists force-pushing a branch that other PRs are stacked on
# as a one-way door but the rule is advisory. This hook makes it enforceable.
#
# Blocks (exit 2):
#   - `git push --force` WITHOUT `--force-with-lease`. The lease variant is
#     allowed on personal branches; the bare --force is too broad.
#   - `git commit --no-verify`. Banned without explicit human approval; root
#     CLAUDE.md lists it as a one-way door.
#
# Banned by policy but NOT blocked here (say so rather than let a reader infer
# coverage from this list):
#   - `git push --no-verify`. Root CLAUDE.md bans --no-verify on push too, but
#     that half is a SOCIAL rule with no mechanism: this hook does not inspect
#     `git push` for it, and no quality gate is wired to pre-push anyway (the
#     only pre-push hook is a git-lfs shim). Do not add a pre-push gate here on
#     the strength of this comment; that is an operator decision, unmade.
#
# Advises (exit 0 with stderr WARNING):
#   - `git reset --hard`. Destructive but sometimes intentional; warn only.
#
# Triggered by .claude/settings.json on PreToolUse + Bash.

set -euo pipefail

# Shared tokenizer (handles single, double, and escaped quotes).
__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib-tokenize.sh
source "$__HOOK_DIR/_lib-tokenize.sh"

# jq is required to parse the tool_input JSON.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Fast short-circuit: if the command does not contain `git`, no checks apply.
if [[ -z "$COMMAND" ]] || ! echo "$COMMAND" | grep -q '\bgit\b'; then
  exit 0
fi

# --- 1. git commit --no-verify  -> BLOCK ---
#
# Token-level scan rather than substring search. Strategy:
#   1. Detect a `git commit` invocation (first two non-env tokens).
#   2. Walk the remaining tokens, respecting shell quoting (single and
#      double quotes, and \-escapes). Heredoc bodies expanded via
#      `$(cat <<...)` arrive as a single shell word, already inside the
#      quote-aware tokenizer's contiguous run.
#   3. For each TOKEN equal to `--no-verify` (anywhere on the line) BLOCK,
#      UNLESS the token is the value of a preceding `-m`/`-F`/`--message`/
#      `--file` flag (the message body). Also tolerate `--message=...`
#      and `--file=...` joined forms (single token, never matches
#      `--no-verify` by equality).
#
# Why token equality rather than substring: a commit body that mentions
# `--no-verify` (e.g., "see --no-verify docs") must NOT trip the gate.
# The previous regex stripped EVERYTHING after `-m` and lost a trailing
# `--no-verify` flag, defeating the gate; this rewrite scans tokens.
#
# Tokenizer factored into _lib-tokenize.sh (shared with beast-* gates).
# Parse the command into tokens, then drop leading env-var assignments
# (FOO=bar BAZ=qux git commit ...).
# Each top-level command segment is classified independently: `cd x && git
# push --force` is a `git push`, not a `cd`. See __claude_hook_split_commands.
while IFS= read -r __seg; do
TOKENS=()
while IFS= read -r __tok; do
  TOKENS+=("$__tok")
done < <(printf '%s\n' "$__seg" | __claude_hook_tokenize)
[[ ${#TOKENS[@]} -gt 0 ]] || continue
__claude_hook_strip_env_vars TOKENS

# Detect `git commit`.
if [[ $((START_IDX + 1)) -lt ${#TOKENS[@]} ]] \
  && [[ "${TOKENS[$START_IDX]}" == "git" ]] \
  && [[ "${TOKENS[$((START_IDX + 1))]}" == "commit" ]]; then

  # Walk argv after `git commit`, looking for --no-verify as a real
  # flag (not the value of a -m/-F/--message/--file arg).
  #
  # Combined short flags (`-am`, `-Fm`, `-cm`, `-vam`, etc.) are recognized
  # below: any cluster of short flags whose LAST character is m / F / c / C
  # is a message-consumer (consumes the next positional argument as the
  # message body / file path / commit-to-reuse). `git commit -mac msg` is
  # technically valid but rare; the last-char heuristic covers the common
  # shapes (`git commit -am`, `git commit -aFm`, `git commit -vam`).
  i=$((START_IDX + 2))
  while [[ $i -lt ${#TOKENS[@]} ]]; do
    arg="${TOKENS[$i]}"
    case "$arg" in
      -m|-F|--message|--file|-c|-C)
        # Skip the NEXT token: it is the message body / file path / commit-
        # to-reuse. If there is no next token, the command is malformed;
        # nothing more to scan.
        i=$((i + 2))
        continue
        ;;
      --message=*|--file=*|--reuse-message=*|--reedit-message=*)
        # Joined form: the value is bundled into this single token, so
        # nothing extra to skip.
        i=$((i + 1))
        continue
        ;;
      --no-verify)
        echo "=== BLOCKED: git commit with hook-bypass flag ===" >&2
        echo "" >&2
        echo "  The --no-verify flag bypasses pre-commit hooks. Banned without explicit human approval." >&2
        echo "  See root CLAUDE.md one-way doors." >&2
        exit 2
        ;;
    esac
    # Combined short flag detection: matches `-XYZm`, `-XYZF`, `-XYZc`, or
    # `-XYZC` where XYZ is zero or more letters. The trailing message-
    # consuming letter signals that the NEXT positional token is the
    # message body. Pure single-letter cases (`-m`, `-F`, `-c`, `-C`) are
    # already handled above; this branch covers `-am` and friends only.
    if [[ "$arg" =~ ^-[a-zA-Z]+[mFcC]$ ]] && [[ "$arg" != -[mFcC] ]]; then
      i=$((i + 2))
      continue
    fi
    i=$((i + 1))
  done
fi

# --- 2. force push without --force-with-lease  -> BLOCK ---
#
# TOKEN-LEVEL, for the same reason section 1 is: the previous implementation
# grepped the raw command string, so ANY command that merely MENTIONED the
# phrase was blocked — documentation, a grep pattern, a commit message
# explaining the rule, `echo` in a runbook. That is not a theoretical concern:
# it fired on a `sed` invocation whose PATTERN contained the phrase while this
# very hook was being audited, blocking work that could not possibly push
# anything. A gate that cries wolf on prose is how a team learns to bypass it.
#
# Now: require `git` `push` as the first two non-env tokens, then look for an
# exact `-f` / `--force` TOKEN, tolerating the joined `--force-with-lease=...`
# form. Quoted mentions collapse into a single token that matches neither.
if [[ $((START_IDX + 1)) -lt ${#TOKENS[@]} ]] \
  && [[ "${TOKENS[$START_IDX]}" == "git" ]] \
  && [[ "${TOKENS[$((START_IDX + 1))]}" == "push" ]]; then

  __force_token=0
  __lease_token=0
  i=$((START_IDX + 2))
  while [[ $i -lt ${#TOKENS[@]} ]]; do
    case "${TOKENS[$i]}" in
      --force-with-lease|--force-with-lease=*) __lease_token=1 ;;
      --force|-f) __force_token=1 ;;
    esac
    i=$((i + 1))
  done

  if [[ $__force_token -eq 1 ]] && [[ $__lease_token -eq 0 ]]; then
    echo "=== BLOCKED: force push without --force-with-lease ===" >&2
    echo "" >&2
    echo "  Use --force-with-lease (only on personal branches; never main)." >&2
    echo "  See root CLAUDE.md one-way doors." >&2
    exit 2
  fi
fi

# --- 3. git reset --hard  -> WARN (advisory) ---
#
# Sometimes legitimate (post-merge cleanup); warn but allow. The user's
# memory entry `feedback_no_rm_rf` covers `rm -rf`; `reset --hard` is
# different but in the same destructive class.
#
# Token-aware detection: the first non-flag token after `git` must be
# `reset`, AND a `--hard` token must appear elsewhere in the argv. The
# previous raw-grep version false-positived on commit messages whose body
# documented the `git reset --hard` command (e.g., a runbook commit).
if [[ $((START_IDX + 1)) -lt ${#TOKENS[@]} ]] \
  && [[ "${TOKENS[$START_IDX]}" == "git" ]] \
  && [[ "${TOKENS[$((START_IDX + 1))]}" == "reset" ]]; then
  __HAS_HARD=0
  for ((__j = START_IDX + 2; __j < ${#TOKENS[@]}; __j++)); do
    if [[ "${TOKENS[$__j]}" == "--hard" ]]; then
      __HAS_HARD=1
      break
    fi
  done
  if [[ $__HAS_HARD -eq 1 ]]; then
    echo "=== WARNING: git reset --hard is destructive ===" >&2
    echo "" >&2
    echo "  Ensure the user authorized this. Lost commits cannot be recovered" >&2
    echo "  without the reflog." >&2
    # Advisory only; do not block.
  fi
fi

done < <(printf '%s\n' "$COMMAND" | __claude_hook_split_commands)

exit 0
