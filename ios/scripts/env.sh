#!/usr/bin/env bash
# Sourced (not executed) by the other ios/scripts. Callers have already cd'd to ios/.
#
# .xcodegen.env and .testflight.env are gitignored, so they exist only in the
# checkout where they were first created — never in a fresh `git worktree`.
# Since this repo's workflow is worktree-based, resolving them from the primary
# checkout is what makes an iOS build from a worktree sign at all; without it
# xcodegen emits a project with an empty DEVELOPMENT_TEAM and the device build
# dies on "Signing for TerMinalRemote requires a development team."

# gt_primary_ios — absolute path to the primary checkout's ios/ dir, or nothing.
gt_primary_ios() {
  local common
  common=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
  # Relative in the primary checkout ("../.git"), absolute in a worktree.
  common=$(cd "$common" 2>/dev/null && pwd) || return 1
  printf '%s\n' "$(dirname "$common")/ios"
}

# gt_env_path <filename> — print a readable path to <filename>, preferring this
# checkout and falling back to the primary one. Returns 1 if neither has it.
gt_env_path() {
  local name="$1" primary
  # ./ prefix matters: `.` with a slash-less argument searches PATH instead.
  [ -f "$name" ] && { printf './%s\n' "$name"; return 0; }
  primary=$(gt_primary_ios) || return 1
  [ -f "$primary/$name" ] || return 1
  printf '%s\n' "$primary/$name"
}

# gt_load_env <filename> — export everything in it. Returns 1 if not found.
gt_load_env() {
  local name="$1" path
  path=$(gt_env_path "$name") || return 1
  [ "$path" = "./$name" ] || echo "note: reading $path (absent from this worktree)" >&2
  set -a
  # shellcheck disable=SC1090
  . "$path"
  set +a
}

# gt_logged <label> <cmd...> — run a noisy build step through a log file. On
# success print only the tail; on failure dump enough to diagnose and propagate
# the real status. Piping straight to `tail` throws the errors away, and without
# `set -o pipefail` it would also report a failed build as a success.
gt_logged() {
  local label="$1" log rc
  shift
  log=$(mktemp -t "gt-${label}") || return 1
  if "$@" >"$log" 2>&1; then
    tail -5 "$log"
    rm -f "$log"
    return 0
  fi
  rc=$?
  echo "==> $label FAILED (exit $rc). Last 100 lines — full log at $log" >&2
  tail -100 "$log" >&2
  return "$rc"
}

# gt_env_missing <filename> — the loud, specific "I looked everywhere" message.
gt_env_missing() {
  local name="$1" primary
  primary=$(gt_primary_ios || true)
  {
    echo
    echo "  ios/$name is missing."
    echo
    echo "  It is gitignored, so it never travels with a branch or a worktree."
    echo "  Checked: $PWD/$name"
    [ -n "$primary" ] && [ "$primary" != "$PWD" ] && echo "           $primary/$name"
    echo
    echo "  Fix it with either:"
    [ -n "$primary" ] && [ "$primary" != "$PWD" ] &&
      echo "      cp '$primary/$name' '$PWD/$name'      # copy from the primary checkout"
    echo "      cp ios/$name.example ios/$name        # start fresh, then fill it in"
    echo
  } >&2
}
