#!/usr/bin/env bash
# Tracked files must not carry a personal machine path or an internal program
# name — this repo is public, and a fixture with someone's real home directory
# in it leaks and dates instantly. Placeholder homes (/Users/you, /Users/x,
# /Users/example) are fine and used deliberately in tests.
#
# The [b]racket in each pattern is what keeps this file from matching itself;
# it is a no-op to the regex engine. vendor/ is a third-party checkout we do
# not control.
set -uo pipefail

PATTERN='g[a]untlet|/Users/[t]revormiller'

if git grep -nIE "$PATTERN" -- . ':!vendor'; then
  echo "::error::tracked files must not reference a personal machine path or internal program name"
  exit 1
fi

echo "no leaked machine paths in tracked files"
