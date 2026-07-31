#!/usr/bin/env bash
# deps-quality — dependency hygiene + code-quality sweep, and the bot-PR janitor.
# Full contract: .agents/deps-quality.md.
#
# WHY THIS SCRIPT EXISTS AT ALL:
#
# Closing a pull request is the only IRREVERSIBLE write an agent makes to the
# forge. Everything else this factory does is proposal-shaped and gated by a
# human merge; a closed dependabot PR is different — dependabot reads a
# human-closed PR as "never offer this version again", so a wrong close silently
# removes a security bump from the queue forever.
#
# Leaving those rules as prose in a .md file means they are instructions to an
# LLM holding a `gh` token with --permission-mode auto. So the janitor's safety
# properties are enforced HERE, deterministically, before any engine runs:
#
#   * exact bot-login match (not a substring)
#   * security PRs excluded from the candidate set entirely
#   * never close against an unmerged PR
#   * a hard counter cap
#   * dry-run by default; the close list is written to the artifact first
#
# The engine is never handed the close list as an executable instruction. This
# script does the closing itself, or nothing does.
#
# Runner env: TERMINAL_REPO / TERMINAL_AGENT_ID / TERMINAL_RUN_ID /
#             TERMINAL_BRANCH / TERMINAL_WORKTREE / TERMINAL_ENGINE / TERMINAL_MODEL
#
# Knobs:
#   DEPS_JANITOR_APPLY=1   actually close (default: dry-run, report only)
#   DEPS_JANITOR_CAP=N     max closes per run (default 20)

set -uo pipefail

wt="${TERMINAL_WORKTREE:-$TERMINAL_REPO}"
repo_name=$(basename "$TERMINAL_REPO")
CAP=${DEPS_JANITOR_CAP:-20}
APPLY=${DEPS_JANITOR_APPLY:-0}

# Exact logins only. `test("dependabot|renovate")` would match a HUMAN named
# renovate-fan, dependabot-watcher, or an org member acme-renovate — and closing
# a person's PR because their username contains a substring is unacceptable.
BOT_LOGINS='["dependabot","dependabot[bot]","app/dependabot","renovate","renovate[bot]","app/renovate","renovate-bot"]'

if ! command -v jq >/dev/null 2>&1; then
  echo "deps-quality: jq is required — skipping run." >&2
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
short=$(git -C "$TERMINAL_REPO" rev-parse --short "$head")

if [ -d "$TERMINAL_REPO/reports" ] && [ ! -f "$TERMINAL_REPO/.TerMinal/template.json" ]; then
  reports_dir="$TERMINAL_REPO/reports"
else
  reports_dir="$TERMINAL_REPO/.TerMinal/reports"
fi
mkdir -p "$reports_dir/deps-quality"
report="$reports_dir/deps-quality/${short}.md"
janitor_log=$(mktemp)
trap 'rm -f "$janitor_log" "${prompt_file:-}"' EXIT

# ---------------------------------------------------------------------------
# 2. The bot-PR janitor. Deterministic; runs before the engine and independently
#    of it, so a failed/skipped LLM pass cannot cause a wrong close and a
#    successful one cannot cause an unreviewed close.
# ---------------------------------------------------------------------------
janitor_closed=0
janitor_candidates=0
janitor_skipped_security=0

