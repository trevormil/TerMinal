#!/usr/bin/env bash
# Codex Stop hook: file a default-on TerMinal Inbox item when a turn completes.
# Global home (was seeded per-repo as .codex/hooks/stop-notify.sh) — the body
# only needs stdin + $HOME, so one copy serves every repo. Wire it via
# plugin/codex-hooks.json (merge into your Codex hooks config once).

input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')

case "$cwd" in
  */.claude-mem/*|*/.claude-mem) exit 0 ;;
esac

if [ -x "$HOME/.config/TerMinal/bin/terminal-cli" ]; then
  printf '%s' "$input" | "$HOME/.config/TerMinal/bin/terminal-cli" completion-hitl Codex >/dev/null 2>&1 || true
fi

exit 0
