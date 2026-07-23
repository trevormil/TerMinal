#!/usr/bin/env bash
# Generate the Xcode project with your Apple identifiers filled in.
# Reads ios/.xcodegen.env if present (see .xcodegen.env.example); otherwise
# uses placeholders that build for the Simulator but cannot sign for a device.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .xcodegen.env ] && { set -a; . ./.xcodegen.env; set +a; }
export DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}"
export PRODUCT_BUNDLE_ID="${PRODUCT_BUNDLE_ID:-com.example.terminal}"
export BUNDLE_ID_PREFIX="${BUNDLE_ID_PREFIX:-com.example}"
[ -n "$DEVELOPMENT_TEAM" ] || echo "note: DEVELOPMENT_TEAM unset — Simulator builds only. See .xcodegen.env.example." >&2
exec xcodegen generate
