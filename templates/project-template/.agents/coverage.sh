#!/usr/bin/env bash
# coverage — test-coverage gap finder. Script-first implementation of the
# contract in .agents/coverage.md, following the same shape as drift.sh:
#
#   1. SHA gate      — exit 0 if trunk hasn't moved since the last scan.
#   2. Suite precheck — a coverage agent must never add tests to a red suite,
#                       so we run the suite ourselves BEFORE spending a token.
#   3. Escalate      — only now hand a capped prompt to the engine.
#
# The two cheap gates are the whole point: on a typical day trunk hasn't moved
# (gate 1) or the suite is green with no coverage regression (gate 2), and the
# run costs zero LLM tokens.
#
# Runner env (set by TerMinal):
#   TERMINAL_REPO      repo root
#   TERMINAL_AGENT_ID  this agent's id ("coverage") — state key
#   TERMINAL_RUN_ID    uuid of this run
#   TERMINAL_BRANCH    worktree branch (or "main" if inPlace)
#   TERMINAL_WORKTREE  worktree path
#   TERMINAL_ENGINE    "claude" | "codex" | "cursor"
#   TERMINAL_MODEL     model hint

set -uo pipefail

wt="${TERMINAL_WORKTREE:-$TERMINAL_REPO}"

# ---------------------------------------------------------------------------
# 1. SHA gate. lastScannedSha is "" on first run.
# ---------------------------------------------------------------------------
last=$(terminal-cli state get-sha)

git -C "$TERMINAL_REPO" fetch --quiet origin || true
head=$(git -C "$TERMINAL_REPO" rev-parse origin/main 2>/dev/null \
    || git -C "$TERMINAL_REPO" rev-parse origin/master 2>/dev/null \
    || git -C "$TERMINAL_REPO" rev-parse HEAD)

if [ "$head" = "$last" ]; then
  echo "coverage: no new commits since $last — nothing to scan."
  exit 0
fi

short=$(git -C "$TERMINAL_REPO" rev-parse --short "$head")

# Only source motion can change coverage. A docs-only range cannot, so mark
# and exit without paying for a suite run.
changed=$(git -C "$TERMINAL_REPO" diff --name-only "${last:-HEAD~50}..$head" 2>/dev/null || true)
if [ -n "$changed" ]; then
  code_changed=$(printf '%s\n' "$changed" | grep -Ev '^(docs/|\.TerMinal/|.*\.md$)' || true)
  if [ -z "$code_changed" ]; then
    echo "coverage: docs-only range — recording $short and exiting."
    terminal-cli state mark-main
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# 2. Suite precheck. Hard rule 1 of coverage.md is tests-only PRs; hard rule
#    "don't add tests to a broken suite" is the reason this gate exists. A red
#    suite is the health agent's problem, not ours — record status and stop.
# ---------------------------------------------------------------------------
if [ -d "$TERMINAL_REPO/reports" ] && [ ! -f "$TERMINAL_REPO/.TerMinal/template.json" ]; then
  reports_dir="$TERMINAL_REPO/reports"
else
  reports_dir="$TERMINAL_REPO/$TERMINAL_REPORTS_DIR"
fi
mkdir -p "$reports_dir/coverage"
report="$reports_dir/coverage/${short}.md"

suite_log=$(mktemp)
trap 'rm -f "$suite_log" "${prompt_file:-}"' EXIT

suite_cmd=""
if [ -f "$wt/package.json" ]; then
  suite_cmd="bun test"
elif [ -f "$wt/pyproject.toml" ]; then
  suite_cmd="pytest -q"
elif [ -f "$wt/Cargo.toml" ]; then
  suite_cmd="cargo test --quiet"
fi

if [ -z "$suite_cmd" ]; then
  # No recognizable runner. Per hard rule 5 of the /check contract ("no silent
  # failures"), write the artifact with an explicit status rather than exiting
  # quietly as if everything were fine.
  {
    echo "---"
    echo "kind: coverage"
    echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "sha: $short"
    echo "status: not-configured"
    echo "---"
    echo
    echo "No recognized test runner (package.json / pyproject.toml / Cargo.toml)."
  } > "$report"
  terminal-cli activity check "Coverage · not configured" "@ $short"
  terminal-cli state mark-main
  exit 0
