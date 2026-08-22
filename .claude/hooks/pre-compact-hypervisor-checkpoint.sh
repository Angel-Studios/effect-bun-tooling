#!/usr/bin/env bash
# PreCompact hook — Hypervisor compaction durability backstop (Seam 2).
# Design: .claude/hooks/README.md (Hypervisor compaction, Seam 2) + .claude/plan-coordination/README.md.
#
# Fires BEFORE the harness compacts the window (matcher-less: both manual + auto).
# stdin JSON: { session_id, transcript_path, cwd, hook_event_name, trigger }.
#
# A PreCompact hook CANNOT inject context — it can only run a side effect and,
# via exit 2, block. Its job here is durability, not steering:
#   1. Record an append-only `compaction-frame` audit row (carrying session_id)
#      marking the boundary — the OBSERVABLE signal the control loop watches to
#      know a compaction happened, independent of the SessionStart hook.
#   2. Verify a fresh current_context checkpoint exists.
#        - trigger=auto:   NEVER block (blocking auto-compaction risks a hard
#                          context death); warn on stderr if the checkpoint lags.
#        - trigger=manual: may BLOCK (exit 2) when no fresh checkpoint exists,
#                          forcing the Hypervisor to CHECKPOINT before /compact.
#
# Self-gated on the POSITIVE identity marker (`<session>/.hypervisor/role == hypervisor`),
# so it is a complete no-op for any non-Hypervisor session — including a dispatched
# orchestrator that inherited the parent environment. Never fails a compaction
# because bun/jq/db.ts is missing, and every store call is wall-clock-bounded.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib-hypervisor.sh
source "$HOOK_DIR/_lib-hypervisor.sh"

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat 2>/dev/null || true)

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
TRIGGER=$(printf '%s' "$INPUT" | jq -r '.trigger // "auto"' 2>/dev/null || echo auto)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

__hypervisor_is_hv "${SESSION_ID:-}" "${CWD:-$PWD}" || exit 0   # not the Hypervisor (subdir+owner-match): complete no-op
PLAN=$(__hypervisor_plan_dir "${SESSION_ID:-}" "${CWD:-$PWD}")
[[ -z "$PLAN" ]] && exit 0            # no recorded plan: nothing to checkpoint against
PROJ=$(__hypervisor_proj "${CWD:-$PWD}")
[[ -z "$PROJ" ]] && exit 0            # db.ts unreachable: never break compaction

# (The Hypervisor's own session id lives in current_context.my_session_id — captured at
# INITIALIZE from $CLAUDE_CODE_SESSION_ID, cross-checked against the statusline-written
# .hypervisor/<session_id>/session-id — and is what the control loop uses to filter
# compaction-frames to its own session. The frame below carries this session's id from
# stdin, so the loop's own-session THRASH filter works without this hook writing any marker.)

# Read the live resume snapshot. A read error must never fail the compaction.
CC=$(__hypervisor_db "$PROJ" "$PLAN" get current_context 2>/dev/null || true)
SEQ=$(printf '%s' "$CC" | jq -r '.seq // empty' 2>/dev/null || true)

# (1) Best-effort append-only audit row marking the boundary (carries session_id).
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FRAME=$(jq -nc \
  --arg trigger "$TRIGGER" --arg session_id "${SESSION_ID:-}" --arg transcript_path "$TRANSCRIPT" \
  --arg current_context_seq "${SEQ:-}" --arg timestamp "$TIMESTAMP" \
  '{trigger:$trigger, session_id:$session_id, transcript_path:$transcript_path, current_context_seq:$current_context_seq, timestamp:$timestamp}' 2>/dev/null || true)
if [[ -n "$FRAME" ]]; then
  __hypervisor_db "$PROJ" "$PLAN" append compaction-frame "$FRAME" >/dev/null 2>&1 || true
fi

# (2) Freshness gate. The hook cannot see the Hypervisor's in-head state, so the
# strongest proxy it can verify is: current_context parses AND carries a real
# (>0) seq — i.e. the Hypervisor has checkpointed at least once beyond the seed.
FRESH=0
if [[ -n "$CC" ]] && printf '%s' "$CC" | jq -e '.' >/dev/null 2>&1; then
  if [[ -n "$SEQ" && "$SEQ" =~ ^[0-9]+$ && "$SEQ" -gt 0 ]]; then
    FRESH=1
  fi
fi

if [[ "$TRIGGER" == "manual" && "$FRESH" -ne 1 ]]; then
  echo "PreCompact[Hypervisor]: refusing manual compaction — no fresh current_context checkpoint (seq=${SEQ:-none}) for plan '$PLAN'. CHECKPOINT first, then compact." >&2
  exit 2
fi

if [[ "$FRESH" -ne 1 ]]; then
  echo "PreCompact[Hypervisor]: WARN auto-compaction with stale/absent checkpoint (seq=${SEQ:-none}) for plan '$PLAN'; the store digest may lag this window." >&2
fi

exit 0
