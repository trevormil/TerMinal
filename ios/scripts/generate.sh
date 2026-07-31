#!/usr/bin/env bash
# Generate the Xcode project with your Apple identifiers filled in.
# Reads ios/.xcodegen.env — from this checkout, or from the primary checkout
# when run in a worktree (it is gitignored; see env.sh). Without it, uses
# placeholders that build for the Simulator but cannot sign for a device.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/env.sh
gt_load_env .xcodegen.env || true
export DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}"
export PRODUCT_BUNDLE_ID="${PRODUCT_BUNDLE_ID:-com.example.terminal}"
export BUNDLE_ID_PREFIX="${BUNDLE_ID_PREFIX:-com.example}"
# Not fatal: a fork with no Apple account still gets a Simulator-only project.
if [ -z "$DEVELOPMENT_TEAM" ]; then
  echo "warning: DEVELOPMENT_TEAM is unset — the generated project builds for the" >&2
  echo "         Simulator but CANNOT sign for a device." >&2
  gt_env_missing .xcodegen.env
fi
exec xcodegen generate
