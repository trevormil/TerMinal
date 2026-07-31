#!/usr/bin/env bash
# ticket-ideas — proposes at most 3 new `horizon: future` tickets per day.
# Full contract: .agents/ticket-ideas.md. Ledger convention: .agents/scripts.md.
#
# Two deterministic gates run before a single token is spent:
#
#   1. SHA gate    — trunk hasn't moved, nothing new to think about.
#   2. Budget gate — 3 ideas already proposed in the last 24h.
#
# Gate 2 is the one that matters. The SHA gate stops the agent re-RUNNING;
# only the ledger stops it re-PROPOSING, and trunk moves every day.
#
# Runner env: TERMINAL_REPO / TERMINAL_AGENT_ID / TERMINAL_RUN_ID /
#             TERMINAL_BRANCH / TERMINAL_WORKTREE / TERMINAL_ENGINE / TERMINAL_MODEL

set -uo pipefail

wt="${TERMINAL_WORKTREE:-$TERMINAL_REPO}"
repo_name=$(basename "$TERMINAL_REPO")
DAILY_CAP=${TICKET_IDEAS_DAILY_CAP:-3}

if ! command -v jq >/dev/null 2>&1; then
  echo "ticket-ideas: jq is required for the dedup ledger — skipping run." >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. SHA gate.
# ---------------------------------------------------------------------------
last=$(terminal-cli state get-sha)

git -C "$TERMINAL_REPO" fetch --quiet origin || true
head=$(git -C "$TERMINAL_REPO" rev-parse origin/main 2>/dev/null \
    || git -C "$TERMINAL_REPO" rev-parse origin/master 2>/dev/null \
    || git -C "$TERMINAL_REPO" rev-parse HEAD)

if [ "$head" = "$last" ]; then
  echo "ticket-ideas: no new commits since $last — nothing to think about."
  exit 0
fi

short=$(git -C "$TERMINAL_REPO" rev-parse --short "$head")

# ---------------------------------------------------------------------------
# 2. Budget gate. Count ledger entries proposed in the last 24h. This is pure
#    arithmetic on a local JSON file — the cheapest possible way to enforce the
#    "at most 3 per day" hard rule, and it works even if the schedule fires
#    more than once a day.
# ---------------------------------------------------------------------------
proposed=$(terminal-cli state get proposedIdeas)
[ -z "$proposed" ] && proposed='[]'
echo "$proposed" | jq -e 'type == "array"' >/dev/null 2>&1 || proposed='[]'

dismissed=$(terminal-cli state get dismissed)
[ -z "$dismissed" ] && dismissed='[]'
echo "$dismissed" | jq -e 'type == "array"' >/dev/null 2>&1 || dismissed='[]'

cutoff=$(( $(date +%s) * 1000 - 86400000 ))
recent=$(echo "$proposed" | jq --argjson c "$cutoff" '[.[] | select((.at // 0) >= $c)] | length')

if [ "${recent:-0}" -ge "$DAILY_CAP" ]; then
  echo "ticket-ideas: $recent idea(s) already proposed in the last 24h (cap $DAILY_CAP) — skipping."
  terminal-cli state mark-main
  exit 0
fi

budget=$(( DAILY_CAP - recent ))

# Flatten both ledgers to a plain key list for the prompt. The LLM never needs
# the timestamps, and sending the raw JSON wastes tokens on punctuation.
proposed_keys=$(echo "$proposed" | jq -r '.[].key // empty' | sort -u | head -200)
dismissed_keys=$(echo "$dismissed" | jq -r '.[].key // empty' | sort -u | head -200)

