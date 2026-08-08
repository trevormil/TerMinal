#!/usr/bin/env bash
# bootstrap.sh — inject this workflow into an EXISTING repo.
#
#   ./bootstrap.sh /path/to/target-repo
#
# Seeds only what is genuinely REPO-OWNED: CI, the docs skeleton, CLAUDE.md,
# PR/MR templates, .editorconfig, and .gitignore entries.
#
# Everything else is global now and is NOT copied:
#   - skills/hooks/bin  → the tm plugin (~/.config/TerMinal/plugin, installed
#     by the TerMinal app; ~/.claude/skills/tm for Claude, ~/.codex/skills/tm-*
#     for Codex)
#   - default script agents (health, drift, coverage, …) → seeded once into
#     ~/.config/TerMinal/scripts by the plugin install
#   - workflow state (tickets, sessions, reviews) → the per-project sidecar
#   - forge selection → auto-detected from origin (override via $FORGE or the
#     sidecar `forge` file)
#
# This script also REMOVES the per-repo copies that OLDER bootstraps installed.
# Your data and existing docs are never clobbered; anything that would clobber
# an existing file is written alongside as `<name>.workflow` to merge by hand.
#
# For a brand-new repo, prefer `gh repo create --template <this-template>`
# instead — this script is for retrofitting a repo that already exists.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DST="${1:-}"

[ -n "$DST" ] || { echo "usage: $0 /path/to/target-repo" >&2; exit 1; }
[ -d "$DST" ] || { echo "error: target '$DST' is not a directory" >&2; exit 1; }
DST="$(cd "$DST" && pwd)"
[ "$SRC" != "$DST" ] || { echo "error: target is the template itself" >&2; exit 1; }
[ -d "$DST/.git" ] || echo "warning: '$DST' is not a git repo (run 'git init' there)" >&2

say() { printf '  %s\n' "$1"; }

echo "Bootstrapping workflow into: $DST"

# --- workflow data (overwrite — this is the workflow) ------------------------
echo "[workflow] CI"
mkdir -p "$DST/.github/workflows"
cp "$SRC/.github/workflows/ci.yml" "$DST/.github/workflows/ci.yml"
say ".github/workflows/ci.yml installed"

# The global Codex skills are synced by the app, not by this script. Warn when
# they are absent, otherwise a Codex agent in this repo silently has no skills
# — the failure mode is a missing capability, which reads as the model being
# unhelpful rather than as a setup problem.
if [ ! -d "$HOME/.codex/skills" ] || ! ls -d "$HOME"/.codex/skills/tm-* >/dev/null 2>&1; then
  say "NOTE: no ~/.codex/skills/tm-* found — launch TerMinal once (Settings → Updates → Sync) to install the global skills for Codex"
fi

# --- migrate: remove Claude machinery older bootstraps copied in -------------
# Name-scoped, and MOVED to a backup rather than deleted — a repo-authored
# skill that happens to share a name (e.g. its own `document`) is recoverable.
# `notify` is intentionally NOT in the list: it is personal machinery excluded
# from the plugin, so an existing per-repo copy keeps working.
echo "[migrate] per-repo skills (Claude + Codex) → tm plugin"
migrated=0
BACKUP="$DST/.claude/pre-tm-backup"
migrate() { # <harness-root-relative path>, e.g. .claude/skills/ticket
  local src="$DST/$1"
  [ -e "$src" ] || return 0
  # NEVER clobber an earlier run's backup: run 1 may have banked a
  # hand-customized copy, `git checkout` restored the vanilla one, and run 2
  # would silently replace the customization with vanilla. Bank the newcomer
  # under a numbered name instead.
  local dest="$BACKUP/$1"
  if [ -e "$dest" ]; then
    local n=1
    while [ -e "$dest.$n" ]; do n=$((n + 1)); done
    dest="$dest.$n"
  fi
  mkdir -p "$(dirname "$dest")"
  mv "$src" "$dest"
  migrated=1
}
# The skill set the plugin now owns. `notify` is intentionally absent: it is
# personal machinery excluded from the plugin, so a per-repo copy keeps working.
TM_SKILLS="check code-review digest document document-audit emergency-fix
           enqueue-request factory knowledge knowledge-rag listener-inbox
           loop-driver loop-evaluator loop-implementer loop-planner merge-sync
           migrate-agents new-agent new-inbox-source new-knowledge
           new-persistent-agent new-schedule new-snippet pr-creation
           remote-terminal revert-main security-scan session-end session-start
           stacked-mr terminal-widget test-suite ticket unblock-ci vibe"
for s in $TM_SKILLS; do
  migrate ".claude/skills/$s"
  # Same skills, Codex mirror — retired now that the app syncs them globally
  # as ~/.codex/skills/tm-*.
  migrate ".codex/skills/$s"
done
for b in activity chunk-diff code-review-preflight compute-verdict \
         findings-merge forge hitl list-agents merge-digest merge-sync \
         request-agent-artifact status; do
  migrate ".claude/bin/$b"
