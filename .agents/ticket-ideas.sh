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
# FAIL CLOSED on a corrupt ledger. Absent is fine (first run); present but
# unparseable is not. Treating a corrupt ledger as empty silently re-proposes
# every idea the human has ever rejected — the exact failure this exists to
# prevent — so stop and ask for a human instead.
proposed=$(terminal-cli state get proposedIdeas)
if [ -z "$proposed" ]; then
  proposed='[]'
elif ! echo "$proposed" | jq -e 'type == "array"' >/dev/null 2>&1; then
  terminal-cli hitl "ticket-ideas ledger is corrupt in $repo_name" \
    "proposedIdeas in ~/.config/TerMinal/agent-state/$repo_name/$TERMINAL_AGENT_ID.json is not an array. Refusing to run — re-proposing rejected ideas is worse than skipping a day."
  exit 0
fi

# `dismissed` lives in a SEPARATE file owned by the app's review surface (see
# scripts.md → Dedup ledger). Two files, one per writer, so a concurrent run and
# a concurrent Dismiss tap can never clobber each other's read-modify-write.
dismissed_file="$HOME/.config/TerMinal/agent-state/$repo_name/$TERMINAL_AGENT_ID.dismissed.json"
dismissed='[]'
if [ -f "$dismissed_file" ]; then
  if ! dismissed=$(jq -c '.dismissed // []' "$dismissed_file" 2>/dev/null); then
    terminal-cli hitl "ticket-ideas dismissal ledger is corrupt in $repo_name" \
      "$dismissed_file is unparseable. Refusing to run — proceeding would re-propose ideas you already rejected."
    exit 0
  fi
fi

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
#
# Sort by `at` DESCENDING, not alphabetically: once a ledger outgrows the cap an
# alphabetical `sort -u | head` keeps an arbitrary slice, and old rejected ideas
# start silently reappearing. Newest-first at least degrades predictably.
proposed_keys=$(echo "$proposed" | jq -r 'sort_by(-(.at // 0))[] | .key // empty' | head -200)
dismissed_keys=$(echo "$dismissed" | jq -r 'sort_by(-(.at // 0))[] | .key // empty' | head -200)

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
  if [ -d "$TERMINAL_REPO/$TERMINAL_BACKLOG_DIR" ]; then
    backlog_titles=$(grep -h '^title:' "$TERMINAL_REPO"/$TERMINAL_BACKLOG_DIR/*.md 2>/dev/null | head -200)
  else
    echo "ticket-ideas: cannot read the backlog (no MCP, no $TERMINAL_BACKLOG_DIR) — skipping."
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
  reports_dir="$TERMINAL_REPO/$TERMINAL_REPORTS_DIR"
fi
mkdir -p "$reports_dir/ticket-ideas"
report="$reports_dir/ticket-ideas/${short}.md"

# Where tickets actually land, so we can observe what the engine filed rather
# than trusting it to tell us (see step 5 below).
if [ -d "$TERMINAL_REPO/$TERMINAL_BACKLOG_DIR" ]; then
  backlog_dir="$TERMINAL_REPO/$TERMINAL_BACKLOG_DIR"
else
  backlog_dir="$TERMINAL_REPO/backlog"
fi
before_tickets=$(mktemp)
after_tickets=$(mktemp)
trap 'rm -f "$prompt_file" "$before_tickets" "$after_tickets"' EXIT
ls -1 "$backlog_dir" 2>/dev/null | sort > "$before_tickets"

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
5. Do NOT write the dedup ledger yourself. This script observes which backlog
   files appeared and records them for you, so the daily cap holds even if this
   run dies halfway. Just file the tickets in step 4 and move on.
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

# ---------------------------------------------------------------------------
# 5. Record what was ACTUALLY filed. The script does this, not the engine.
#
#    The cap is only "hard" if the ledger is written by something that cannot
#    forget: an engine that files three tickets and then crashes, hits its
#    timeout, or simply skips the instruction would leave the cap permanently
#    disengaged and re-propose the same ideas forever. So we diff the backlog
#    directory across the engine call and derive the entries ourselves.
# ---------------------------------------------------------------------------
ls -1 "$backlog_dir" 2>/dev/null | sort > "$after_tickets"
new_tickets=$(comm -13 "$before_tickets" "$after_tickets" | grep -E '\.md$' || true)

if [ -n "$new_tickets" ]; then
  next="$proposed"
  filed=0
  while IFS= read -r fname; do
    [ -z "$fname" ] && continue
    title=$(grep -m1 '^title:' "$backlog_dir/$fname" 2>/dev/null \
      | sed -e 's/^title:[[:space:]]*//' -e 's/^["'"'"']//' -e 's/["'"'"']$//')
    [ -z "$title" ] && title="${fname%.md}"
    # Key = slug of the SUBJECT: lowercase, drop articles and filler verbs so a
    # reword doesn't defeat the ledger, collapse to hyphens, cap at 60 chars.
    key=$(printf '%s' "$title" \
      | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/ /g; s/\b(a|an|the|to|for|of|in|on|and|or|add|adds|improve|improves|refactor|consider|support|update|fix)\b//g' \
      | tr -s ' ' | sed -E 's/^ | $//g; s/ /-/g' | cut -c1-60)
    [ -z "$key" ] && continue
    # Idempotent: never double-append a key that is already on the ledger.
    if echo "$next" | jq -e --arg k "$key" 'any(.[]; .key == $k)' >/dev/null 2>&1; then
      continue
    fi
    next=$(echo "$next" | jq --arg k "$key" --arg t "${fname%.md}" \
      '. + [{key: $k, ticket: $t, at: (now * 1000 | floor)}]')
    filed=$((filed + 1))
  done <<< "$new_tickets"

  if [ "$filed" -gt 0 ]; then
    terminal-cli state set proposedIdeas "$next"
    echo "ticket-ideas: recorded $filed new idea(s) on the ledger."
  fi
fi

terminal-cli state mark-main

exit $exit_code
