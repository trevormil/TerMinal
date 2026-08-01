#!/usr/bin/env bash
# ux-taste — tier 2 of the UX suite. Thin wrapper so the taste pass is
# schedulable from the Schedules tab; all the work is in scripts/ux-taste.ts.
#
# Deliberately NOT a gate and NOT per-PR: it is non-deterministic and costs
# money per run. It always exits 0 — read the artifact it writes.
#
# Runner env (set by TerMinal): TERMINAL_REPO, TERMINAL_ENGINE, TERMINAL_RUN_ID.
set -uo pipefail

cd "${TERMINAL_REPO:-$PWD}" || exit 0
ENGINE="${TERMINAL_ENGINE:-codex}"

# The suite launches out/main/index.js, so the bundle has to be current.
bun install --frozen-lockfile >/dev/null 2>&1
bun run build >/dev/null || { echo "ux-taste: build failed — nothing to screenshot"; exit 0; }

bun scripts/ux-taste.ts --engine="$ENGINE"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
REPORT=".TerMinal/reports/ux-taste/${SHA}.md"
if [ -f "$REPORT" ]; then
  echo "ux-taste: wrote $REPORT"
  command -v terminal-cli >/dev/null 2>&1 && \
    terminal-cli activity "UX taste pass · $(grep -m1 '^findings:' "$REPORT" | tr -d ' ') findings" "@ $SHA" || true
else
  echo "ux-taste: no report produced"
fi
exit 0
