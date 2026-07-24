#!/usr/bin/env bash
# Live end-to-end: the real iOS app against the real bridge.
#
#   ./scripts/e2e-app.sh [simulator-name]
#
# Boots a simulator, starts the bridge harness against a real pty, puts the
# pairing code on the simulator pasteboard, and runs the UI test that pairs and
# opens a session. This is the check that catches what offline unit tests
# cannot: ATS blocking the connection, a certificate-pinning mismatch, or SSE
# frames the client can't parse.
set -euo pipefail

cd "$(dirname "$0")/.."
SIM="${1:-iPhone 17}"
REPO_ROOT="$(cd .. && pwd)"

# Apple identifiers come from ios/.xcodegen.env (gitignored), same as
# generate.sh; without it, the fork-safe placeholder bundle id is used.
[ -f .xcodegen.env ] && { set -a; . ./.xcodegen.env; set +a; }
PRODUCT_BUNDLE_ID="${PRODUCT_BUNDLE_ID:-com.example.terminal}"

cleanup() {
  [ -n "${HARNESS_PID:-}" ] && kill "$HARNESS_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> booting $SIM"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" >/dev/null 2>&1 || true

# A previous run leaves the app paired. The pairing lives in the Keychain, which
# simctl uninstall does NOT clear — so reset that too, or the test launches
# straight into the session list and never sees the pairing screen.
echo "==> removing any previous install + pairing"
xcrun simctl uninstall "$SIM" "$PRODUCT_BUNDLE_ID" 2>/dev/null || true
xcrun simctl keychain "$SIM" reset 2>/dev/null || true

echo "==> starting the bridge harness"
PAIRING_LOG=$(mktemp)
(cd "$REPO_ROOT" && bun ios/scripts/e2e-bridge.ts >"$PAIRING_LOG" 2>&1) &
HARNESS_PID=$!

for _ in $(seq 1 40); do
  PAIRING=$(grep -m1 '^{"v":1' "$PAIRING_LOG" 2>/dev/null || true)
  [ -n "$PAIRING" ] && break
  sleep 0.25
done
[ -n "${PAIRING:-}" ] || { echo "harness never printed a pairing code:" >&2; cat "$PAIRING_LOG" >&2; exit 1; }
echo "==> harness up on $(echo "$PAIRING" | sed 's/.*"p":\([0-9]*\).*/port \1/')"

printf '%s' "$PAIRING" | xcrun simctl pbcopy "$SIM"

echo "==> running the live pairing test"
"$(dirname "$0")/generate.sh"
xcodebuild -project TerMinalRemote.xcodeproj -scheme TerMinalRemoteLive \
  -destination "platform=iOS Simulator,name=$SIM" test 2>&1 | tail -30