fi

if ! (cd "$wt" && eval "$suite_cmd") >"$suite_log" 2>&1; then
  {
    echo "---"
    echo "kind: coverage"
    echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "sha: $short"
    echo "status: blocked"
    echo "---"
    echo
    echo "Suite is red at $short — refusing to add tests to a broken suite."
    echo
    echo '```'
    tail -80 "$suite_log"
    echo '```'
  } > "$report"
  terminal-cli activity check "Coverage · blocked (red suite)" "@ $short"
  # Deliberately NOT marking main: once the suite goes green we want this
  # range re-scanned rather than skipped forever.
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Escalate. Suite is green and source moved — this is the only path that
#    spends tokens.
# ---------------------------------------------------------------------------
engine=${TERMINAL_ENGINE:-claude}
case "$engine" in
  codex) model=${TERMINAL_MODEL:-gpt-5-mini} ;;
  cursor) model=${TERMINAL_MODEL:-composer-2.5-fast} ;;
  *) model=${TERMINAL_MODEL:-haiku} ;;
esac

prev_pct=$(terminal-cli state get lastCoveragePct)
source_touches=$(printf '%s\n' "$changed" \
  | grep -E '^(src|lib|app|packages|cmd|internal|server|client|web|api)/' \
  | grep -Ev '\.(test|spec)\.' | head -120 || true)
commit_excerpt=$(git -C "$TERMINAL_REPO" log --oneline --decorate=no "${last:-HEAD~50}..$head" 2>/dev/null | head -60)

prompt_file=$(mktemp)
cat > "$prompt_file" <<EOF
You are the coverage agent for repo $TERMINAL_REPO, working in $wt at $short.
Your complete contract is .agents/coverage.md — read it and honor it.

The suite is already GREEN (verified by this script with \`$suite_cmd\`) and
trunk moved over ${last:-HEAD~50}..$head. Do not re-run the full suite just to
confirm that; run it only to verify tests you write.

Non-test source files changed since the last scan (capped):
$source_touches

Commits (capped):
$commit_excerpt

Previous total coverage: ${prev_pct:-unknown}%

Do this:
1. Run the suite with coverage enabled (per .agents/testing.md) and record the
   total percentage.
2. Find gaps, prioritizing the changed files above — functions with zero
   coverage in files that just changed are the highest-value target.
3. For each gap that is small and has a clear contract, write a REAL test that
   asserts meaningful behavior. Adversarial bar: no tautologies, no asserting
   the implementation's current output back at itself, no over-mocking the unit
   under test. A test that cannot fail is worse than no test — skip the gap and
   file a ticket instead.
4. For big surfaces or unclear contracts, file a ticket via
   \`terminal-cli ticket "<title>" "<body with file:line refs>"\` — do not guess
   at intent in a test.
5. TESTS ONLY. Never modify source under test in the same change (hard rule 1).
   If a real bug surfaces, file a ticket for it.
6. If you wrote tests: commit on this worktree's branch, push, and open a PR
   titled \`test: backfill <N> tests in <area>\`. NEVER merge it — merges are
   human-only.
7. Write the artifact to $report with the frontmatter schema in
   .agents/coverage.md (kind, generated, sha, last_scanned, total_coverage_pct,
   delta_pct, files_below_threshold, new_tests_pr, flakes_detected,
   tickets_filed, status). Write it even when there are zero findings.
8. Record the number: \`terminal-cli state set lastCoveragePct <pct>\`
9. Emit: \`terminal-cli activity check "Coverage · <pct>% · <N> tests" "@ $short"\`
10. Tail-call \`terminal-cli mcp set_run_outcome runId=\$TERMINAL_RUN_ID outcome=<outcome>\`
    with exactly one of the four allowed values: pr-opened | ticket-filed |
    merged | none. Use \`none\` when the run was clean. The morning briefing
    classifies this run from that tag, so it is not optional.

Token discipline: open only the changed files above and their existing tests.
Do not read the whole repo.
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

# Mark regardless of the engine's exit code — same reasoning as drift.sh: the
# report file is the durable record, and re-scanning an identical range on the
# next tick is pure waste.
terminal-cli state mark-main

exit $exit_code