# ---------------------------------------------------------------------------
# 3. Backlog + repo context. Both open AND closed tickets — a closed ticket is
#    a decision, not a vacancy.
# ---------------------------------------------------------------------------
backlog_titles=$(terminal-cli mcp list_tickets repo="$repo_name" 2>/dev/null \
  | jq -r 'if type == "array" then .[] else (.tickets // [])[] end
           | "\(.status // "?")\t\(.title // "")"' 2>/dev/null | head -200)
if [ -z "$backlog_titles" ]; then
  # MCP unavailable (server not installed, or repo not registered). Fall back
  # to reading the backlog directory directly rather than proposing blind —
  # proposing without knowing the backlog is exactly the failure mode this
  # agent exists to avoid.
  if [ -d "$TERMINAL_REPO/.TerMinal/backlog" ]; then
    backlog_titles=$(grep -h '^title:' "$TERMINAL_REPO"/.TerMinal/backlog/*.md 2>/dev/null | head -200)
  else
    echo "ticket-ideas: cannot read the backlog (no MCP, no .TerMinal/backlog) — skipping."
    exit 0
  fi
fi

range="${last:-HEAD~50}..$head"
commit_excerpt=$(git -C "$TERMINAL_REPO" log --oneline --decorate=no "$range" 2>/dev/null | head -80)
changed_excerpt=$(git -C "$TERMINAL_REPO" diff --name-only "$range" 2>/dev/null | sed '/^$/d' | head -120)
docs_index=$(cd "$TERMINAL_REPO" && find docs -name '*.md' 2>/dev/null | sort | head -30)

if [ -d "$TERMINAL_REPO/reports" ] && [ ! -f "$TERMINAL_REPO/.TerMinal/template.json" ]; then
  reports_dir="$TERMINAL_REPO/reports"
else
  reports_dir="$TERMINAL_REPO/.TerMinal/reports"
fi
mkdir -p "$reports_dir/ticket-ideas"
report="$reports_dir/ticket-ideas/${short}.md"

# ---------------------------------------------------------------------------
# 4. Escalate.
# ---------------------------------------------------------------------------
engine=${TERMINAL_ENGINE:-claude}
case "$engine" in
  codex) model=${TERMINAL_MODEL:-gpt-5-mini} ;;
  cursor) model=${TERMINAL_MODEL:-composer-2.5-fast} ;;
  *) model=${TERMINAL_MODEL:-haiku} ;;
esac

prompt_file=$(mktemp)
trap 'rm -f "$prompt_file"' EXIT
cat > "$prompt_file" <<EOF
You are the ticket-ideas agent for repo $TERMINAL_REPO ($repo_name) at $short.
Your complete contract is .agents/ticket-ideas.md — read it and honor it.

You may file AT MOST $budget ticket(s) this run. Filing ZERO is a completely
valid and common outcome — never pad to reach the cap.

## Already proposed (NEVER propose these again)
$proposed_keys

## Dismissed by the human (NEVER propose these again — dismissal is permanent)
$dismissed_keys

## Existing backlog, open and closed (a closed ticket is a DECISION, not a vacancy)
$backlog_titles

## What changed since the last scan ($range)
$commit_excerpt

## Changed files (capped)
$changed_excerpt

## Project docs you may consult for stated direction
$docs_index

Do this:
1. Generate candidate ideas grounded in the change surface above and in the
   project's stated direction (README, docs/architecture.md, docs/decisions/,
   CLAUDE.md). An idea nobody has had is worth more than a well-phrased
   restatement of an open ticket.
2. SUBTRACT. Drop any candidate matching a proposed or dismissed key above.
   Then drop any candidate that is a semantic near-duplicate of a backlog title
   — the key list is an exact-match guard only; you are the fuzzy check.
3. Rank what survives and keep at most $budget.
4. File each with \`terminal-cli ticket "<title>" "<body>"\`, and ensure the
   ticket carries \`horizon: future\` and \`priority: low\`. An idea agent does
   not get to set the day's priorities.
5. APPEND TO THE LEDGER. For each filed idea compute its key (lowercase, drop
   articles and filler verbs like add/improve/refactor/consider, keep the nouns,
   join with '-', max 60 chars) and append. Read-modify-write the whole array:

     current=\$(terminal-cli state get proposedIdeas)
     [ -z "\$current" ] && current='[]'
     next=\$(echo "\$current" | jq --arg k "<key>" --arg t "<ticket-id>" \\
       '. + [{key: \$k, ticket: \$t, at: (now * 1000 | floor)}]')
     terminal-cli state set proposedIdeas "\$next"

   This step is NOT optional. Skipping it means you re-propose the same idea
   tomorrow, and the day after, until the backlog is unusable.
6. Write the artifact to $report with the frontmatter schema in
   .agents/ticket-ideas.md — including candidates_generated,
   suppressed_by_ledger and suppressed_by_backlog. Write it even when you file
   nothing.
7. Emit \`terminal-cli activity check "Ideas · <N> filed" "@ $short"\`
8. Tail-call \`terminal-cli mcp set_run_outcome runId=\$TERMINAL_RUN_ID outcome=<outcome>\`
   with exactly one of the four allowed values: pr-opened | ticket-filed |
   merged | none. Use \`ticket-filed\` if you filed anything, \`none\` if not.
   The morning briefing classifies this run from that tag, so it is not
   optional.

Report mode: do NOT edit source, do NOT open a PR.

Token discipline: read the listed docs and changed paths only. Do not read the
whole repo.
EOF

case "$engine" in
  codex)
    codex exec -s danger-full-access -C "$wt" --model "$model" "$(<"$prompt_file")"
    exit_code=$?
    ;;
  cursor)
    cursor-agent -p --force --trust --workspace "$wt" --model "$model" "$(<"$prompt_file")"
    exit_code=$?
    ;;
  *)
    claude -p "$(<"$prompt_file")" --permission-mode auto --model "$model"
    exit_code=$?
    ;;
esac

terminal-cli state mark-main

exit $exit_code
