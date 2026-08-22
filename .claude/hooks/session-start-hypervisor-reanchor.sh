#!/usr/bin/env bash
# SessionStart hook — Hypervisor post-compaction re-anchor (Seam 3).
# Design: .claude/hooks/README.md (Hypervisor compaction, Seam 3) + .claude/plan-coordination/README.md.
#
# stdin JSON includes { cwd, source, session_id, ... } where
# source ∈ startup|resume|clear|compact.
#
# SessionStart is the only post-compaction hook that can put text BACK into the
# continuing context (hookSpecificOutput.additionalContext). We inject a digest
# that (a) re-asserts the Hypervisor ROLE and (b) re-hydrates from the durable
# LMDB store, so a window just collapsed to a summary resumes from disk.
#
# Two gates, both of which a dispatched orchestrator fails:
#   - source must be `compact` or `resume` (a real compaction or an operator
#     restart) — NOT `startup`/`clear`. A freshly-spawned worker is `startup`, so
#     it never receives the role assertion even if it somehow reached this point.
#   - the POSITIVE identity marker `<session>/.hypervisor/role == hypervisor` must hold.
# Emits `{}` (a valid no-op) otherwise, and whenever bun/jq/db.ts or a real resume
# snapshot is absent. It NEVER blocks (SessionStart cannot block).

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib-hypervisor.sh
source "$HOOK_DIR/_lib-hypervisor.sh"

emit_noop() { printf '{}\n'; exit 0; }

command -v jq >/dev/null 2>&1 || emit_noop
INPUT=$(cat 2>/dev/null || true)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
SOURCE=$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

# Source-gate: only re-anchor on a real compaction or an operator resume.
case "$SOURCE" in
  compact|resume) ;;
  *) emit_noop ;;
esac

__hypervisor_is_hv "${SESSION_ID:-}" "${CWD:-$PWD}" || emit_noop   # not the Hypervisor (subdir+owner-match): no-op
PLAN=$(__hypervisor_plan_dir "${SESSION_ID:-}" "${CWD:-$PWD}")
[[ -z "$PLAN" ]] && emit_noop
PROJ=$(__hypervisor_proj "${CWD:-$PWD}")
[[ -z "$PROJ" ]] && emit_noop

# Without a real resume snapshot there is nothing to re-anchor to: stay silent.
CC=$(__hypervisor_db "$PROJ" "$PLAN" get current_context 2>/dev/null || true)
if [[ -z "$CC" ]] || ! printf '%s' "$CC" | jq -e '.' >/dev/null 2>&1; then
  emit_noop
fi

RESUME_MODE=$(printf '%s' "$CC" | jq -r '.resume_mode // "unknown"' 2>/dev/null || echo unknown)
SEQ=$(printf '%s' "$CC" | jq -r '.seq // "?"' 2>/dev/null || echo '?')
SIGNAL=$(__hypervisor_db "$PROJ" "$PLAN" get control:signal 2>/dev/null || true)
PACING=$(__hypervisor_db "$PROJ" "$PLAN" get pacing:current 2>/dev/null || true)

# Best-effort namespace key counts via prefix scans (scan prints one key/line).
# Labelled honestly: these are namespace key totals, not state-filtered "open" sets.
__hypervisor_count() { __hypervisor_db "$PROJ" "$PLAN" scan "$1" 2>/dev/null | grep -c . || true; }
N_WORK=$(__hypervisor_count "work_item:")          # work_item:* are deleted on completion -> ~ active+next
N_FIND=$(__hypervisor_count "finding:")            # append-only audit rows (incl. closed) -> total, not open
N_ESC=$(__hypervisor_count "escalation:")          # persist until acknowledged -> ~ open
N_ORCH_KEYS=$(__hypervisor_count "orch:")          # two keys per orchestrator (:status + :heartbeat)
N_ORCH=$(( ${N_ORCH_KEYS:-0} / 2 ))

# Phrase by source: a compaction "collapsed" the window; a resume reopened the session.
if [[ "$SOURCE" == "compact" ]]; then
  WHAT="Your context was just COMPACTED — your conversation history was collapsed to a summary"
else
  WHAT="You just RESUMED this session"
fi

# NB: assign via `read -r -d ''`, NOT `DIGEST=$(cat <<EOF …)`. macOS /bin/bash 3.2 mis-parses
# a here-doc nested inside $(...) (an apostrophe in the body trips its tokenizer) — a syntax
# error that would break the WHOLE hook at runtime. `read` with the heredoc attached parses
# cleanly on 3.2. `|| true` because read returns 1 at EOF under `set -e`.
IFS= read -r -d '' DIGEST <<EOF || true
=== ROLE RE-ASSERTION (source=${SOURCE}) — YOU ARE THE HYPERVISOR (agent: hypervisor) ===
You are the root supervisor of the orchestrator fleet, operating on plan ${PLAN}. ${WHAT}, but YOUR ROLE IS UNCHANGED. You REMAIN the Hypervisor and you are MID-RUN in your control loop. Do NOT revert to a generic assistant, do NOT wait for fresh human instructions, do NOT re-introduce yourself or restart the objective — resume supervising the fleet from disk. If anything about your identity feels uncertain, THIS line overrides it: you ARE the Hypervisor; re-read your agent definition's control loop and continue.

DISK IS AUTHORITATIVE; your window is only a cache — do not trust the summary for detail. Re-hydrate from the LMDB store now:
- current_context: resume_mode=${RESUME_MODE}, seq=${SEQ}. Read it, verify its checksum, and on mismatch roll back to the latest ckpt:<seq>.
- control:signal=${SIGNAL:-<unread>} — read this FIRST every cycle (abort => wind down + HALT without deleting the store; pause => sleep).
- pacing:current present=$( [[ -n "$PACING" ]] && echo yes || echo no ) — restore the 7-day anchor before pacing parallelism.
- store namespace key counts (totals, NOT state-filtered): work_item:* ~${N_WORK} (≈ active+next), finding:* ~${N_FIND} (append-only audit, incl. closed), escalation:* ~${N_ESC} (≈ open), orchestrators ~${N_ORCH}.
Next: run \`bun .claude/plan-coordination/db.ts keys ${PLAN}\` for the size-annotated index, then selectively \`get\` only the pointers the ingest matrix warrants. Never auto-load verbose report bodies. Then re-enter your control loop at CONTROL+PERCEIVE — as the Hypervisor.
EOF

jq -nc --arg c "$DIGEST" \
  '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}'
exit 0
