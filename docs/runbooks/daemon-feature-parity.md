---
title: Daemon feature parity
last-verified: 2026-06-05
---

# Daemon feature parity

TerMinal should treat local and SSH workspaces as two profiles of the same
daemon contract. The renderer should not need to know whether a feature is
reading the local filesystem or an SSH host, beyond showing location metadata
and hiding features that are explicitly unsupported.

## Current contract

- A session may carry `remoteSession` metadata: host id, label, SSH target,
  remote cwd, platform, and daemon settings.
- `tab:context` is the capability boundary for the renderer. Tabs should key off
  `ctx.capabilities`, `ctx.remoteSession`, `ctx.repoRoot`, and repo feature
  flags instead of ad hoc SSH checks.
- Remote data currently routes through `src/main/remote.ts`, which runs a JSON
  RPC payload over SSH. This is the compatibility shim until a persistent daemon
  process owns the same contract locally and remotely.
- Settings are profile-scoped: paths, engines, default models, forge mode,
  template repo, and harness paths apply to the selected daemon profile.

## Parity matrix

| Surface | Local | SSH now | Target |
| --- | --- | --- | --- |
| Terminal sessions | Full | Full via SSH PTY | Same launch/resume behavior and engine model defaults |
| Repo context | Full | Probe-based | Same repo label, forge labels, and capability flags |
| Tickets | List/get/create/update/implement | List/get/create/update/implement | Same status/activity behavior and spawn options |
| MRs/PRs | List/detail/diff/CI/merge button | List/detail/diff, CI partial | Add remote CI jobs/logs and enforce the same human merge gate |
| Agents | List/edit/run/rerun/cancel/worktree ops | List/run | Add remote edit/reset/state/rerun/cancel/worktree cleanup |
| Schedules | List/save/toggle/run/reconcile/launchd | List/save/toggle/run now | Add real remote scheduler install/reconcile or clearly mark run-now only |
| Runs | Unified list/logs/cancel | Unified list/logs | Add cancel/rerun and consistent source/status mapping |
| Files | List/read/write/search/create/rename/delete | Same | Keep parity; add smoke tests for path guard and binary/large-file cases |
| Docs/sessions/notes | Full | Full | Keep parity; preserve hidden-tab defaults |
| Skills | Local repo + global | Not surfaced | Decide whether skills are local-only by design or expose remote skill discovery |
| Activity/HITL | Global local store + notifications | Local store for remote-triggered actions | Decide whether remote daemons own remote activity/HITL or mirror into local inbox |
| Background tasks | Full | Start via remote run path, list/cancel partial | Fold into unified runs or implement remote bg list/cancel |
| Observability/spend | Full local stores | Hidden/empty | Either remote daemon-backed metrics or explicit local-only capability |
| Browser/help | Local app feature | Same | No daemon dependency |

## DRY/refactor targets

1. Create a `WorkspaceDaemon` interface in main for repo-scoped operations:
   tickets, MRs, files, docs, agents, schedules, runs, notes, search, git, and
   probe. Implement `LocalWorkspaceDaemon` and `SshWorkspaceDaemon`.
2. Replace repeated `curRemote() ? remoteX : localX` branches in IPC handlers
   with `daemonForCurrentSession()`. IPC handlers should become thin permission,
   activity, and response-shaping layers.
3. Move the large embedded SSH script in `remote.ts` toward versioned modules.
   Short term: split by operation inside the script builder. Long term: install a
   small remote daemon/CLI and call stable JSON commands over SSH.
4. Centralize capability calculation. `tab:context` should derive every visible
   tab and action from one `DaemonCapabilities` object so terminal layout modes,
   tab visibility, and SSH profiles cannot drift.
5. Normalize run records across local, remote, cron, agent, background, and
   automation inbox sources. The Runs tab should not need special cases for
   remote logs or statuses.
6. Route all one-click actions through one launch descriptor:
   `{ daemon, cwd, engine, model, mode, prompt, worktreePolicy }`. Ticket,
   agent, schedule, snippet, and MR flows should share this path.
7. Add parity smoke tests at the main IPC/service level with a fake daemon
   implementation. Tests should verify each renderer action chooses the active
   daemon and never falls back to local paths for an SSH session.

## Immediate gaps to close

- Remote agent editing, reset, state, rerun, cancel, and worktree cleanup still
  return placeholders.
- Remote schedule reconcile says it needs a remote daemon runner. Until that is
  real, the Schedules UI should label remote schedules as run-now/persisted only.
- Remote CI supports GitHub run list only; GitLab CI, job detail, and logs are
  placeholders.
- `skills:list` returns empty on remote. Decide whether remote skills should
  surface or whether skills remain local project-template conventions.
- Activity/HITL for remote work is locally emitted around actions, but the remote
  host does not yet have a first-class activity/HITL sync contract.
- Observability endpoints return empty for remote sessions; either disable those
  widgets in remote capability flags or back them with remote daemon stores.

## Definition of done for feature parity

A feature is daemon-ready when:

- The UI action uses the active session daemon, not the local app cwd.
- The same action works for local and SSH or is hidden with a clear capability
  flag.
- Engine paths and default models come from the selected daemon profile.
- Activity/HITL/run records include enough profile metadata to navigate back to
  the right workspace/session.
- The remote failure mode is actionable: missing binary, missing forge auth,
  missing repo bootstrap, or unsupported capability.
- A smoke test covers local and remote routing for the action.
