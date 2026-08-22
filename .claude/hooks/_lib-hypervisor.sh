#!/usr/bin/env bash
# _lib-hypervisor.sh — shared helpers for the Hypervisor compaction hooks
# (pre-compact-hypervisor-checkpoint.sh, session-start-hypervisor-reanchor.sh).
# Design: .claude/hooks/README.md (Hypervisor compaction) + .claude/plan-coordination/README.md (wiring + file ownership).
#
# SOURCED, never executed — the leading "_" marks a library, per
# .claude/hooks/README.md ("Files prefixed with _ are libraries").
#
# IDENTITY IS ASSERTED POSITIVELY BY OWNER-SESSION-ID, NOT BY AN INHERITABLE VAR.
# A dispatched child inherits its parent's environment, so gating on an exported
# `HYPERVISOR_PLAN_DIR` would mis-identify every child as the Hypervisor. The markers are
# instead session-private files under a PER-SESSION subdir `<cwd>/.hypervisor/<session_id>/`
# (so MULTIPLE Hypervisors in the SAME cwd never clobber each other): `role` holds
# "hypervisor <owning-session-id>" and a hook acts ONLY when its own stdin session_id both
# (a) names the subdir it reads and (b) matches that owner (see __hypervisor_is_hv). The
# per-session subdir is the primary isolation; the owner-match is defense-in-depth (a
# crashed session's stale subdir carries a dead id no live session reads or matches). A
# child runs with its OWN session dir (the Child-spawn contract sets CLAUDE_PROJECT_DIR to
# the child + strips HYPERVISOR_PLAN_DIR), so it never sees the parent's marker — and even
# if it did, its session_id differs in both the path and the owner.
#
# Every helper is a READ-ONLY probe with a no-op default; the hooks act ONLY when
# the marker is present and NEVER fail a compaction because tooling is absent.

# __hypervisor_dir [cwd] -> the base dir whose .hypervisor/ we consult — matches where the
# statusline and INITIALIZE write: $CLAUDE_PROJECT_DIR, else the passed cwd, else $PWD.
__hypervisor_dir() {
  printf '%s' "${CLAUDE_PROJECT_DIR:-${1:-$PWD}}"
}

# __hypervisor_session_dir <session_id> [cwd] -> the PER-SESSION marker dir
# `<cwd>/.hypervisor/<session_id>/`, the session-private home of role/plan-dir/self-ctx/
# session-id. Scoping by session_id is what lets MULTIPLE Hypervisors share ONE cwd without
# clobbering each other. Degraded fallback: an EMPTY session_id (older CLI that does not emit
# one) collapses to the flat `<cwd>/.hypervisor/` — single-session behaviour, no isolation.
__hypervisor_session_dir() {
  local sid="${1:-}" base
  base="$(__hypervisor_dir "${2:-}")/.hypervisor"
  if [[ -n "$sid" ]]; then printf '%s/%s' "$base" "$sid"; else printf '%s' "$base"; fi
}

# __hypervisor_is_hv <session_id> [cwd] -> exit 0 iff THIS session is the Hypervisor.
# Reads no inheritable env var for the identity decision. The marker is
# `<cwd>/.hypervisor/<session_id>/role` containing "hypervisor <owning-session-id>"
# (INITIALIZE stamps the owner = its own $CLAUDE_CODE_SESSION_ID). TWO layers: the
# PER-SESSION subdir means a hook only ever reads its OWN session's role, and the
# OWNER-MATCH then requires the recorded owner to equal the hook's stdin session_id. A
# crashed (un-HALTed) Hypervisor leaves a subdir named by its DEAD session id that no live
# session reads (different id -> different path) AND whose owner no live session matches, so
# it is doubly inert — a later session in the same checkout is NEVER mis-identified, no
# liveness epoch needed. (The live-helper leak — a child that inherits CLAUDE_PROJECT_DIR —
# is closed separately by the Child-spawn contract that gives every child its OWN dir.)
# Degraded fallback: an EMPTY session_id collapses to the flat dir and an EMPTY owner falls
# back to existence-gating — functional but identity-weak and NOT multi-session-safe; the
# Bootstrap Gate asserts the statusline emits session-id so the subdir+owner are normally set.
__hypervisor_is_hv() {
  local sid="${1:-}" f line tok owner
  f="$(__hypervisor_session_dir "$sid" "${2:-}")/role"
  [[ -r "$f" ]] || return 1
  line="$(head -n1 "$f" 2>/dev/null)"
  tok="${line%% *}"
  [[ "$tok" == "hypervisor" ]] || return 1
  owner="${line#* }"; owner="${owner%% *}"       # second token = owning session id
  [[ "$owner" == "hypervisor" ]] && owner=""     # no second token -> empty owner
  [[ -z "$owner" || "$owner" == "$sid" ]]        # OWNER-MATCH (empty -> degraded existence-gate)
}

# __hypervisor_plan_dir <session_id> [cwd] -> echo the plan-dir the Hypervisor recorded at
# INITIALIZE, or nothing. FILE only (`<cwd>/.hypervisor/<session_id>/plan-dir`); never the
# inheritable env var. Always returns 0.
__hypervisor_plan_dir() {
  local f; f="$(__hypervisor_session_dir "${1:-}" "${2:-}")/plan-dir"
  if [[ -r "$f" ]]; then
    head -n1 "$f" 2>/dev/null | tr -d '[:space:]' || true
  fi
  return 0
}

# __hypervisor_proj [cwd] -> a checkout dir containing db.ts (run it there so its git-based
# plan-key resolution matches the Hypervisor's). Always returns 0.
__hypervisor_proj() {
  local c
  for c in "${CLAUDE_PROJECT_DIR:-}" "${1:-}" "$PWD"; do
    if [[ -n "$c" && -r "$c/.claude/plan-coordination/db.ts" ]]; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 0
}

# __hypervisor_db <proj> <plan> <cmd> [args...] -> run `bun db.ts <cmd> <plan> [args...]`
# from <proj>, under a wall-clock timeout so a hung store / stuck LMDB lock / slow
# bun cold-start degrades to "skip" rather than BLOCKING the compaction boundary
# (a PreCompact hook runs before the window collapses). Returns 127 if bun/db.ts is
# unavailable; callers treat any non-zero as "skip", never a compaction failure.
__hypervisor_db() {
  local proj="$1" plan="$2" cmd="$3"
  shift 3
  command -v bun >/dev/null 2>&1 || return 127
  local dbts="$proj/.claude/plan-coordination/db.ts"
  [[ -r "$dbts" ]] || return 127
  local to
  to="$(command -v timeout || command -v gtimeout || true)"
  if [[ -n "$to" ]]; then
    ( cd "$proj" 2>/dev/null && "$to" 10 bun "$dbts" "$cmd" "$plan" "$@" )
  else
    ( cd "$proj" 2>/dev/null && bun "$dbts" "$cmd" "$plan" "$@" )
  fi
}
