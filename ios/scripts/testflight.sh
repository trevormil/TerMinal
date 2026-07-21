#!/usr/bin/env bash
# Archive TerMinal Remote (Release) and upload the build to TestFlight.
#
#   ./scripts/testflight.sh           # archive + upload at the current build number
#   ./scripts/testflight.sh --bump    # increment CURRENT_PROJECT_VERSION first
#   ./scripts/testflight.sh --dry-run # archive + export only, no upload
#
# Config: ios/.testflight.env (gitignored) — see .testflight.env.example.
set -euo pipefail

cd "$(dirname "$0")/.."

BUMP=0
UPLOAD=1
for arg in "$@"; do
  case "$arg" in
    --bump) BUMP=1 ;;
    --dry-run) UPLOAD=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

[ -f .testflight.env ] || { echo "missing ios/.testflight.env — copy .testflight.env.example and fill it in" >&2; exit 1; }
set -a; . ./.testflight.env; set +a
: "${ASC_KEY_ID:?set in .testflight.env}"
: "${ASC_ISSUER_ID:?set in .testflight.env}"

# Team id lives in project.yml (not a secret) so Xcode and this script agree.
DEVELOPMENT_TEAM=$(sed -n 's/.*DEVELOPMENT_TEAM: "\(.*\)".*/\1/p' project.yml)
[ -n "$DEVELOPMENT_TEAM" ] || { echo "set DEVELOPMENT_TEAM in project.yml" >&2; exit 1; }

KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
[ -f "$KEY_PATH" ] || { echo "missing App Store Connect API key at $KEY_PATH" >&2; exit 1; }

if [ "$BUMP" = 1 ]; then
  current=$(sed -n 's/.*CURRENT_PROJECT_VERSION: "\([0-9]*\)".*/\1/p' project.yml)
  [ -n "$current" ] || { echo "could not read CURRENT_PROJECT_VERSION from project.yml" >&2; exit 1; }
  next=$((current + 1))
  sed -i '' "s/CURRENT_PROJECT_VERSION: \"$current\"/CURRENT_PROJECT_VERSION: \"$next\"/" project.yml
  echo "==> build number $current -> $next"
fi

VERSION=$(sed -n 's/.*MARKETING_VERSION: "\(.*\)".*/\1/p' project.yml)
BUILD=$(sed -n 's/.*CURRENT_PROJECT_VERSION: "\(.*\)".*/\1/p' project.yml)
echo "==> TerMinal Remote $VERSION ($BUILD), team $DEVELOPMENT_TEAM"

echo "==> generating project"
xcodegen generate

echo "==> tests"
xcodebuild -project TerMinalRemote.xcodeproj -scheme TerMinalRemote \
  -destination 'platform=iOS Simulator,name=iPhone 17' test | tail -5

rm -rf build
echo "==> archiving"
xcodebuild -project TerMinalRemote.xcodeproj -scheme TerMinalRemote -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/TerMinalRemote.xcarchive \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  archive

# Generated per-run so DEVELOPMENT_TEAM has exactly one source of truth.
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>$DEVELOPMENT_TEAM</string>
	<key>destination</key>
	<string>$([ "$UPLOAD" = 1 ] && echo upload || echo export)</string>
	<key>uploadSymbols</key>
	<true/>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
PLIST

echo "==> exporting$([ "$UPLOAD" = 1 ] && echo ' + uploading to TestFlight')"
xcodebuild -exportArchive \
  -archivePath build/TerMinalRemote.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

if [ "$UPLOAD" = 1 ]; then
  echo "==> uploaded TerMinal Remote $VERSION ($BUILD). Processing takes ~15-60 min; watch App Store Connect > TestFlight."
else
  echo "==> exported to build/export (no upload)"
fi
