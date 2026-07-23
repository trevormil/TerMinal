#!/usr/bin/env bash
# Stop hook — the always-on listener for TerMinal Remote.
#
# Runs when the agent is about to end its turn. For a registered remote session
# it BLOCKS here, parking the turn until the phone sends the next instruction —
# so the conversation never dies just because the agent finished a task and
# stopped. When a message arrives it blocks the stop and hands it over; when the
# session is ended (from the phone/app) or nothing comes for a long while, it
# lets the turn stop.
#
# This is the enforcement mechanism: it does NOT depend on the agent remembering
# to poll. The blocking wait lives in `terminal-cli remote check --wait`.
#
# Silent and exit 0 in any session that never registered, which is most of them.
set -uo pipefail

INPUT=$(cat)

# How long to park waiting for the next phone message before the heartbeat
# re-park. Kept just under the Stop-hook timeout in settings.json so the CLI
# exits cleanly rather than being killed. Override with the env var. Floored at
# 60s so a misconfigured tiny value can't turn the heartbeat into a turn storm.
WAIT_TIMEOUT="${TERMINAL_REMOTE_WAIT_TIMEOUT:-3540}"
if ! [ "$WAIT_TIMEOUT" -ge 60 ] 2>/dev/null; then WAIT_TIMEOUT=3540; fi

# Prefer the repo's copy, then one on PATH, then the installed one. The installed
# copy under ~/.config/TerMinal/bin is synced at release, so in a repo whose bin/
# predates `remote` we fall through to it.
CLI=""
for candidate in \
  "${CLAUDE_PROJECT_DIR:-$PWD}/bin/terminal-cli" \
  "$(command -v terminal-cli 2>/dev/null || true)" \
  "$HOME/.config/TerMinal/bin/terminal-cli"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" remote list >/dev/null 2>&1; then
    CLI="$candidate"
    break
  fi
done
[ -n "${CLI:-}" ] || exit 0

# This session's precise identity — the engine-agnostic routing key stored at
# register time — so a reply can never reach a different session in the same
# repo. --cwd is only a fallback for a session registered before the id existed.
SESSION_ID=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null || true)

# The repo AND the global settings.json both register this hook, so on a repo
# that has it, two copies fire at once. A PID lock keyed on the session lets only
# one park; the other returns immediately (allowing the stop) instead of both
# blocking and one stalling the turn for the full timeout. Reclaimed if the
# previous waiter was killed (Claude Code hook timeout) without cleaning up.
LOCK="${TMPDIR:-/tmp}/tm-remote-wait.${SESSION_ID:-$$}.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  OLDPID=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    exit 0
  fi
  rm -rf "$LOCK" 2>/dev/null || true
  mkdir "$LOCK" 2>/dev/null || exit 0
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK" 2>/dev/null || true' EXIT

# Park until the phone sends something, the session ends, or the wait times out.
# No stop_hook_active guard on purpose: after a message is delivered and the
# agent acts, we WANT to park again for the next one. This never busy-loops — it
# blocks inside the CLI and only returns when there is real news.
#
# Exit codes from `remote check --wait`:
#   0 + output → a phone message; block and hand it over
#   0 + no output → session ended (or none) → allow the stop
#   3 → timed out with nothing new → re-park with a heartbeat so the SESSION
#       never dies even though a single hook run is capped by the Stop-hook
#       timeout. The turn ends and this hook immediately fires again.
REPLIES=$("$CLI" remote check --wait --quiet \
  --timeout "$WAIT_TIMEOUT" \
  --agent-session "$SESSION_ID" \
  --cwd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null)
RC=$?

if [ -n "$REPLIES" ]; then
  # Block the stop and feed the message back as the reason.
  python3 - "$REPLIES" <<'PY'
import json, sys
replies = sys.argv[1]
print(json.dumps({
    "decision": "block",
    "reason": "Message from your phone via TerMinal Remote — treat this as a new instruction "
              "from the human and continue. When you finish, just stop; this session stays "
              "live and you'll be handed the next message automatically:\n\n" + replies,
}))
PY
elif [ "$RC" = "3" ]; then
  # Heartbeat: no message this window. End the turn silently so the hook re-fires
  # and parks again — the session stays alive indefinitely. Keep the agent inert.
  python3 - <<'PY'
import json
print(json.dumps({
    "decision": "block",
    "reason": "TerMinal Remote heartbeat — no new message from the phone. Do NOT take any "
              "action and do NOT run any command. Immediately end your turn with a brief "
              "acknowledgement. The session stays live; the next phone message will be handed "
              "to you automatically when it arrives.",
}))
PY
else
  exit 0
fi
