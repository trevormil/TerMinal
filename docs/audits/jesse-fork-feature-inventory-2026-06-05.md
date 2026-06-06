# Jesse Walberg Fork Feature Inventory

Date: 2026-06-05

Fork: <https://github.com/jessewalberg/TerMinal>
Compared refs:

- Current TerMinal: `main` at `65cddca` when audited
- Fork: `jesse/main` at `0f8f5d0`
- Merge base: `c267f56`
- Divergence: current is 112 commits ahead of the merge base; fork is 118 commits ahead of the merge base

This is a code-level inventory of the fork-only commits, not just commit-title triage. I inspected representative diffs and the changed modules for each feature cluster, then cross-checked current main for overlap.

Scoring:

- `10`: should add soon
- `7-9`: strong candidate, but still needs integration/design judgment
- `4-6`: useful idea, lower priority or should be reshaped
- `1-3`: probably do not add, or only cherry-pick a tiny part
- `0`: bookkeeping/docs/merge-only or already fully superseded

Status:

- `Already here`: current main already has equivalent or better functionality.
- `Cool to add`: worth porting or re-implementing in our architecture.
- `Maybe`: useful but not urgent, or needs more product clarity.
- `Do not add`: conflicts with current direction or was removed/rejected.
- `Superseded`: current main solves the same problem differently.

## Highest-Value Takeaways

| Feature | Fork commits | Status | Score | Recommendation |
|---|---:|---|---:|---|
| Encrypt app secrets at rest with Electron `safeStorage` | `3f9f9bc` | Cool to add | 9 | Strong security hygiene. Current settings still appear to store Telegram-style secrets as plaintext. Port this, but adapt to daemon/local/remote profile settings. |
| Terminal scrollback search with `Cmd+F` and larger buffer | `64a56a1` | Cool to add | 9 | Very practical. Current terminal has rich right-click actions but no xterm search addon. Add scoped find overlay, keep it terminal-only, respect Files/browser find behavior. |
| Stream-json decoding for headless Claude/Cursor runs | `2d26b8e`, `ffd51e6`, `3c2b7e6` | Cool to add | 8 | If any headless process still buffers, this is a direct UX win. Port as daemon-aware output decoders, not as old main-process-only code. |
| Template source resolver shared by scaffold/bootstrap/install | `df19fde`, `7167198`, `2468e17`, `85c3d23` | Cool to add | 8 | Current local bootstrap path still has older local-checkout behavior; remote scaffold has clone fallback. DRY this into a daemon-aware template resolver. |
| Partial bootstrap detection | `bf138ac` | Cool to add | 8 | Current banner checks bootstrapping, but fork’s “partial wiring” classifier is a useful safety net for repos with `.agents/` but missing backlog/docs/sessions. |
| Docs tab first-class `docs/decisions/` category | `72b99b2`, `533829a` | Cool to add | 8 | Current Docs type/category list still lacks `decisions`; ADRs fall into Other. Small, low-risk UX improvement. |
| Hot synchronous read caches | `b3b82ab`, `dd1f2d6` | Cool to add | 7 | Fork found real main-thread poll hotspots. Re-evaluate against daemon-first architecture, then add TTL/mtime caches where still hot. |
| Projects-dir-is-repo warning | `42573e9` | Cool to add | 7 | Good onboarding guard. Current workspace picker changed substantially; add similar validation in local and remote profile setup. |
| Generic `deploy` activity kind | `61885f8`, `c265ed5` | Maybe | 6 | Keep generic “deploy/shipped” events; do not add Cloudflare-specific poller. This fits Activity/Automation Inbox if emitted by skills/scripts. |
| Re-run correctness improvements | `6c957a4`, `eb8be5a`, `a039184`, `4080204`, `0597be7` | Maybe / audit | 6 | Current main has rerun support but remote rerun has known gaps. Use fork tests as a checklist, not a direct port. |
| HITL recurrence grouping | `8a4c772`, `b878f74`, `241339f` | Maybe | 5 | Our Inbox is top-right/drawer and should stay compact. Recurrence badges could help if folded into the current drawer. |
| Task-first role routing pipeline | `83c6066` through `bae280d` | Do not add wholesale | 3 | Interesting, but conflicts with our current bias toward skills/one-click prompts over custom multi-stage orchestration. Cherry-pick only small routing ideas if needed. |
| Wedged detector expansion | `f2ccba3`, `b2787ee`, `1a8dbde`, `276a3e7`, `1a30a7b`, `ac3b2f2` | Do not add | 1 | We intentionally removed wedged detection and decided to trust agent sessions/completion hooks. Do not reintroduce this class of detector. |
| Cloudflare Workers poller | `61885f8`, removed by `c265ed5` | Do not add | 1 | Fork itself reverted this. Use generic deploy events or Automation Inbox adapters instead. |

