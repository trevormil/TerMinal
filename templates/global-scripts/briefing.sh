#!/usr/bin/env bash
# briefing — the morning roll-up. Full contract: briefing.md (alongside).
#
# Global agent: reads the last 24h across EVERY repo and writes one file to
# ~/.config/TerMinal/briefings/<date>.md, then files exactly one low-severity
# HITL so it lands silently in the Inbox with a badge and no ping.
#
# Unlike the per-repo cadence agents there is no SHA gate — trunk state is
# irrelevant to "what happened yesterday". The gate here is idempotence on the
# DATE: a second run on the same day is a no-op unless forced.
#
# Runner env: TERMINAL_REPO / TERMINAL_AGENT_ID / TERMINAL_RUN_ID /
#             TERMINAL_WORKTREE / TERMINAL_ENGINE / TERMINAL_MODEL

set -uo pipefail

CFG="$HOME/.config/TerMinal"
BRIEFINGS="$CFG/briefings"
date_str=$(date +%Y-%m-%d)
out="$BRIEFINGS/$date_str.md"

mkdir -p "$BRIEFINGS"

# ---------------------------------------------------------------------------
# 1. Date gate. Re-running the same day would file a second HITL and clobber
#    verdicts the human may already have recorded against today's item ids.
#    BRIEFING_FORCE=1 overrides (useful when the morning run failed halfway).
# ---------------------------------------------------------------------------
if [ -f "$out" ] && [ "${BRIEFING_FORCE:-0}" != "1" ]; then
  echo "briefing: $date_str already written — nothing to do."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Gather. All deterministic, all via MCP — no tokens spent yet. Each block
#    is best-effort: a single unavailable tool must not lose the whole briefing.
# ---------------------------------------------------------------------------
gather() {
  local label=$1
  shift
  echo "### $label"
  terminal-cli mcp "$@" 2>/dev/null || echo "(unavailable)"
  echo
}

facts_file=$(mktemp)
trap 'rm -f "$facts_file" "${prompt_file:-}"' EXIT

{
  gather "Recent agent runs (24h)" recent_agent_runs limit=60
  gather "Open HITL" list_hitl status=open
  gather "Factory health" factory_health
  gather "Recent activity" list_activity limit=80
} > "$facts_file"

# Report artifacts written in the last 24h.
#
# Scoped to the workspaces TerMinal already knows about, NOT a walk of $HOME.
# Walking $HOME on macOS traverses ~/Library, iCloud Drive, and every
# node_modules on the disk at 07:00, and can trip TCC permission prompts on
# Desktop/Documents. It was also WRONG in the other direction: a fixed
# -maxdepth silently missed worktree reports, which sit several levels deeper
# than a plain checkout (<worktrees-root>/<repo>/<branch>/.TerMinal/reports/...).
#
# Roots come from the schedules TerMinal is actually running, plus any worktrees
# of those repos, so depth stops mattering.
roots=$(jq -r '.[].repoRoot // empty' "$CFG/schedules.json" 2>/dev/null | sort -u)

{
  echo "### Report artifacts written in the last 24h"
  if [ -n "$roots" ]; then
    while IFS= read -r root; do
      [ -d "$root" ] || continue
      # The repo itself…
      find "$root/.TerMinal/reports" -name '*.md' -mtime -1 2>/dev/null | head -20
      # …and every worktree attached to it, wherever they live.
      git -C "$root" worktree list --porcelain 2>/dev/null \
        | sed -n 's/^worktree //p' \
        | while IFS= read -r wt; do
            [ "$wt" = "$root" ] && continue
            find "$wt/.TerMinal/reports" -name '*.md' -mtime -1 2>/dev/null | head -10
          done
    done <<< "$roots" | head -40
  else
    echo "(no scheduled workspaces to scan)"
  fi
  echo
  echo "### Persistent-agent artifacts written in the last 24h"
  find "$CFG/persistent-agents" -name 'report.md' -mtime -1 2>/dev/null | head -20
  echo
} >> "$facts_file"

# ---------------------------------------------------------------------------
# 3. Escalate. This is the one LLM call — synthesis is the whole job here, so
#    unlike the cadence agents there is no cheap path that avoids it.
# ---------------------------------------------------------------------------
engine=${TERMINAL_ENGINE:-claude}
case "$engine" in
  codex) model=${TERMINAL_MODEL:-gpt-5-mini} ;;
  cursor) model=${TERMINAL_MODEL:-composer-2.5-fast} ;;
  *) model=${TERMINAL_MODEL:-sonnet} ;;
esac

prompt_file=$(mktemp)
cat > "$prompt_file" <<EOF
You are the briefing agent. Your complete contract is briefing.md next to this
script (also at ~/.config/TerMinal/scripts/briefing.md) — read it and honor it
exactly, especially the output schema and the ledgerKey rule.

Today is $date_str. Write the briefing to:
  $out

Here is everything gathered deterministically for you. Do NOT re-run these
queries; open a specific artifact file only if you need a number from it.

$(cat "$facts_file")

Produce $out in exactly the schema from briefing.md:
- YAML frontmatter: kind, date, generated, items, status.
- An H1, then ONE short paragraph of prose summary (this is what he reads first
  — make it the three most important facts, not a restatement of the counts).
- An "## Items" heading, then one "### [kind] Title" block per item with its
  '- field: value' lines.

Rules that matter most:
- Emit \`ledgerKey\` on every item an agent PROPOSED (ideas, suggested tickets,
  lessons) and on NO item that merely happened (a PR opening, a run failing).
  Read the producing agent's proposedIdeas ledger at
  ~/.config/TerMinal/agent-state/<repo>/<agent>.json (the proposedIdeas array,
  agent-owned) to get the exact key —
  a guessed key silently breaks Dismiss.
- One item per THING, not per event. A run that opened a PR is one [pr] item.
- Rank: blockers first, then PRs awaiting review, then proposals, then the rest.
- Cap at 12 items; roll the tail into one [note] saying how many were elided.
- Zero items is a valid, good outcome — still write the file.

Then, exactly once:
  terminal-cli hitl --severity=low "Morning briefing — <N> items" "Review in the Inbox drawer."

--severity=low is REQUIRED. It is what makes this land silently in the Inbox
with a badge instead of pinging his phone. Never file a per-item HITL.

Finally:
  terminal-cli activity check "Briefing · <N> items" "$date_str"
  terminal-cli mcp set_run_outcome runId=\$TERMINAL_RUN_ID outcome=none

Never edit source, never open a PR, never merge. Never write
$BRIEFINGS/$date_str.verdicts.json — that file belongs to the app.
EOF

case "$engine" in
  codex)
    codex exec -s danger-full-access -C "${TERMINAL_WORKTREE:-$TERMINAL_REPO}" --model "$model" "$(<"$prompt_file")"
    exit_code=$?
    ;;
  cursor)
    cursor-agent -p --force --trust --workspace "${TERMINAL_WORKTREE:-$TERMINAL_REPO}" --model "$model" "$(<"$prompt_file")"
    exit_code=$?
    ;;
  *)
    claude -p "$(<"$prompt_file")" --permission-mode auto --model "$model"
    exit_code=$?
    ;;
esac

# No silent failures: if the engine exited without producing the file, say so
# loudly rather than leaving an empty Today section with no explanation.
if [ ! -f "$out" ]; then
  echo "briefing: engine exited $exit_code without writing $out" >&2
  terminal-cli hitl --severity=low "Morning briefing failed" \
    "The briefing agent ran but produced no file for $date_str. Check the run log."
  exit 1
fi

exit $exit_code
