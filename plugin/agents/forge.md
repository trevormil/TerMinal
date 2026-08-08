# forge — GitHub / GitLab abstraction

This template works with **either** forge and switches per repo. Skills that
touch the forge (pr-creation, code-review, merge-sync, stacked-mr) resolve which
one is active and use the matching CLI + terminology. The merge-block hook
already blocks both `gh pr merge` and `glab mr merge`.

## Resolving the active forge

Run the detector — it prints `github` or `gitlab`:

```bash
forge="$("$HOME/.config/TerMinal/plugin/bin/forge")"
```

Resolution order (`$HOME/.config/TerMinal/plugin/bin/forge`):
1. **`FORGE` env var** — explicit per-invocation override.
2. **Sidecar override** — the per-repo `forge` file in the project sidecar.
   This is THE way to pin a repo's forge (required for self-hosted GitLab
   whose host doesn't contain "gitlab", e.g. `git.example.com`). Set it with:
   `echo gitlab > "$(tm-state-dir forge)"`.
3. **Legacy `.claude/forge`** in the repo — no longer seeded (ADR-0023), still
   honored where it exists. Never CREATE this file; use the sidecar.
4. **Auto-detect** from `git remote get-url origin` (`*github*` → github;
   `*gitlab*` → gitlab; an unrecognized self-hosted host → gitlab).
5. **Default** `github` (no origin at all).

Auto-detect covers github.com, GitHub Enterprise, gitlab.com, and any host
with "gitlab" in it — only unrecognized self-hosted GitHub needs the sidecar
override. The TerMinal app resolves the same files in the same order, so the
app's MRs tab and the skills always agree.

## Terminology

| | GitHub | GitLab |
|---|---|---|
| CLI | `gh` | `glab` |
| Change unit | **PR** (pull request) | **MR** (merge request) |
| Default branch | usually `main` | usually `main` |

Use the right word in prose for the active forge ("open the PR" vs "open the MR").

## Command mapping

| Action | GitHub (`gh`) | GitLab (`glab`) |
|---|---|---|
| Create change | `gh pr create --base <b> --title "..." --body "..."` | `glab mr create --target-branch <b> --source-branch <cur> --title "..." --description "..."` |
| Stacked base | `gh pr create --base <parent-branch>` | `glab mr create --target-branch <parent-branch>` |
| View state | `gh pr view <n> --json state,mergedAt,number,url` | `glab mr view <n>` (parse `state: merged`) |
| List open | `gh pr list` | `glab mr list` |
| List merged | `gh pr list --state merged` | `glab mr list --merged` |
| Closes ticket(s) in body | `Closes #<id>` | `Closes #<id>` |
| Remove source branch | `--delete-branch` (on merge, human) | `--remove-source-branch` (create-time flag) |

Notes:
- Never pass any auto-merge / merge flag — merging is human-only (global §8).
- `gh` / `glab` must be authenticated (`~/.config/gh/`, `~/.config/glab-cli/`).
- For self-hosted GitLab, `glab` needs the instance configured
  (`glab auth login --hostname <host>`).

## `auto-mergeable` label convention

When an agent opens a PR/MR whose diff is **only docs / markdown / tickets /
reports / agent specs** — i.e. nothing under a code path or a lockfile, nothing
that affects runtime behavior — it should tag the change with the
**`auto-mergeable`** label. The human (or a future bot) can then merge those
without a full /code-review cycle.

```bash
# After `gh pr create` / `glab mr create` returns the URL:
case "$forge" in
  github) gh pr edit <N> --add-label "auto-mergeable" ;;
  gitlab) glab mr update <N> --label "auto-mergeable" ;;
esac
```

**Eligible (always tag):** changelog, auto-docs, drift-auditor trivial-fix PRs,
report-only changes under `$TERMINAL_REPORTS_DIR/`, ticket updates under `$TERMINAL_BACKLOG_DIR/`.

**Not eligible (never tag):** coverage (adds test files), deps-quality (touches
lockfile + can affect runtime), perf (touches code), any PR with edits under
`src/`, `lib/`, `app/`, etc., or under root config that affects build/runtime.

When in doubt, **omit the label** — it's purely opt-in. TerMinal renders the
label as a green `auto-mergeable` chip on the MR row so the human can scan a
list and merge the safe ones in batch.
