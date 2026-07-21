#!/usr/bin/env bash
# Install an APNs auth key so the Mac can push to TerMinal Remote.
#
#   ./scripts/setup-push.sh ~/Downloads/AuthKey_ABC1234567.p8
#
# There is no API for minting APNs keys, so the key itself comes from the Apple
# developer portal: Certificates, Identifiers & Profiles → Keys → + → enable
# "Apple Push Notifications service (APNs)". The .p8 downloads exactly once.
#
# This script only files it where the bridge looks, and writes the small config
# that names the key. Nothing here talks to Apple.
set -euo pipefail

KEY_SRC="${1:-}"
[ -n "$KEY_SRC" ] || { echo "usage: $0 <path to AuthKey_XXXXXXXXXX.p8>" >&2; exit 2; }
[ -f "$KEY_SRC" ] || { echo "no such file: $KEY_SRC" >&2; exit 1; }

# The key id is embedded in Apple's filename: AuthKey_<KEYID>.p8
KEY_ID=$(basename "$KEY_SRC" | sed -n 's/^AuthKey_\([A-Z0-9]*\)\.p8$/\1/p')
[ -n "$KEY_ID" ] || { echo "expected a file named AuthKey_<KEYID>.p8" >&2; exit 1; }

cd "$(dirname "$0")/.."
TEAM_ID=$(sed -n "s/.*DEVELOPMENT_TEAM: ['\"]\(.*\)['\"].*/\1/p" project.yml)
BUNDLE_ID=$(sed -n 's/.*PRODUCT_BUNDLE_IDENTIFIER: \(.*\)$/\1/p' project.yml | head -1 | tr -d "'\" ")
[ -n "$TEAM_ID" ] || { echo "could not read DEVELOPMENT_TEAM from project.yml" >&2; exit 1; }
[ -n "$BUNDLE_ID" ] || { echo "could not read PRODUCT_BUNDLE_IDENTIFIER from project.yml" >&2; exit 1; }

DIR="$HOME/.config/TerMinal/bridge"
mkdir -p "$DIR"
chmod 700 "$DIR"

cp "$KEY_SRC" "$DIR/apns.p8"
chmod 600 "$DIR/apns.p8"

cat > "$DIR/apns.json" <<JSON
{
  "keyId": "$KEY_ID",
  "teamId": "$TEAM_ID",
  "bundleId": "$BUNDLE_ID"
}
JSON
chmod 600 "$DIR/apns.json"

echo "==> APNs key installed"
echo "    key id    $KEY_ID"
echo "    team      $TEAM_ID"
echo "    bundle    $BUNDLE_ID"
echo "    location  $DIR"
echo
echo "Restart TerMinal, then open the app on your phone once so it registers"
echo "its device token. Settings → Mobile will then show the device count."