## Feature-Level Inventory

### 1. Cursor Engine Support

Fork added Cursor as a third engine across detection, launch, settings, model picker, interactive sessions, headless agents, schedules, factory, background tasks, and cockpit metadata.

Commits:

- `aa60d3a` adds `cursor` engine and `cursor-agent` command mapping.
- `9707b4f` records ADR.
- `2d26b8e`, `3c2b7e6`, `68a0d31`, `a7a601f` improve Cursor streaming, schedule parity, logs, and spend tracking.

Current status: `Already here`. Current main has Cursor as first-class engine, packaged logo asset, model picker support, session discovery, daemon/remote work still in progress, and process-vs-terminal launch paths.

Recommendation: no direct port. Use fork’s stream-json decoder and spend parsing ideas as spot checks.

Score: 0 as feature, 8 for the stream-json subpiece.

### 2. Factory / Fleet / Triage Surfaces

Fork added separate global read-only tabs for factory health and cross-repo PR triage, plus Fleet state improvements.

Commits:

- `c86c3d8`: Factory tab showing throughput, agent/cron success, cycle time, activity sparkline, active repos, failures.
- `d284443`: Fleet `needs-me` state for sessions waiting on human action.
- `a4200cc`: Triage tab for cross-repo PR/MR buckets: ready, changes, needs review.
- `0cf4a58`: Fleet inventory with dormant/dead buckets and hide controls.

Current status: `Superseded / maybe`. Current main has a top-right Fleet entry, Activity, Inbox, Runs, Search, and a more daemon-first direction. A separate Factory or Triage tab would add surface area we have recently been trimming.

Recommendation:

- Do not add separate Factory/Triage tabs by default.
- Consider adding “ready PRs across workspaces” to Workspace Search or Fleet dropdown later.
- Consider dormant/dead repo concepts only if Fleet becomes noisy.

Score: 3.

### 3. Deploy Activity Events

Fork first added a Cloudflare Workers deployment poller and a generic `deploy` ActivityKind, then reverted the Cloudflare-specific poller while keeping the generic deploy event concept.

Commits:

- `61885f8`: `deploy` ActivityKind, Activity icon/tone/label, terminal-cli deploy command, Cloudflare settings and poller.
- `c265ed5`: removes Cloudflare poller/settings, keeps generic deploy events and CLI deploy helper.

Current status: `Maybe`. Current main does not appear to have a generic `deploy` ActivityKind or `terminal-cli deploy`.

Recommendation:

- Add generic `deploy`/`ship` activity classification if we want Activity to represent “merged vs shipped.”
- Do not add a Cloudflare-specific poller.
- Prefer Automation Inbox or per-repo skills/scripts to emit deploy events.

Score: 6 for generic event, 1 for Cloudflare poller.

### 4. Secrets at Rest

Fork encrypts credential fields in settings on disk through Electron `safeStorage`, while keeping plaintext values in memory after read.

Commit:

- `3f9f9bc`: adds `sealSecrets`, `openSecrets`, injected `initSecretSealer(safeStorage)`, unit tests, legacy plaintext passthrough, `enc:` base64 wrapper.

Current status: `Cool to add`. Current settings migration still reads/writes secret-looking fields as ordinary strings.

Recommendation:

- Port this soon.
- Update for current daemon profiles and remote settings: local app secrets can use macOS safeStorage; remote daemon profile secrets may need separate local-encrypted profile storage or explicit “stored remotely” semantics.
- Include migration tests for plaintext-to-encrypted-on-next-write.

Score: 9.

### 5. CI Webhook / CI Watchdog

Fork adds a localhost GitLab-compatible failed-pipeline webhook receiver, validates per-repo secrets, then spawns `.agents/ci-watchdog.sh`. The watchdog fetches logs, classifies failures, dry-runs by default, auto-fixes prettier, or files HITL.

Commits:

- `6549905`: webhook receiver, config parser, `ci-watchdog` agent script.
- `9b937c6`: hardening after review.
- `c8a2f2a`: drains oversized bodies and trims public surface.
- `88d3c39`: allowlist parsing for LLM labels.

Current status: `Maybe`. Current main already has `ci-failure-classifier.ts`, CI tab functionality, Automation Inbox, and a daemon-first direction.

Recommendation:

- Do not add a localhost public webhook as-is.
- Reframe as an Automation Inbox adapter: external CI systems append a signed/structured local request, or remote daemon receives it through a configured listener.
- The `ci-watchdog.sh` dry-run and allowlist-auto-fix pattern is useful.