done
for h in block-main-merge.sh remote-check.sh stop-notify.sh; do
  migrate ".claude/hooks/$h"
done
# Codex stop hook: retired as a per-repo seed (the hook body ships with the
# plugin). hooks.workflow.json was only ever a merge-by-hand seed artifact.
migrate ".codex/hooks/stop-notify.sh"
migrate ".codex/hooks.workflow.json"
# Forge selector: origin autodetect covers it now ($FORGE / sidecar override).
migrate ".claude/forge"
rmdir "$DST/.claude/skills" "$DST/.claude/bin" "$DST/.claude/hooks" \
      "$DST/.codex/skills" "$DST/.codex/hooks" "$DST/.codex" 2>/dev/null || true
# Drop settings.json hook entries that point at the removed scripts. If this
# can't run (no python3 / unparseable settings.json), warn — otherwise every
# tool call in the repo exits 127 on the missing hook until fixed by hand.
if [ -f "$DST/.claude/settings.json" ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$DST/.claude/settings.json" <<'PY' || say "WARNING: could not rewrite .claude/settings.json — remove hook entries pointing at .claude/hooks/*.sh by hand"
import json, sys
p = sys.argv[1]
d = json.load(open(p))
gone = ('.claude/hooks/block-main-merge.sh', '.claude/hooks/remote-check.sh',
        '.claude/hooks/stop-notify.sh')
hooks = d.get('hooks')
changed = False
if isinstance(hooks, dict):
    for ev in list(hooks):
        matchers = hooks[ev]
        if not isinstance(matchers, list):
            continue
        for m in matchers:
            kept = [h for h in m.get('hooks', [])
                    if not any(g in str(h.get('command', '')) for g in gone)]
            if len(kept) != len(m.get('hooks', [])):
                m['hooks'] = kept
                changed = True
        hooks[ev] = [m for m in matchers if m.get('hooks')]
        if not hooks[ev]:
            del hooks[ev]
            changed = True
    if not hooks:
        d.pop('hooks', None)
if changed:
    open(p, 'w').write(json.dumps(d, indent=2) + '\n')
PY
  else
    say "WARNING: python3 not found — remove settings.json hook entries pointing at .claude/hooks/*.sh by hand"
  fi
fi
# --- migrate: drop agent contracts identical to the shipped default ---------
# Contracts resolve repo-first against the plugin now, so an untouched copy is
# pure duplication that will silently go stale. A CUSTOMIZED contract is this
# repo's own decision and must survive, so compare content and remove only
# exact matches — never a heuristic, never a timestamp.
PLUGIN_AGENTS="${TERMINAL_CONFIG_DIR:-$HOME/.config/TerMinal}/plugin/agents"
if [ -d "$PLUGIN_AGENTS" ] && [ -d "$DST/.agents" ]; then
  dropped=0
  kept=0
  for f in "$DST"/.agents/*.md; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    if [ -f "$PLUGIN_AGENTS/$base" ] && cmp -s "$f" "$PLUGIN_AGENTS/$base"; then
      rm "$f"
      dropped=$((dropped + 1))
    elif [ -f "$PLUGIN_AGENTS/$base" ]; then
      kept=$((kept + 1))
    fi
  done
  [ "$dropped" -gt 0 ] && say "removed $dropped unmodified agent contract(s) — now served by the plugin"
  [ "$kept" -gt 0 ] && say "kept $kept customized agent contract(s) — these override the plugin default"
  [ "$dropped" = 0 ] && [ "$kept" = 0 ] && say "no per-repo agent contracts to reconcile"
fi

# --- migrate: drop seeded script agents identical to the plugin default ------
# Same rule as contracts: the default bodies (health.sh, drift.sh, …) are
# global now (seeded once into ~/.config/TerMinal/scripts). An untouched
# per-repo copy is duplication; a customized one is this repo's own agent.
PLUGIN_SCRIPTS="${TERMINAL_CONFIG_DIR:-$HOME/.config/TerMinal}/plugin/scripts"
if [ -d "$PLUGIN_SCRIPTS" ] && [ -d "$DST/.agents" ]; then
  sdropped=0
  for f in "$DST"/.agents/*.sh "$DST"/.agents/*.json; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    if [ -f "$PLUGIN_SCRIPTS/$base" ] && cmp -s "$f" "$PLUGIN_SCRIPTS/$base"; then
      rm "$f"
      sdropped=$((sdropped + 1))
    fi
  done
  [ "$sdropped" -gt 0 ] && say "removed $sdropped unmodified default script agent file(s) — global now"
  rmdir "$DST/.agents" 2>/dev/null || true
fi

[ "$migrated" = 1 ] && say "moved old per-repo skills/bin/hooks (.claude + .codex) to .claude/pre-tm-backup/ (now served by the tm plugin; delete the backup once confirmed)" \
                   || say "no legacy per-repo skill copies found"

# editor config + PR/MR templates — don't clobber existing project ones
[ -f "$DST/.editorconfig" ] || cp "$SRC/.editorconfig" "$DST/.editorconfig"
mkdir -p "$DST/.github" "$DST/.gitlab/merge_request_templates"
[ -f "$DST/.github/PULL_REQUEST_TEMPLATE.md" ] || \
  cp "$SRC/.github/PULL_REQUEST_TEMPLATE.md" "$DST/.github/PULL_REQUEST_TEMPLATE.md"
[ -f "$DST/.gitlab/merge_request_templates/Default.md" ] || \
  cp "$SRC/.gitlab/merge_request_templates/Default.md" "$DST/.gitlab/merge_request_templates/Default.md"
say ".editorconfig + PR/MR templates seeded (existing left untouched)"

# .claude/settings.json is no longer seeded: the main-merge gate and stop
# hooks are plugin-served globally, and the deny list belongs in the user's
# own ~/.claude/settings.json. An existing repo copy is left untouched.
# Workflow state (tickets, sessions, reviews, checks, reports) lives in the
# per-project sidecar — nothing to scaffold in the repo, and no layout marker:
# a clean repo IS the v2 layout (v1 is detected from its root state dirs).

# --- docs skeleton (seed only if absent) -------------------------------------
echo "[docs] docs/{decisions,runbooks,learnings} + architecture.md"
mkdir -p "$DST/docs/decisions" "$DST/docs/runbooks" "$DST/docs/learnings"
[ -f "$DST/docs/architecture.md" ] || cp "$SRC/docs/architecture.md" "$DST/docs/architecture.md"
[ -f "$DST/docs/decisions/0001-record-architecture-decisions.md" ] || \
  cp "$SRC/docs/decisions/0001-record-architecture-decisions.md" "$DST/docs/decisions/"
[ -f "$DST/docs/runbooks/README.md" ]  || cp "$SRC/docs/runbooks/README.md"  "$DST/docs/runbooks/README.md"
[ -f "$DST/docs/runbooks/branch-protection.md" ] || \
  cp "$SRC/docs/runbooks/branch-protection.md" "$DST/docs/runbooks/branch-protection.md"
[ -f "$DST/docs/learnings/README.md" ] || cp "$SRC/docs/learnings/README.md" "$DST/docs/learnings/README.md"
# CLAUDE.md links docs/workflow/{agent-process,inbox}.md — a retrofitted repo
# without them sends every agent to a dead path on its first contract lookup.
mkdir -p "$DST/docs/workflow"
[ -f "$DST/docs/workflow/agent-process.md" ] || \
  cp "$SRC/docs/workflow/agent-process.md" "$DST/docs/workflow/agent-process.md"
[ -f "$DST/docs/workflow/inbox.md" ] || \
  cp "$SRC/docs/workflow/inbox.md" "$DST/docs/workflow/inbox.md"
say "docs skeleton seeded (existing docs left untouched)"

# --- CLAUDE.md — don't clobber ------------------------------------------------
if [ -f "$DST/CLAUDE.md" ]; then
  cp "$SRC/CLAUDE.md" "$DST/CLAUDE.workflow.md"
  say "CLAUDE.md EXISTS → wrote CLAUDE.workflow.md (merge the 'How we work' + conventions sections by hand)"
else
  cp "$SRC/CLAUDE.md" "$DST/CLAUDE.md"
  say "CLAUDE.md installed (fill in the project-specific placeholders)"
fi

# --- .gitignore — append our entries if missing ------------------------------
echo "[gitignore] appending workflow entries if missing"
touch "$DST/.gitignore"
# Personal workflow state lives in the per-project sidecar now. Ignore the
# in-repo dirs too, so a repo that still carries state (or acquires it from an
# older tool) can never commit tickets/reviews into a shared checkout.
state_lines=(
  ".TerMinal/backlog/" ".TerMinal/sessions/" ".TerMinal/reviews/"
  ".TerMinal/checks/" ".TerMinal/reports/" ".TerMinal/notes.md"
  "/backlog/" "/sessions/" "/.reviews/" "/.checks/" "/reports/"
)
ignore_lines=("${state_lines[@]}" ".status.md" ".claude/pre-tm-backup/")
for line in "${ignore_lines[@]}"; do
  grep -qxF "$line" "$DST/.gitignore" || printf '%s\n' "$line" >> "$DST/.gitignore"
done
say ".gitignore state + workflow entries ensured"

cat <<EOF

Done. Next steps in $DST:
  1. Fill the placeholders in CLAUDE.md (or merge CLAUDE.workflow.md if present).
  2. Adapt .github/workflows/ci.yml scripts to your project.
  3. Commit the scaffold on a feature branch (never main — global §8).
  4. Start working: /tm:session-start "<goal>"  →  /tm:ticket  →  /tm:pr-creation  →  code-review agent
EOF
