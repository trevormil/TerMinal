#!/usr/bin/env bash
# bootstrap.sh — inject this workflow into an EXISTING repo.
#
#   ./bootstrap.sh /path/to/target-repo
#
# Seeds repo DATA only: .agents contracts, CI, docs skeleton, the Codex stop
# hook, and TerMinal project state scaffolds.
#
# NO skills are copied, for either harness — they ship globally via the tm
# plugin (installed by the TerMinal app at ~/.config/TerMinal/plugin, exposed as
# ~/.claude/skills/tm for Claude and ~/.codex/skills/tm-* for Codex). This
# script also removes the per-repo skill copies that OLDER bootstraps installed,
# for both harnesses. Workflow files are overwritten (they ARE the workflow);
# your data and existing docs are never clobbered. Anything that would clobber
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

if [ -f "$DST/.TerMinal/template.json" ]; then
  LAYOUT="v2"
elif [ -d "$DST/backlog" ] || [ -d "$DST/sessions" ] || [ -d "$DST/.reviews" ] || [ -d "$DST/.checks" ] || [ -d "$DST/reports" ]; then
  LAYOUT="v1"
else
  LAYOUT="v2"
fi
say "project-template layout: $LAYOUT"

# --- workflow data (overwrite — this is the workflow) ------------------------
# Skills for BOTH harnesses are global (tm plugin). What stays per-repo is what
# is genuinely repo-specific: the agent contracts, CI, and the Codex stop hook
# (Codex resolves hooks from the project dir, so that one has no global home).
echo "[workflow] .agents/ + CI + Codex stop hook"
mkdir -p "$DST/.claude" "$DST/.codex" "$DST/.agents" "$DST/.github/workflows"
cp -R "$SRC/.codex/hooks"   "$DST/.codex/"
cp "$SRC/.codex/hooks.json" "$DST/.codex/hooks.workflow.json"
cp "$SRC"/.agents/*.md "$DST/.agents/"
cp "$SRC/.github/workflows/ci.yml" "$DST/.github/workflows/ci.yml"
chmod +x "$DST/.codex/hooks/"*.sh 2>/dev/null || true
say ".codex/hooks, .codex/hooks.workflow.json, .agents, .github/workflows/ci.yml installed"

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
  mkdir -p "$BACKUP/$(dirname "$1")"
  rm -rf "${BACKUP:?}/$1"
  mv "$src" "$BACKUP/$1"
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
rmdir "$DST/.claude/skills" "$DST/.claude/bin" "$DST/.claude/hooks" \
      "$DST/.codex/skills" 2>/dev/null || true
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
[ "$migrated" = 1 ] && say "moved old per-repo skills/bin/hooks (.claude + .codex) to .claude/pre-tm-backup/ (now served by the tm plugin; delete the backup once confirmed)" \
                   || say "no legacy per-repo skill copies found"

# forge selector — don't clobber an existing choice
[ -f "$DST/.claude/forge" ] || cp "$SRC/.claude/forge" "$DST/.claude/forge"
say "forge selector: $(cat "$DST/.claude/forge") (edit .claude/forge to switch github/gitlab)"

# editor config + PR/MR templates — don't clobber existing project ones
[ -f "$DST/.editorconfig" ] || cp "$SRC/.editorconfig" "$DST/.editorconfig"
mkdir -p "$DST/.github" "$DST/.gitlab/merge_request_templates"
[ -f "$DST/.github/PULL_REQUEST_TEMPLATE.md" ] || \
  cp "$SRC/.github/PULL_REQUEST_TEMPLATE.md" "$DST/.github/PULL_REQUEST_TEMPLATE.md"
[ -f "$DST/.gitlab/merge_request_templates/Default.md" ] || \
  cp "$SRC/.gitlab/merge_request_templates/Default.md" "$DST/.gitlab/merge_request_templates/Default.md"
say ".editorconfig + PR/MR templates seeded (existing left untouched)"

# settings.json — don't clobber an existing one (and don't churn a
# .workflow copy when the existing file already matches the template)
if [ -f "$DST/.claude/settings.json" ]; then
  if cmp -s "$SRC/.claude/settings.json" "$DST/.claude/settings.json"; then
    say "settings.json already matches the template"
  else
    cp "$SRC/.claude/settings.json" "$DST/.claude/settings.workflow.json"
    say "settings.json EXISTS → wrote settings.workflow.json (merge the deny list by hand)"
  fi
else
  cp "$SRC/.claude/settings.json" "$DST/.claude/settings.json"
  say "settings.json installed"
fi

# --- data scaffolds -----------------------------------------------------------
# Workflow state (tickets, sessions, reviews, checks, reports) does NOT live in
# the repo any more: it goes to a per-project sidecar outside it, so a repo you
# share with collaborators never receives your tickets and reviews. Only the
# layout marker and repo-level config are seeded here. Existing in-repo state is
# left exactly where it is — Settings → Updates offers the one-time move, and
# reads still merge it until then.
echo "[data] project config ($LAYOUT)"
mkdir -p "$DST/.TerMinal"
[ -f "$DST/.TerMinal/template.json" ] || \
  cp "$SRC/.TerMinal/template.json" "$DST/.TerMinal/template.json"
say "state lives in the sidecar (see Settings → Updates → Project state)"
[ -f "$DST/.TerMinal/widgets.json" ] || \
  cp "$SRC/.TerMinal/widgets.json" "$DST/.TerMinal/widgets.json"
[ -f "$DST/.TerMinal/snippets.json" ] || \
  cp "$SRC/.TerMinal/snippets.json" "$DST/.TerMinal/snippets.json"
say "terminal widgets/snippets seeded (existing left untouched)"

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
  3. If you had a Claude settings.json, merge settings.workflow.json into it.
  4. Merge .codex/hooks.workflow.json into your active Codex hooks config if you want repo-local Codex completion Inbox items.
  5. Commit the scaffold on a feature branch (never main — global §8).
  6. Start working: /tm:session-start "<goal>"  →  /tm:ticket  →  /tm:pr-creation  →  code-review agent
EOF