Score: 5 for concept, 3 for exact implementation.

### 6. Headless Run Streaming and Log Decoding

Fork noticed that `claude -p` and `cursor-agent -p` can buffer text until completion. It switches them to stream-json formats and decodes NDJSON into human-readable live logs.

Commits:

- `2d26b8e`: Cursor `--output-format stream-json --stream-partial-output`, `cursor-stream.ts` decoder.
- `3c2b7e6`: renders meaningful Cursor tool call logs.
- `ffd51e6`: Claude stream-json decoder with tool breadcrumbs and usage summary.
- `a908a03`: CRLF handling for agent logs.
- `0597be7`: persisted agent logs read into Runs pane.

Current status: `Cool to add / audit`. Current main has a broader output-log pass and right-click terminal features, but no `createClaudeStreamDecoder` or `createCursorStreamDecoder` equivalent appeared in current code.

Recommendation:

- Test current standalone process behavior for Claude/Cursor. If buffering still happens, add decoders.
- Make it daemon-first: decoding belongs wherever the process is spawned, including remote daemon.
- Keep script-first agents plain-text; do not feed arbitrary script output through NDJSON decoders.

Score: 8.

### 7. Per-Run Wall-Clock Watchdog

Fork adds soft and hard max runtime settings. Soft cap logs, emits error activity, and files HITL while leaving the run alive; hard cap sends SIGTERM if configured.

Commit:

- `2fe69a5`: `run-watchdog.ts`, settings `maxRunMs`/`maxRunHardMs`, in-process and cron runner caps.

Current status: `Maybe`. Current main has cron stale sweep/watchdog behavior, but not this exact per-agent wall-clock cap.

Recommendation:

- A soft-only cap is useful. Hard-kill should remain opt-in.
- Avoid using this as a wedged-detector replacement; it is an observability guard, not a correctness signal.
- If added, make it per daemon profile and visible in Settings.

Score: 7.

### 8. Template Resolution / Bootstrap / Scaffold

Fork fixes packaged-app failures where `templates/project-template` is not available locally. It extracts reusable template resolution logic, shallow-clones when needed, cleans temp dirs, and hardens clone argument handling.

Commits:

- `df19fde`: bootstrap clone fallback.
- `38b5d00`: ADR for bootstrap clone fallback.
- `0908b3b`: files dedupe ticket.
- `7167198`: unifies scaffold, bootstrap, and Telegram `/install` template resolution.
- `2468e17`: hardens git clone against option injection.
- `85c3d23`: cleanup/typecheck/test fixes.
- `630e201`: retargets submodule to personal fork.

Current status: `Cool to add`. Current local bootstrap path still has local-checkout assumptions; remote scaffold has clone fallback in `remote.ts`.

Recommendation:

- Add a shared `template.ts` resolver, but update it for daemon-first local/remote profiles.
- Do not retarget submodule to Jesse’s personal fork.
- Keep clone target setting explicit and validate local path vs git URL.

Score: 8.

### 9. Runs Tab Rerun / Refresh / Log State

Fork improves rerun behavior so reruns dispatch against the run’s own repo, preserve schedule/ticket semantics, show immediate feedback, poll detached reruns, refresh reactively, and expose errors.

Commits:

- `6c957a4`: rerun via run’s own repoRoot, not current session.
- `eb8be5a`: detail pane selects new run when rerun starts.
- `a039184`: rerun ticket implementation runs via ticket runner.
- `4080204`: reactive status refresh.
- `5d2a7f3`: keep filter dropdowns open across refresh.
- `a908a03`: CRLF log rendering.
- `eca9269`: cron AIRun `startedAt` epoch bug.
- `20047e1`: `terminal-cli run` lifecycle and run-source registration.

Current status: `Maybe / audit`. Current main already has Runs, rerun, run logs, Automation Inbox run logs, and current remote daemon work. But `agents:rerun` currently returns remote rerun unsupported in at least one path, so this area needs a current audit.

Recommendation:

- Use fork tests as regression checklist.
- Rebuild around daemon API: rerun should be a daemon operation and should work for local and SSH.
- `terminal-cli run lifecycle` overlaps with our runId/runSource conventions; compare before porting.

Score: 6.

### 10. Wedged / Crash Loop Detector

Fork expands and hardens the wedged detector: ignores self-recovered edit errors, scans Codex sessions, trusts Codex exit-code envelopes, and redefines wedge criteria after false positives.

Commits:

