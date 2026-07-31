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
# state (~/.config/TerMinal). CFFIXED_USER_HOME as well: CoreFoundation's
# NSHomeDirectory() ignores $HOME, so Electron's userData would otherwise still
# land in the real home — which matters when a developer runs this locally.
SMOKE_HOME="$(mktemp -d)"
trap 'rm -rf "$SMOKE_HOME"' EXIT
export HOME="$SMOKE_HOME" CFFIXED_USER_HOME="$SMOKE_HOME"
LOG="$(mktemp)"

"$BIN" >"$LOG" 2>&1 &
PID=$!

# Poll rather than sleeping a fixed interval: pass as soon as a window is up,
# and bail early if the process dies. 45×2s — a window has appeared in ~7s on
# every run so far, so the budget is headroom for a cold runner, not a target.
windows=''
for _ in $(seq 1 45); do
  sleep 2
  kill -0 "$PID" 2>/dev/null || break
  # 2>&1 | tail -1 keeps the probe's own diagnostics instead of discarding
  # them, so a broken toolchain is distinguishable from a windowless app.
  windows="$(swift "$(dirname "$0")/window-count.swift" "$PID" 2>&1 | tail -1)"
  case "$windows" in
    '' | *[!0-9]*) continue ;; # not a count — keep polling; judged below
    0) continue ;;
    *) break ;;
  esac
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
# Judge the probe's OUTPUT, not just its value: a non-numeric result means the
# probe itself failed, and must fail the job rather than pass vacuously — a
# string here would make `[ "$windows" -lt 1 ]` error out and be read as false.
case "$windows" in
  '' | *[!0-9]*)
    echo "::error::window probe produced no count (output: ${windows:-<empty>})"
    fail=1
    ;;
  0)
    echo "::error::the packaged app never opened a window"
    fail=1
    ;;
esac

[ "$fail" = 0 ] && echo "packaged app opened $windows window(s) and stayed up"
exit "$fail"