if command -v gh >/dev/null 2>&1; then
  pr_json=$(gh pr list --repo "$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo '')" \
      --state open --limit 200 \
      --json number,title,author,createdAt,labels,isDraft 2>/dev/null || echo '[]')
  [ -z "$pr_json" ] && pr_json='[]'

  # Candidate set. Every exclusion here is a SAFETY property, so each one is a
  # filter in this pipeline rather than a row in a precedence table an LLM has
  # to read top-down (a table gets the precedence wrong the first time a major
  # version bump is also a security fix).
  candidates=$(echo "$pr_json" | jq -c --argjson bots "$BOT_LOGINS" '
    [ .[]
      # 1. EXACT bot login, or a verified bot account. Never a substring.
      | select((.author.login // "") as $l
               | ($bots | index($l) != null) or ((.author.is_bot // false) == true))
      # 2. SECURITY PRs ARE NEVER CANDIDATES. This is a precondition, not a
      #    later row: a major-version bump that is ALSO a CVE fix must be
      #    excluded here, before any close rule can reach it.
      | select(
          ([.labels[]?.name // ""] | map(ascii_downcase)
            | any(. | test("security|vulnerab|cve|advisory"))) == false)
      | select((.title // "") | ascii_downcase
            | test("security|vulnerab|cve|advisory") | not)
      | {number, title: (.title // ""), login: (.author.login // "")}
    ]' 2>/dev/null || echo '[]')
  [ -z "$candidates" ] && candidates='[]'

  janitor_candidates=$(echo "$candidates" | jq 'length')
  all_bot=$(echo "$pr_json" | jq --argjson bots "$BOT_LOGINS" '
    [ .[] | select((.author.login // "") as $l
      | ($bots | index($l) != null) or ((.author.is_bot // false) == true)) ] | length')
  janitor_skipped_security=$(( all_bot - janitor_candidates ))

  # Which of those are SAFE to close? Exactly one rule: the dependency is
  # already at or beyond this version on the default branch, i.e. the bump has
  # genuinely landed.
  #
  # We deliberately do NOT close "superseded by this run's sweep PR". The sweep
  # PR is unmerged BY DESIGN (global §8 human gate) — if the human then rejects
  # it, closing the bot PR against it would have destroyed the bump permanently.
  # We also do not close "red CI + stale": CI is frequently red for unrelated
  # infra reasons, and that is not the bot's fault.
  echo "$candidates" | jq -r '.[] | "\(.number)\t\(.title)"' > "$janitor_log"

  closable=$(mktemp)
  while IFS=$'\t' read -r num title; do
    [ -z "$num" ] && continue
    # Title shape: "Bump <dep> from <old> to <new>" / "chore(deps): update <dep> to v<new>"
    dep=$(printf '%s' "$title" | sed -nE 's/.*[Bb]ump ([^ ]+) from .*/\1/p; s/.*update ([^ ]+) to .*/\1/p' | head -1)
    newv=$(printf '%s' "$title" | sed -nE 's/.* to v?([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -1)
    [ -z "$dep" ] && continue
    [ -z "$newv" ] && continue
    onmain=$(jq -r --arg d "$dep" '
      ((.dependencies // {}) + (.devDependencies // {}))[$d] // ""
      | sub("^[\\^~]"; "")' "$TERMINAL_REPO/package.json" 2>/dev/null)
    [ -z "$onmain" ] && continue
    # Close only when main is already at or past the proposed version.
    if [ "$(printf '%s\n%s\n' "$newv" "$onmain" | sort -V | tail -1)" = "$onmain" ]; then
      printf '%s\t%s\t%s\t%s\n' "$num" "$dep" "$newv" "$onmain" >> "$closable"
    fi
  done < "$janitor_log"

  # Write the close list into the artifact BEFORE executing anything, so the
  # record exists even if the run dies mid-close.
  {
    echo "## Bot-PR janitor"
    echo
    echo "- bot PRs open: ${all_bot:-0}"
    echo "- excluded as security (never closable): ${janitor_skipped_security:-0}"
    echo "- candidates after filters: ${janitor_candidates:-0}"
    echo "- cap: $CAP"
    echo "- mode: $([ "$APPLY" = "1" ] && echo APPLY || echo DRY-RUN)"
    echo
    if [ -s "$closable" ]; then
      echo "| PR | dep | proposed | already on main |"
      echo "|---|---|---|---|"
      awk -F'\t' '{ printf "| #%s | %s | %s | %s |\n", $1, $2, $3, $4 }' "$closable"
    else
      echo "_Nothing safe to close._"
    fi
    echo
  } > "$report.janitor"

  if [ -s "$closable" ]; then
    if [ "$APPLY" = "1" ]; then
      while IFS=$'\t' read -r num dep newv onmain; do
        if [ "$janitor_closed" -ge "$CAP" ]; then
          echo "deps-quality: janitor cap ($CAP) reached — leaving the rest for the next run."
          break
        fi
        # Comment BEFORE closing. A silently closed PR is indistinguishable
        # from a bug, and the human would have to re-derive the reasoning.
        gh pr comment "$num" --body \
          "Closing: \`$dep\` is already at \`$onmain\` on the default branch, at or past the \`$newv\` proposed here. Closed by the deps-quality janitor (run \`${TERMINAL_RUN_ID:-?}\`); reopen if this is wrong." >/dev/null 2>&1
        if gh pr close "$num" >/dev/null 2>&1; then
          janitor_closed=$((janitor_closed + 1))
        fi
      done < "$closable"
    else
      # DRY-RUN is the default. A first run against a year of accumulated bot
      # PRs should produce a reviewable list, not 20 immediate closes.
      n=$(wc -l < "$closable" | tr -d ' ')
      terminal-cli hitl "deps-quality janitor: $n bot PR(s) ready to close in $repo_name" \
        "Dry-run only — nothing was closed. Review the list in $report, then re-run with DEPS_JANITOR_APPLY=1 to execute. Closing is irreversible: dependabot treats a human-closed PR as 'never offer this version again'."
    fi
  fi
  rm -f "$closable"
else
  echo "## Bot-PR janitor" > "$report.janitor"
  echo >> "$report.janitor"
  echo "_Skipped: \`gh\` not available._" >> "$report.janitor"
fi

# ---------------------------------------------------------------------------
# 3. SHA gate for the (expensive) sweep half. The janitor above runs every time
#    because bot PRs accumulate regardless of whether trunk moved.
# ---------------------------------------------------------------------------
if [ "$head" = "$last" ]; then
  echo "deps-quality: no new commits since $last — janitor ran, skipping the sweep."
  cat "$report.janitor" >> "$report" 2>/dev/null || true
  rm -f "$report.janitor"
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Escalate for the dependency + quality sweep.
# ---------------------------------------------------------------------------
engine=${TERMINAL_ENGINE:-claude}
case "$engine" in
  codex) model=${TERMINAL_MODEL:-gpt-5-mini} ;;
  cursor) model=${TERMINAL_MODEL:-composer-2.5-fast} ;;
  *) model=${TERMINAL_MODEL:-haiku} ;;
esac

prompt_file=$(mktemp)
cat > "$prompt_file" <<EOF
You are the deps-quality agent for repo $TERMINAL_REPO ($repo_name) at $short.
Your complete contract is .agents/deps-quality.md — read it and honor it.

The bot-PR janitor has ALREADY RUN deterministically in this script. Its result
is in $report.janitor. Do NOT close, comment on, or otherwise touch any pull
request — that half is not yours and closing is irreversible.

Your job is the sweep only:
1. Run \`bun audit\` (or the ecosystem equivalent). Any Critical/High advisory
   that you cannot fix safely → \`terminal-cli hitl\`, never a silent downgrade.
2. Identify safe bumps: patch/minor only, each version at least 3 days old
   (global §10), no breaking semver. NEVER a major — a major is a ticket.
3. Run the formatter and linter with auto-fix.
4. Flag TODO/FIXME older than 90 days (via git blame) as a ticket per cluster.
5. If anything changed: commit on this worktree's branch, push, open a PR
   titled \`chore: deps + lint sweep\`. NEVER merge it.
6. Write the artifact to $report per the schema in .agents/deps-quality.md,
   and APPEND the janitor section that is already sitting in $report.janitor.
7. \`terminal-cli activity check "Deps+quality · <N> bumps · <C> CVEs" "@ $short"\`
8. Tail-call \`terminal-cli mcp set_run_outcome runId=\$TERMINAL_RUN_ID outcome=<...>\`
   with exactly one of: pr-opened | ticket-filed | merged | none.

Token discipline: inspect manifests, lockfiles and audit output — not the whole
repo.
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

# Make sure the janitor record survives even if the engine never wrote the
# artifact — it is the audit trail for the one irreversible action here.
if [ -f "$report.janitor" ]; then
  cat "$report.janitor" >> "$report" 2>/dev/null || true
  rm -f "$report.janitor"
fi

terminal-cli state mark-main
terminal-cli state set lastJanitorClosed "$janitor_closed"

exit $exit_code