- `f2ccba3`: ignore read-before-write errors that self-recovered.
- `b2787ee`: scan Codex sessions.
- `1a8dbde`: require real failure signal for Codex outputs.
- `276a3e7`: trust Codex exit-code envelope.
- `1a30a7b`: redefine wedge and eliminate false positive HITLs.
- `7b9a421`, `ac3b2f2`, `4e46f24`: ADR/review/fixes.

Current status: `Do not add`. We explicitly removed the wedged detector and chose to trust sessions/completion hooks rather than heuristic wedge filing.

Recommendation: do not port.

Score: 1.

### 11. Repo Scope Defaults for List Tabs

Fork adds a shared `useRepoScope` hook so Runs, Schedules, Agents-run panel, and Activity default to the current window’s repo, while allowing persistent “all repos” opt-out.

Commit:

- `9f4bb19`: repo-scoped defaults and `useRepoScope`.

Current status: `Maybe`. Current main has workspace and daemon profile context. Some global tabs intentionally remain global; others should be daemon/workspace scoped.

Recommendation:

- Re-evaluate after daemon-first work stabilizes.
- Use the same principle: list surfaces should default to the active workspace/daemon, with explicit “all” opt-out.

Score: 6.

### 12. Main-Thread Performance Caches

Fork caches expensive reads driven by renderer polling.

Commits:

- `b3b82ab`: transcript path/stats cache by session, repo root/origin TTL, cron-run parsed JSON cache, docs TTL.
- `dd1f2d6`: debounce Agents tab activity-firehose reloads.

Current status: `Cool to add`. Current main has more UI and daemon work, which may increase polling pressure.

Recommendation:

- Profile first, then add targeted TTL/mtime caches.
- Good candidates: transcript stats, repo root/origin, docs tree, run records.

Score: 7.

### 13. UI Polish / Small Fixes

Fork includes several small UX and correctness fixes.

Commits:

- `c0ce013`: relative time, ellipsis, pluralization, loading/empty states.
- `6495b1a`: Reports tab order.
- `902ecb3`: confirm before deleting HITL.
- `dbb0329`: visually distinguish finished agents.
- `a4d5305`: session picker defaults to resumable engine.
- `44d360c`: ignores `.codegraph/`, `.cursor/`, scheduler lock.
- `0c4a38d`: terminal falls back to nearest existing cwd instead of dying silently.
- `672e372`: `@electron/rebuild` bump for Node 26.
- `43562d4`: context-window cap unification in pricing registry.

Current status: `Mixed`.

Recommendation:

- Cherry-pick after checking current equivalents.
- The nearest-existing-cwd fallback is especially worth checking against remote/daemon startup.
- Ignore `.cursor/` probably still useful if not already present.

Score: 5 overall; 7 for cwd fallback if missing.

### 14. Projects Directory Guard

Fork catches when `projectsDir` points at a repo itself instead of the parent folder containing repos.

Commits:

- `42573e9`: `classifyProjectsDir`, Settings/Onboarding warning component.
- `b868b05`, `904c74b`: backlog/PR tracking.

Current status: `Cool to add`. Current workspace selection has changed, but the footgun remains possible for local profiles.

Recommendation:

- Add validation to the new workspace/profile UI and Settings.
- For remote, apply the same idea against remote paths through the daemon.

Score: 7.

### 15. Bootstrap Partial Wiring Detection

Fork detects repos that are partially bootstrapped: `.agents/` exists but other project-template dirs are missing.

Commit:

- `bf138ac`: `classifyBootstrap()` style behavior and banner copy.

Current status: `Cool to add`.

Recommendation:

- Add to current bootstrap banner and remote daemon bootstrap status.
- Show missing pieces concisely.

Score: 8.

### 16. Docs Decisions Category

Fork adds `docs/decisions/` as a first-class Docs category with renderer type sync.

Commits:

- `72b99b2`: main docs categorizer.
- `533829a`: renderer DocCategory and hints.

Current status: `Cool to add`. Current main still lacks `decisions` in `DocCategory`.

Recommendation: add directly. Small, low-risk.

Score: 8.

### 17. Keyboard Navigation / Terminal Find / Resume Search

Fork adds workspace hotkeys, terminal scrollback find, and resume picker search.

Commits:

- `c9e9727`: `Cmd+1..9` workspace switch and `Cmd+Shift+[ ]` cycle.
- `64a56a1`: xterm search addon, `Cmd+F`, Enter/Shift+Enter, 10k scrollback.
- `4c97db4`: resume picker free-text search and removes hard 300 truncation while searching.

Current status:

- Workspace/tab hotkeys: `Already / superseded` by current hotkey work.
- Terminal find: `Cool to add`.
- Resume search: `Maybe`; current lazy loading/pagination work should be checked first.

Recommendation:

