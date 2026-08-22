#!/usr/bin/env bash
# Shared helper: quote-aware shell tokenizer for .claude/hooks/*.sh.
#
# Sourced (NOT executed) by hooks that need to walk a command's argv
# respecting shell quoting. Centralizes the tokenizer so a `git "commit"`
# or `git 'commit'` (escaped-quote permission-prompt evasion) is handled
# identically across the beast gates and pre-git-destructive.
#
# Reads a shell command line on stdin and writes one token per line on
# stdout. Respects single quotes (literal) and double quotes (interpreted
# for backslash-escape only; variables and command substitutions are NOT
# expanded -- that is the caller's job to keep the input shape sane).
# Backslash outside quotes escapes the next char.
#
# Why pure bash plus awk (no Python): keeps the dependency surface aligned
# with the rest of the hooks (jq plus awk only). The tokenizer below
# handles the shapes git and beast commands accept in practice. Edge cases
# (backslash newlines, unmatched quotes) intentionally err on the safe side
# (treat as part of the current token, surface no false-negative).

__claude_hook_tokenize() {
  awk '
    BEGIN {
      tok = "";
      in_single = 0;
      in_double = 0;
      have = 0;
    }
    {
      line = $0;
      n = length(line);
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1);
        if (in_single) {
          if (c == "\x27") { in_single = 0; }
          else { tok = tok c; have = 1; }
        } else if (in_double) {
          if (c == "\\" && i < n) {
            nc = substr(line, i + 1, 1);
            if (nc == "\"" || nc == "\\" || nc == "$" || nc == "`" || nc == "\n") {
              tok = tok nc; have = 1; i++;
            } else {
              tok = tok c; have = 1;
            }
          } else if (c == "\"") {
            in_double = 0;
          } else {
            tok = tok c; have = 1;
          }
        } else {
          if (c == "\x27") { in_single = 1; have = 1; }
          else if (c == "\"") { in_double = 1; have = 1; }
          else if (c == "\\" && i < n) {
            tok = tok substr(line, i + 1, 1); have = 1; i++;
          } else if (c == " " || c == "\t") {
            if (have) { print tok; tok = ""; have = 0; }
          } else {
            tok = tok c; have = 1;
          }
        }
      }
      # End of input line: treat newline as a token separator when not
      # inside a quoted region. Inside a quoted region the newline is
      # part of the value.
      if (in_single || in_double) {
        tok = tok "\n";
      } else if (have) {
        print tok; tok = ""; have = 0;
      }
    }
    END { if (have) print tok; }
  '
}

# Helper: split a shell command line into its top-level command segments,
# one per line on stdout, breaking on UNQUOTED `&&`, `||`, `;`, `|`, `&`,
# and grouping punctuation. Quote state is tracked with the same rules as
# __claude_hook_tokenize, so an operator inside a quoted string is content,
# not a separator.
#
# Callers that classify a command by its leading tokens MUST run per segment.
# Anchoring on the first token of the whole line reads `cd x && git push
# --force` as a `cd`, and a gate written that way silently stops blocking the
# most common shape an agent emits. Erring toward MORE segments is fail-closed:
# an extra segment can only add checks, never skip one.
#
# Usage:
#   while IFS= read -r seg; do ...; done < <(printf '%s\n' "$CMD" | __claude_hook_split_commands)
__claude_hook_split_commands() {
  awk '
    BEGIN { seg = ""; in_single = 0; in_double = 0; }
    {
      line = $0;
      n = length(line);
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1);
        if (in_single) {
          seg = seg c;
          if (c == "\x27") { in_single = 0; }
        } else if (in_double) {
          if (c == "\\" && i < n) {
            seg = seg c substr(line, i + 1, 1); i++;
          } else {
            seg = seg c;
            if (c == "\"") { in_double = 0; }
          }
        } else {
          if (c == "\x27") { in_single = 1; seg = seg c; }
          else if (c == "\"") { in_double = 1; seg = seg c; }
          else if (c == "\\" && i < n) { seg = seg c substr(line, i + 1, 1); i++; }
          else if (c == "&" || c == "|") {
            print seg; seg = "";
            if (i < n && substr(line, i + 1, 1) == c) { i++; }
          }
          else if (c == ";" || c == "(" || c == ")" || c == "{" || c == "}") {
            print seg; seg = "";
          }
          else { seg = seg c; }
        }
      }
      print seg; seg = "";
    }
  '
}

# Helper: drop leading env-var assignments (FOO=bar BAZ=qux) from a token
# array. Sets the caller-visible variable `START_IDX` to the index of the
# first non-assignment token.
#
# Usage:
#   TOKENS=( ... )
#   __claude_hook_strip_env_vars TOKENS
#   echo "${TOKENS[$START_IDX]}"
__claude_hook_strip_env_vars() {
  # $1 is the name of the token-array variable (caller passes by name).
  # bash 3.2 compatible: copy array contents into a local via indirect
  # `eval`, since `local -n` nameref requires bash 4.3+ and macOS still
  # ships bash 3.2. Linux bash 4+/5+ runs this identically. Read-only
  # access — no write-back needed.
  local __toks_name="$1"
  eval "local __toks=( \"\${${__toks_name}[@]}\" )"
  START_IDX=0
  while [[ $START_IDX -lt ${#__toks[@]} ]] \
    && [[ "${__toks[$START_IDX]}" =~ ^[A-Z_][A-Z0-9_]*= ]]; do
    START_IDX=$((START_IDX + 1))
  done
}
