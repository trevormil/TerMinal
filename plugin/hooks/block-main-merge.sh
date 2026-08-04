#!/bin/bash
# PreToolUse hook: block merge/push operations targeting main or master.
# Enforces global CLAUDE.md §8 — no merges to protected branches without
# human approval. Reads tool call JSON from stdin. Exits 2 with stderr to
# deny the tool call.
#
# Shipped globally by the tm plugin. Two escape hatches only: the explicit
# per-command TERMINAL_FORCE_MAIN=1 override, and a machine-local allowlist
# (~/.config/TerMinal/allow-direct-main) for repos that are legitimately
# direct-to-main. Everything else: merge-to-main is human-only.

set -u

input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')

# Only inspect Bash invocations.
[ "$tool" = "Bash" ] || exit 0

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

# Exception: FORCE-MODE agents. TerMinal's emergency-fix / unblock-ci /
# revert-main agents (and a manually-launched `TERMINAL_FORCE_MAIN=1 claude`)
# carry an env-var bypass. The var is set per-spawn by TerMinal's runner and
# is NEVER persisted into the user's shell profile — a normal session never
# sees it. Use only for true production emergencies (CLAUDE.md §8).
if [ "${TERMINAL_FORCE_MAIN:-}" = "1" ]; then
  exit 0
fi

# Same exception, inline form: `TERMINAL_FORCE_MAIN=1 git push origin main`. The
# env check above only sees the hook's OWN environment; an inline assignment
# applies to the command process, not this hook (which runs first), so it must
# be matched in the command text. Echo to stderr so the FORCE use stays visible.
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]&|;(])TERMINAL_FORCE_MAIN=1([[:space:]])'; then
  echo "⚠ FORCE override (TERMINAL_FORCE_MAIN=1): allowing main/master operation — CLAUDE.md §8." >&2
  exit 0
fi

# Exception: machine-local allowlist. Some repos are legitimately direct-to-main
# (e.g. a local-only orchestrator repo with no remote and no human-facing MRs —
# global CLAUDE.md §8's carve-out). The plugin ships to any machine, so those
# paths live in machine config, not here: one absolute repo path per line in
# ~/.config/TerMinal/allow-direct-main. Lines starting with # are comments.
ALLOWLIST="$HOME/.config/TerMinal/allow-direct-main"
if [ -n "$cwd" ] && [ -f "$ALLOWLIST" ]; then
  toplevel=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "")
  if [ -n "$toplevel" ] && grep -qxF "$toplevel" "$ALLOWLIST"; then
    exit 0
  fi
fi

# Matching is deliberately textual and conservative: the pattern fires wherever
# the trigger text appears in the command, including inside quotes or a heredoc
# (writing docs that mention it, grepping for it, echoing instructions). That
# false-positive cost is accepted — a blocked-but-harmless command is
# recoverable, an unnoticed push to a protected branch is not. Do NOT "fix"
# this by narrowing the pattern into a bypass; the message below tells the
# caller how to proceed instead.
block() {
  echo "BLOCKED: $1" >&2
  echo "Rule: no merges or pushes to main/master without human approval (global CLAUDE.md §8)." >&2
  echo "If the human has approved this specific action, run it in a non-Claude terminal." >&2
  echo "If this command does not actually push (the text just appears in a string, doc, or grep), rewrite it so the literal trigger text isn't in the command — e.g. write the file with the Write tool instead of an inline heredoc." >&2
  exit 2
}

# 1. PR/MR merge commands — never allowed from an agent.
echo "$cmd" | grep -qE '(^|[[:space:]&|;])(gh[[:space:]]+pr[[:space:]]+merge|glab[[:space:]]+mr[[:space:]]+merge)\b' \
  && block "PR/MR merge command (gh pr merge / glab mr merge)"

# 2. Pushes that explicitly target main/master as a refspec.
#    Matches: `... main` (end-of-arg), `... master`, `:main`, `:master`, `/main`, `/master`.
echo "$cmd" | grep -qE '\bgit[[:space:]]+push\b.*([[:space:]]|:|/)(main|master)([[:space:]]|$)' \
  && block "git push targeting main/master refspec"

# 3. Pushes that include all branches (would push local main if it exists).
echo "$cmd" | grep -qE '\bgit[[:space:]]+push\b.*(--all|--mirror)\b' \
  && block "git push --all/--mirror could include main/master"

# 4. Bare `git push` (no refspec) while the cwd's current branch is main/master.
#    `git -C` resolves the branch from any subdirectory and in worktrees
#    (where .git is a file, not a directory) — don't gate on a .git dir.
if echo "$cmd" | grep -qE '(^|[[:space:]&|;])git[[:space:]]+push([[:space:]]+(-u|--set-upstream))?[[:space:]]*($|[&|;])'; then
  if [ -n "$cwd" ]; then
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null || echo "")
    case "$branch" in
      main|master) block "bare 'git push' while on $branch" ;;
    esac
  fi
fi

exit 0