- Add terminal find.
- Keep global hotkeys minimal to avoid collisions.
- Resume search should be lazy/paginated, not load all sessions on entry.

Scores: terminal find 9; resume search 6; workspace hotkeys 3.

### 18. HITL Recurrence Grouping

Fork groups HITL items by repo and shows recurrence badges based on normalized titles/fingerprints.

Commits:

- `8a4c772`: group inbox by repo and recurrence badge.
- `b878f74`: normalize transient ids.
- `241339f`: align with `hitlFingerprint` for 6+ ids.

Current status: `Maybe`. Current main moved HITL to top-right Inbox drawer and recently compacted completion-hook items.

Recommendation:

- Do not port the old HITL tab UI.
- Maybe add a tiny recurrence indicator inside current Inbox groups/details.

Score: 5.

### 19. Learnings Injection

Fork reads `docs/learnings/*.md`, extracts title/summary, and injects a capped “prior gotchas” preamble into prompt-style agent spawns.

Commits:

- `27d4d22`: `learnings.ts`, preamble injection.
- `e92d5d0`: skip README/INDEX.

Current status: `Maybe / cool`. Current main has session-start/session-end skills and MCP `search_decisions`, but not automatic spawn-time learnings injection in `agents.ts`.

Recommendation:

- Good concept, but integrate as a general “context pack” for spawned agents.
- Keep capped and transparent; avoid bloating every run.
- Apply to daemon local/remote, and maybe let settings toggle.

Score: 7.

### 20. Agent Script Program Improvements

Fork adds script-backed agents and JSON sidecars for CI watchdog, coverage, dead-code, deps-quality, drift, perf, and model-tier/cost-ladder cleanup.

Commits:

- `3570ed3`: restructures coverage/deps-quality to cost ladder.
- `73b309c`: pins model tiers and tightens agent contracts.
- `0dff570`: ships worktree-reaper agent to project-template.
- Plus diff adds `.agents/*.sh`/`.json` for coverage, dead-code, deps-quality, drift, perf, ci-watchdog.

Current status: `Maybe`. Current main has many `.agents/*.md` entries and richer skill/project-template direction.

Recommendation:

- Do not blindly copy generated `.sh` scripts into the app repo.
- Evaluate each as project-template defaults, especially worktree reaper and deterministic coverage/deps agents.
- Keep our newer “skills and snippets” UX as the authoring surface.

Score: 6.

### 21. Task-First Role Routing / Multi-Engine Pipeline

Fork adds a major alternate direction: type a task, route plan/code/review/verify stages to different engines/models, plan gate via HITL, heavy-diff verification, spend per stage, UI composer, and Auto engine pick.

Commits:

- `83c6066`: settings roles and taskFlow.
- `1fe8200`: role-tagged pipeline steps and `composeTaskSteps`.
- `98cb8d6`: pure routing and heaviness gate.
- `3e2a736`: per-step engine/model/decoder/ledger.
- `2f38ace`: `runTask`, stage gates, plan gate.
- `13e9e09`: `tasks:start` IPC and plan-gate resume.
- `b7a869e`: `Cmd+K` task composer and settings UI.
- `1073e04`: policy-route review stage.
- `6d3fd17`: Auto engine pick.
- `bae280d`: Auto card validation.
- ADR/review commits: `8ab2e0d`, `598447b`, `a393ab2`, `06e3b49`, `0f8f5d0`.

Current status: `Do not add wholesale`. We recently discussed multi-agent orchestration and decided these flows are probably better as skills rather than a big drag/drop/custom pipeline primitive.

Recommendation:

- Do not port the TaskComposer/product surface.
- Useful ideas to cherry-pick:
  - separation-of-duty reminder for review workflows,
  - heavy-diff heuristic for when to run extra verification,
  - per-step cost attribution if a future skill spawns multiple engines.

Score: 3 wholesale; 6 for selected sub-ideas.

## Commit-by-Commit Ledger

This ledger includes fork-only commits on `jesse/main` in chronological order. Merge-only and backlog-only commits are kept because they explain the fork’s process, but they have score `0` unless they imply product behavior.

