#!/usr/bin/env bash
# bootstrap.sh — inject this workflow into an EXISTING repo.
#
#   ./bootstrap.sh /path/to/target-repo
#
# Seeds repo data + the Codex mirror (.codex skills/hooks, .agents contracts,
# CI, docs skeleton, and TerMinal project state scaffolds) into the target.
# Claude Code skills/hooks/bin are NOT copied — they ship globally via the tm
# plugin (installed by the TerMinal app at ~/.config/TerMinal/plugin, linked as
# ~/.claude/skills/tm); this script also removes machinery that OLDER bootstraps
# copied into the repo. Workflow files are overwritten (they ARE the workflow);
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

# --- workflow machinery (overwrite — this is the workflow) -------------------
# Claude-side machinery is global (tm plugin); only the Codex mirror + agent
# contracts + CI are still per-repo.
echo "[workflow] .codex/ + .agents/ + CI"
mkdir -p "$DST/.claude" "$DST/.codex" "$DST/.agents" "$DST/.github/workflows"
cp -R "$SRC/.codex/skills" "$DST/.codex/"
cp -R "$SRC/.codex/hooks"   "$DST/.codex/"
cp "$SRC/.codex/hooks.json" "$DST/.codex/hooks.workflow.json"
cp "$SRC"/.agents/*.md "$DST/.agents/"
cp "$SRC/.github/workflows/ci.yml" "$DST/.github/workflows/ci.yml"
chmod +x "$DST/.codex/skills/ticket/bin/"* \
         "$DST/.codex/skills/session-start/bin/"* \
         "$DST/.codex/hooks/"*.sh 2>/dev/null || true
say ".codex/skills, .codex/hooks, .codex/hooks.workflow.json, .agents, .github/workflows/ci.yml installed"

# --- migrate: remove Claude machinery older bootstraps copied in -------------
# Name-scoped, and MOVED to a backup rather than deleted — a repo-authored
# skill that happens to share a name (e.g. its own `document`) is recoverable.
# `notify` is intentionally NOT in the list: it is personal machinery excluded
# from the plugin, so an existing per-repo copy keeps working.
echo "[migrate] per-repo Claude machinery → tm plugin"
removed=0
BACKUP="$DST/.claude/pre-tm-backup"
migrate() { # <path relative to .claude/>
  local src="$DST/.claude/$1"
  [ -e "$src" ] || return 0
  mkdir -p "$BACKUP/$(dirname "$1")"
  rm -rf "${BACKUP:?}/$1"
  mv "$src" "$BACKUP/$1"
  removed=1
}
for s in check code-review digest document document-audit emergency-fix \
         enqueue-request factory knowledge knowledge-rag listener-inbox \
         loop-driver loop-evaluator loop-implementer loop-planner merge-sync \
         migrate-agents new-agent new-inbox-source new-knowledge \
         new-persistent-agent new-schedule new-snippet pr-creation \
         remote-terminal revert-main security-scan session-end session-start \
         stacked-mr terminal-widget test-suite ticket unblock-ci vibe; do
  migrate "skills/$s"
done
for b in activity chunk-diff code-review-preflight compute-verdict \
         findings-merge forge hitl list-agents merge-digest merge-sync \
         request-agent-artifact status; do
  migrate "bin/$b"
done
for h in block-main-merge.sh remote-check.sh stop-notify.sh; do
  migrate "hooks/$h"
done
rmdir "$DST/.claude/skills" "$DST/.claude/bin" "$DST/.claude/hooks" 2>/dev/null || true
# Drop settings.json hook entries that point at the removed scripts.
if [ -f "$DST/.claude/settings.json" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$DST/.claude/settings.json" <<'PY' || true
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
fi
[ "$removed" = 1 ] && say "moved old per-repo Claude skills/bin/hooks to .claude/pre-tm-backup/ (now served by the tm plugin; delete the backup once confirmed)" \
                   || say "no legacy Claude machinery found"

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

# settings.json — don't clobber an existing one
if [ -f "$DST/.claude/settings.json" ]; then
  cp "$SRC/.claude/settings.json" "$DST/.claude/settings.workflow.json"
  say "settings.json EXISTS → wrote settings.workflow.json (merge the deny list by hand)"
else
  cp "$SRC/.claude/settings.json" "$DST/.claude/settings.json"
  say "settings.json installed"
fi

# --- data scaffolds (seed only if absent — never clobber your data) ----------
echo "[data] project state ($LAYOUT)"
mkdir -p "$DST/.TerMinal"
if [ "$LAYOUT" = "v1" ]; then
  mkdir -p "$DST/backlog" "$DST/sessions" "$DST/.reviews" "$DST/.checks" "$DST/reports"
  [ -f "$DST/backlog/.next-id" ]   || cp "$SRC/.TerMinal/backlog/.next-id"   "$DST/backlog/.next-id"
  [ -f "$DST/sessions/.next-id" ]  || cp "$SRC/.TerMinal/sessions/.next-id"  "$DST/sessions/.next-id"
  [ -f "$DST/sessions/README.md" ] || cp "$SRC/.TerMinal/sessions/README.md" "$DST/sessions/README.md"
  [ -f "$DST/.reviews/README.md" ] || cp "$SRC/.TerMinal/reviews/README.md" "$DST/.reviews/README.md"
  [ -f "$DST/.checks/README.md" ]  || cp "$SRC/.TerMinal/checks/README.md"  "$DST/.checks/README.md"
  [ -f "$DST/reports/README.md" ]  || cp "$SRC/.TerMinal/reports/README.md" "$DST/reports/README.md"
  say "legacy backlog/, sessions/, .reviews/, .checks/, reports/ repaired (existing data untouched)"
else
  [ -f "$DST/.TerMinal/template.json" ] || \
    cp "$SRC/.TerMinal/template.json" "$DST/.TerMinal/template.json"
  mkdir -p "$DST/.TerMinal/backlog" "$DST/.TerMinal/sessions" "$DST/.TerMinal/reviews" "$DST/.TerMinal/checks" "$DST/.TerMinal/reports"
  [ -f "$DST/.TerMinal/backlog/.next-id" ]   || cp "$SRC/.TerMinal/backlog/.next-id"   "$DST/.TerMinal/backlog/.next-id"
  [ -f "$DST/.TerMinal/sessions/.next-id" ]  || cp "$SRC/.TerMinal/sessions/.next-id"  "$DST/.TerMinal/sessions/.next-id"
  [ -f "$DST/.TerMinal/sessions/README.md" ] || cp "$SRC/.TerMinal/sessions/README.md" "$DST/.TerMinal/sessions/README.md"
  [ -f "$DST/.TerMinal/reviews/README.md" ]  || cp "$SRC/.TerMinal/reviews/README.md"  "$DST/.TerMinal/reviews/README.md"
  [ -f "$DST/.TerMinal/checks/README.md" ]   || cp "$SRC/.TerMinal/checks/README.md"   "$DST/.TerMinal/checks/README.md"
  [ -f "$DST/.TerMinal/reports/README.md" ]  || cp "$SRC/.TerMinal/reports/README.md"  "$DST/.TerMinal/reports/README.md"
  say ".TerMinal/{backlog,sessions,reviews,checks,reports} seeded (existing data untouched)"
fi
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
if [ "$LAYOUT" = "v1" ]; then
  lock_lines=("backlog/.next-id.lock" "sessions/.next-id.lock" ".status.md" ".claude/pre-tm-backup/")
else
  lock_lines=(".TerMinal/backlog/.next-id.lock" ".TerMinal/sessions/.next-id.lock" ".status.md" ".claude/pre-tm-backup/")
fi
for line in "${lock_lines[@]}"; do
  grep -qxF "$line" "$DST/.gitignore" || printf '%s\n' "$line" >> "$DST/.gitignore"
done
say ".gitignore lock-dir entries ensured"

cat <<EOF

Done. Next steps in $DST:
  1. Fill the placeholders in CLAUDE.md (or merge CLAUDE.workflow.md if present).
  2. Adapt .github/workflows/ci.yml scripts to your project.
  3. If you had a Claude settings.json, merge settings.workflow.json into it.
  4. Merge .codex/hooks.workflow.json into your active Codex hooks config if you want repo-local Codex completion Inbox items.
  5. Commit the scaffold on a feature branch (never main — global §8).
  6. Start working: /tm:session-start "<goal>"  →  /tm:ticket  →  /tm:pr-creation  →  code-review agent
EOF
