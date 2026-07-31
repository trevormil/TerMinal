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

# -i matters more than it looks: the Capitalized org name is the spelling that
# appears in prose (READMEs, ADR context, comments), which is exactly where the
# no-branding rule bites, and CamelCase spellings of a username are a real path
# form. Nothing above may spell either out — with -i the bracket no longer
# protects this file from itself.
if git grep -nIiE "$PATTERN" -- . ':!vendor'; then
  echo "::error::tracked files must not reference a personal machine path or internal program name"
  exit 1
fi

echo "no leaked machine paths in tracked files"