| Commit | What changed | Current status | Score |
|---|---|---|---:|
| `aa60d3a` | Adds Cursor engine end-to-end: detection, settings, launch, agents, schedules, background tasks, model picker, logo, cockpit metadata. | Already here; current implementation is newer. | 0 |
| `9707b4f` | ADR documenting Cursor as third engine. | Already captured in current history/docs differently. | 0 |
| `c86c3d8` | Adds read-only Factory tab for cross-repo throughput, run success, cycle time, recent failures, active repos. | Superseded by current Fleet/Activity/Runs direction; avoid another default tab. | 3 |
| `61885f8` | Adds deploy ActivityKind, terminal deploy helper, and Cloudflare Workers poller/settings. | Generic deploy event maybe useful; Cloudflare poller later reverted. | 6 |
| `d284443` | Adds Fleet `needs-me` awaiting state. | Partly superseded by top-right Inbox and badges. | 4 |
| `a4200cc` | Adds Triage tab for open PR/MR buckets across repos. | Maybe as Fleet/Search dropdown; avoid default tab. | 3 |
| `d4c039a` | Files backlog gap tickets #0014-0031. | Bookkeeping. | 0 |
| `3f9f9bc` | Encrypts Telegram/Cloudflare secrets at rest via safeStorage. | Cool to add, adapted to daemon profiles. | 9 |
| `c265ed5` | Removes Cloudflare-specific poller, keeps generic deploy activity. | Agree with removal. | 1 |
| `6549905` | Adds CI webhook receiver and `ci-watchdog` script. | Reframe via Automation Inbox; do not expose localhost webhook as-is. | 5 |
| `ed65293` | Marks CI ticket linked/closed. | Bookkeeping. | 0 |
| `9b937c6` | Hardens CI webhook after review. | Only relevant if adopting webhook concept. | 3 |
| `c8a2f2a` | Drains oversized webhook bodies and trims public surface. | Good hardening pattern; exact feature not prioritized. | 3 |
| `2d26b8e` | Streams Cursor headless runs through stream-json and decodes output. | Cool to add if current Cursor headless still buffers. | 8 |
| `2fe69a5` | Per-run wall-clock watchdog with soft HITL and optional hard SIGTERM. | Maybe add soft cap. | 7 |
| `df19fde` | Bootstrap clone fallback when packaged app lacks template checkout. | Cool to add. | 8 |
| `38b5d00` | ADR for bootstrap clone fallback. | Docs only. | 0 |
| `0908b3b` | Files template-resolution dedupe ticket. | Bookkeeping. | 0 |
| `6c957a4` | Rerun dispatches against original run repo, not current focused repo. | Audit current rerun/remote behavior using this as test target. | 6 |
| `eb8be5a` | Shows rerun start and selects new run in detail pane. | Useful if current UI lacks feedback. | 5 |
| `a039184` | Reruns ticket implementation runs through ticket runner. | Audit current ticket rerun path. | 6 |
| `3c2b7e6` | Improves Cursor tool-call log rendering. | Useful with stream-json decoder. | 7 |
| `4080204` | Reactive run status refresh via watchers/events. | Maybe; current runs/logs should be checked. | 5 |
| `0597be7` | Reads persisted agent logs into Runs pane. | Maybe; current RunLogPane already reads multiple run sources. | 4 |
| `ffd51e6` | Streams Claude headless runs via stream-json and decodes output/usage. | Cool to add if buffering remains. | 8 |
| `7167198` | Unifies scaffold/bootstrap/Telegram install template resolution. | Cool to add in daemon-aware form. | 8 |
| `35bd580` | Closes template ticket. | Bookkeeping. | 0 |
| `2468e17` | Hardens git clone against option injection. | Useful for any clone resolver. | 8 |
| `85c3d23` | Typecheck/test cleanup for clone hardening. | Support commit. | 0 |
| `323339c` | Merge PR #1. | Merge-only. | 0 |
| `bdadd90` | Merge PR #4. | Merge-only. | 0 |
| `f2ccba3` | Wedged detector ignores self-recovered read-before-write errors. | Do not port wedged detector. | 1 |
| `a908a03` | Renders CRLF agent logs instead of blank pane. | Useful if not already covered by current log sanitizer. | 5 |
| `a4d5305` | Session picker defaults to a resumable engine. | Current entry flow changed; check if still relevant. | 4 |
| `61318fc` | Adds audit report and ADR to stay on Electron. | Historical docs only; current direction remains Electron. | 0 |
| `5d2a7f3` | Keeps Runs filter dropdowns open across refreshes. | Small UX win if still flaky. | 4 |
| `44d360c` | Ignores generated `.codegraph/`, `.cursor/`, scheduler lock. | Probably add if missing. | 5 |
| `dbb0329` | Makes finished agents visually distinct from running. | Current Agents UI likely differs; small polish. | 4 |
| `9f4bb19` | Defaults list tabs to current repo with persistent all-repos opt-out. | Maybe reapply as daemon/workspace scope. | 6 |
| `b3b82ab` | Caches hot main-process fs/git/doc/transcript reads. | Cool to add after profiling. | 7 |
| `dd1f2d6` | Debounces Agents tab activity-firehose reloads. | Cool if current firehose causes duplicate IPC. | 6 |
| `c0ce013` | Tidies relative time, ellipsis, pluralization, loading/empty states. | Cherry-pick selectively. | 4 |
| `6495b1a` | Gives Reports distinct tab order and updates docs table. | Current tabs changed; likely no-op. | 2 |
| `902ecb3` | Confirms before removing HITL item. | Current Inbox has resolve/remove UX; verify destructive delete confirmation. | 5 |
| `3529f05` | Files follow-up tickets for deferred audit items. | Bookkeeping. | 0 |
| `eca9269` | Stores AIRun `startedAt` as raw epoch, not `Date.parse(number)`. | Check current AI ledger. If bug exists, add. | 6 |
| `88d3c39` | CI watchdog label parsing via allowlist. | Good defensive pattern only if CI watchdog exists. | 3 |
| `3570ed3` | Restructures coverage/deps-quality agents to cost ladder. | Maybe for project-template agent scripts. | 5 |
| `73b309c` | Pins model tiers and tightens agent contracts. | Useful principle; exact scripts likely stale. | 5 |
| `50cd824` | ADRs for growth/SEO agent program. | Product-specific docs; do not port. | 0 |
| `630e201` | Retargets project-template submodule to personal fork. | Do not port. | 0 |
| `b868b05` | Files projectsDir-is-repo onboarding ticket. | Bookkeeping. | 0 |
| `43562d4` | Unifies context-window cap in AI pricing registry. | Check current pricing/model registry. | 5 |
| `5e95a67` | Files context-window accuracy ticket. | Bookkeeping. | 0 |
| `42573e9` | Warns when projectsDir is itself a git repo. | Cool to add. | 7 |
| `904c74b` | Marks projectsDir ticket in-progress/link PR. | Bookkeeping. | 0 |
| `b2787ee` | Wedged detector scans Codex sessions too. | Do not port. | 1 |
| `52928ac` | Marks wedged-detector Codex scan ticket in-progress. | Bookkeeping. | 0 |
| `0dff570` | Ships worktree-reaper agent to project-template. | Maybe useful as project-template maintenance agent. | 6 |
| `672e372` | Bumps `@electron/rebuild` for Node 26 postinstall. | Check current dependency version only. | 4 |
| `1a8dbde` | Wedged detector requires real failure signal for Codex. | Do not port. | 1 |
| `276a3e7` | Wedged detector trusts Codex exit-code envelope over body text. | Do not port. | 1 |
| `0cf4a58` | Fleet inventory with dormant/dead buckets and hide. | Maybe later if Fleet gets noisy. | 5 |
| `9d35bfa` | Marks fleet inventory ticket in-progress/link PR. | Bookkeeping. | 0 |
| `bf138ac` | Detects partially-wired repos in bootstrap banner. | Cool to add. | 8 |
| `56257d0` | Marks bootstrap partial ticket in-progress/link PR. | Bookkeeping. | 0 |
| `72b99b2` | First-class Docs `decisions` category. | Cool to add directly. | 8 |
| `0c97486` | Marks docs decisions ticket in-progress/link PR. | Bookkeeping. | 0 |
| `533829a` | Syncs renderer DocCategory contract for `decisions`. | Cool to add directly with previous commit. | 8 |
| `c9e9727` | Workspace hotkeys `Cmd+1..9`, `Cmd+Shift+[ ]`. | Mostly superseded by current hotkey work. | 3 |
| `818ed81` | Marks keyboard-nav ticket in-progress/link PR. | Bookkeeping. | 0 |
| `64a56a1` | Terminal `Cmd+F` scrollback search and 10k scrollback. | Cool to add. | 9 |
| `4182e03` | Marks terminal-find ticket in-progress/link PR. | Bookkeeping. | 0 |
| `4c97db4` | Resume picker free-text search and unbounded search results. | Maybe; adapt to lazy/paginated sessions. | 6 |
| `b2fc3e1` | Marks resume search ticket in-progress/link PR. | Bookkeeping. | 0 |
| `8a4c772` | HITL inbox grouped by repo with recurrence badge. | Maybe adapt to current Inbox drawer. | 5 |
| `8bce27c` | Marks HITL grouping ticket in-progress/link PR. | Bookkeeping. | 0 |
| `b878f74` | Normalizes transient ids for recurrence counting. | Only useful if recurrence is added. | 4 |
| `241339f` | Aligns recurrence normalization with `hitlFingerprint`. | Only useful if recurrence is added. | 4 |
| `de8de4d` | Merge PR #6. | Merge-only. | 0 |
| `188f313` | Merge PR #7. | Merge-only. | 0 |
| `05e039d` | Merge PR #8. | Merge-only. | 0 |
| `38a5316` | Merge PR #9. | Merge-only. | 0 |
| `a2be6fc` | Merge PR #10. | Merge-only. | 0 |
| `920f598` | Merge PR #11. | Merge-only. | 0 |
| `e80a8fa` | Merge PR #12. | Merge-only. | 0 |
| `ba2f313` | Merge PR #14. | Merge-only. | 0 |
| `27d4d22` | Injects `docs/learnings` as prior-gotchas preamble into agent spawns. | Maybe add as context pack. | 7 |
| `41eeb6b` | Marks learnings injection ticket in-progress/link PR. | Bookkeeping. | 0 |
| `e92d5d0` | Skips README/INDEX when collecting learnings. | Necessary if adding learnings injection. | 7 |
| `c78a897` | Closes merged stack tickets and scrubs PR URLs. | Bookkeeping. | 0 |
| `20047e1` | Adds `terminal-cli run` lifecycle and workflow run-source. | Compare with current runId/runSource and Automation Inbox. | 5 |
| `5d937ee` | Documents stacked-MR run-source registration. | Docs only. | 0 |
| `1a30a7b` | Redefines wedged detector to reduce false HITLs. | Do not port. | 1 |
| `7b9a421` | ADR for wedged detector redefinition. | Do not port. | 0 |
| `ac3b2f2` | Addresses Codex review findings on wedged detector. | Do not port. | 1 |
| `4e46f24` | Records Codex review artifact. | Bookkeeping. | 0 |
| `0c4a38d` | Terminal falls back to nearest existing cwd instead of dying silently. | Good small hardening if missing. | 7 |
| `bb80ab3` | Files engine binary absolute path ticket. | Bookkeeping; concept still relevant to remote/local settings. | 3 |
| `87266bc` | Merge PR #16. | Merge-only. | 0 |
| `83c6066` | Adds role routing table and task-flow settings. | Do not port wholesale. | 3 |
| `1fe8200` | Adds role-tagged task pipeline plan/code/review/verify. | Do not port wholesale. | 3 |
| `98cb8d6` | Adds pure per-step routing and heavy-change gate. | Cherry-pick heavy-diff idea maybe. | 5 |
| `68a0d31` | Runs Cursor schedules with `cursor-agent`, not codex fallback. | Already here / verify current schedules. | 5 |
| `4500679` | Background tasks fall back to per-engine default model. | Likely useful if current bg tasks lack this. | 6 |
| `a7a601f` | Tracks cursor-agent usage in spend ledger. | Maybe if spend ledger still matters. | 4 |
| `3e2a736` | Per-step engine/model/decoder/ledger in runStep. | Only useful with task pipeline; do not port broadly. | 3 |
| `2f38ace` | Task-first `runTask`, stage gates, plan-gate HITL. | Do not port wholesale. | 3 |
| `13e9e09` | `tasks:start` IPC and plan-gate resume contract. | Do not port wholesale. | 2 |
| `b7a869e` | `Cmd+K` task composer, role-routing settings, multi-engine run display. | Current UX went different direction. | 2 |
| `8ab2e0d` | ADR for task-first role routing. | Docs only; do not port. | 0 |
| `598447b` | Fixes review findings on task-routing series. | Support commit. | 0 |
| `a393ab2` | Records task-routing review artifact. | Bookkeeping. | 0 |
| `1073e04` | Policy-routes review stage on every pipeline run. | Maybe conceptually useful for separation of duties. | 4 |
| `6d3fd17` | Auto engine pick via role policy. | Maybe as lightweight default selection, not full pipeline. | 5 |
| `06e3b49` | ADR update for routing extension. | Docs only. | 0 |
| `bae280d` | Validates Auto card launch context. | Only relevant if Auto card exists. | 2 |
| `0f8f5d0` | Records routing-extension review artifact. | Bookkeeping. | 0 |

## Suggested Next Port Order

1. Secrets at rest with `safeStorage`, updated for daemon profiles.
2. Docs `decisions` category.
3. Terminal scrollback search.
4. Template resolver + bootstrap partial detection.
5. Stream-json decoders for headless Claude/Cursor, if current smoke test confirms buffering.
6. Projects-dir validation.
7. Main-thread poll caches, guided by current profiler/manual symptoms.
8. Generic deploy activity event, only if we want “merged vs shipped” in Activity.

## Explicit Non-Ports

Do not port these unless the product direction changes:

- Wedged detector and Codex/Claude repeated-error heuristics.
- Cloudflare Workers poller.
- Separate default Factory/Triage tabs.
- Full task-first role-routing pipeline and `Cmd+K` task composer.
- Retargeting project-template to Jesse’s fork.
