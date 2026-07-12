#!/usr/bin/env bash
# Build the TerMinal agent image (ADR-0002 #13) from a MINIMAL context — just the
# runner + Dockerfile — so the whole repo isn't shipped to the Docker daemon.
#
# Usage:
#   docker/build-agent-image.sh [tag] [runner-path]
#     tag          image tag (default terminal-agent:latest)
#     runner-path  path to bin/terminal-cron (default: repo bin/terminal-cron)
#
# On a remote host, run this after the runner has been installed (see #12); it can
# also `k3s ctr images import` the result for the CronJob path (#16).
set -euo pipefail

TAG="${1:-terminal-agent:latest}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUNNER="${2:-$HERE/../bin/terminal-cron}"

if [ ! -f "$RUNNER" ]; then
  echo "runner not found: $RUNNER" >&2
  exit 1
fi

# Build context MUST live under $HOME in a NON-hidden dir: snap-packaged Docker
# (Ubuntu's default) is confined by the snap `home` interface — it cannot read
# /tmp (→ "unable to prepare context: path not found") NOR hidden dotfiles/dirs in
# $HOME (→ an empty/2B context). So: $HOME + a visible name.
CTX="$(mktemp -d "${HOME}/terminal-agent-build.XXXXXX")"
trap 'rm -rf "$CTX"' EXIT
cp "$RUNNER" "$CTX/terminal-cron"
cp "$HERE/terminal-agent.Dockerfile" "$CTX/Dockerfile"

echo "building $TAG from $RUNNER …"
docker build -t "$TAG" "$CTX"
echo "built $TAG"
