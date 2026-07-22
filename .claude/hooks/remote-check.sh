#!/usr/bin/env bash
# Stop hook — the always-on listener for TerMinal Remote.
#
# Runs when the agent is about to end its turn. If the phone sent something
# while it was working, this blocks the stop and hands the message over, so a
# reply is picked up automatically rather than depending on the agent
# remembering to poll.
#
# Silent and exit 0 in any session that never registered, which is most of them.
set -uo pipefail

INPUT=$(cat)

# Claude Code sets stop_hook_active when it is already re-running because of a
# previous block. Bailing here is what stops an infinite turn loop.
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Prefer the repo's copy: the installed one under ~/.config/TerMinal/bin is
# synced at release time, so during development it can predate `remote` and
# would fail silently.
for candidate in \
  "${CLAUDE_PROJECT_DIR:-$PWD}/bin/terminal-cli" \
  "$(command -v terminal-cli 2>/dev/null || true)" \
  "$HOME/.config/TerMinal/bin/terminal-cli"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" remote list >/dev/null 2>&1; then
    CLI="$candidate"
    break
  fi
done
# No CLI that understands `remote` — nothing to listen with.
[ -n "${CLI:-}" ] || exit 0

# --cwd scopes the lookup to a session registered from this directory, so with
# several registrations the wrong session's replies never get delivered here.
REPLIES=$("$CLI" remote check --quiet --cwd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || true)
[ -n "$REPLIES" ] || exit 0

# Block the stop and feed the message back as the reason, which Claude Code
# surfaces to the model as new input.
python3 - "$REPLIES" <<'PY'
import json, sys
replies = sys.argv[1]
print(json.dumps({
    "decision": "block",
    "reason": "Message from your phone via TerMinal Remote — treat this as a new instruction "
              "from the human and continue:\n\n" + replies,
}))
PY
