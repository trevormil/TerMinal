#!/usr/bin/env bash
# Launch the packaged TerMinal.app and assert it actually opens a window.
#
# This is the automated version of the manual check CLAUDE.md mandates: the main
# process bundles to ESM, so `__dirname` / `require` throw at runtime and the app
# dies before painting. That failure is invisible to typecheck, tests and the
# bundler — only launching the packaged binary catches it.
#
# Deliberately no `set -e`: every assertion is collected so the log shows all of
# them, and the exit code is decided at the end.
set -uo pipefail

APP="$(/usr/bin/find dist -maxdepth 3 -name 'TerMinal.app' -print -quit)"
if [ -z "$APP" ]; then
  echo "::error::no TerMinal.app found under dist/ — packaging produced nothing to smoke-test"
  exit 1
fi
BIN="$APP/Contents/MacOS/TerMinal"
echo "smoke-testing $BIN"

# Point the app at a throwaway HOME so it can never read or write real user
# state (~/.config/TerMinal). Also keeps the run reproducible.
HOME="$(mktemp -d)"
export HOME
LOG="$(mktemp)"

"$BIN" >"$LOG" 2>&1 &
PID=$!

# Poll rather than sleeping a fixed interval: pass as soon as a window is up,
# and bail early if the process dies.
windows=0
for _ in $(seq 1 30); do
  sleep 2
  kill -0 "$PID" 2>/dev/null || break
  windows="$(swift "$(dirname "$0")/window-count.swift" "$PID" 2>/dev/null || echo 0)"
  [ "${windows:-0}" -gt 0 ] && break
done

alive=0
kill -0 "$PID" 2>/dev/null && alive=1
kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null

echo "--- packaged app output ---"
cat "$LOG"
echo "--- end of output ---"

fail=0
if [ "$alive" != 1 ]; then
  echo "::error::the packaged app exited on its own during the smoke window"
  fail=1
fi
if grep -qE 'ReferenceError|is not defined|Cannot find module|ERR_MODULE_NOT_FOUND' "$LOG"; then
  echo "::error::packaged app output contains a fatal module/reference error"
  fail=1
fi
if [ "${windows:-0}" -lt 1 ]; then
  echo "::error::the packaged app never opened a window"
  fail=1
fi

[ "$fail" = 0 ] && echo "packaged app opened $windows window(s) and stayed up"
exit "$fail"
