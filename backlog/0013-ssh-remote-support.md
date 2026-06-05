---
id: 13
title: "Daemon-first remote support — attach TerMinal to local or SSH hosts"
status: in-progress
priority: high
horizon: next
hitl: false
type: feature
source: brainstorm
created: 2026-05-30
updated: 2026-06-05
prs: []
refs: []
---

## Why

Trevor sometimes wants to drive claude/codex on a remote box (Meridian
prod, future cloud GPUs / dev boxes) without losing the TerMinal cockpit
(activity feed, AIRuns ledger, HITL inbox, MCP tools, scheduled agents,
/code-review artifacts). Currently the whole cockpit assumes everything
is local: PTY spawn, `~/.config/TerMinal/`, MCP server, file tails.

## Decision

Use a daemon-first architecture for both local and remote execution.
The renderer/main process should attach to a TerMinal daemon endpoint with
explicit capabilities, regardless of whether that daemon is on localhost or
behind SSH on an Ubuntu box.

This avoids growing two separate product modes:

- Local mode = attach to local daemon.
- Remote mode = attach to remote daemon over SSH.
- UI surfaces key off the daemon's capability map, not off assumptions about
  the current filesystem.
- Direct SSH terminal launch is allowed only as a bootstrap/diagnostic bridge
  while the remote daemon install/probe flow is still coming online.

## Prior shapes

### Shape A — SSH-wrapper sessions (small, ~1-2 days)

PTY spawn becomes `ssh -tt <host> 'claude'`. xterm renders, you type,
claude runs on the remote.

Adds:
- Hosts list in Settings (alias / host / ssh config / default cwd)
- EntryScreen "Remote" mode + host picker
- Session metadata records host; UI badge "REMOTE"
- PTY spawn switch in `src/main/agents.ts` / index.ts session spawn

**Cost: every local cockpit feature breaks for remote sessions** —
activity tail (on remote disk), AIRuns ledger (remote transcripts), MCP
tools (local server can't reach remote files), HITL auto-fire, schedules
(local-rooted), .reviews artifacts (live in remote repo). Becomes a
styled `ssh` tab.

Probably not worth shipping alone.

### Shape B — Remote agent + local cockpit (real, ~1-2 weeks)

Ship a `terminal-agent` daemon to the remote (`scp`-install via the
host-onboarding flow). Runs as a Unix-socket / SSH-tunneled service. The
Mac TerMinal:

- Spawns claude/codex on remote via the agent
- Subscribes to remote `activity.jsonl` → folds into the local feed
- Mirrors remote `~/.config/TerMinal/ai-runs/` into the local AIRuns
  ledger (one cost view across hosts)
- HITL still files locally → one consolidated inbox across hosts
- MCP tools proxy through the agent (file_ticket, file_hitl, etc. on
  remote repos) — could literally be `ssh -W` tunneling the stdio
  channel to a remote `terminal-mcp-server`
- Settings has a `hosts:` list; sessions tagged by host

This is the version worth building.

## Product guardrail

Do not ship a remote mode that exposes obviously broken local-only surfaces.
Every remote workspace must advertise explicit capabilities, and the renderer
must gate tabs/widgets/actions from that capability map.

Default stance:

- Show the remote terminal only once PTY launch works reliably.
- Hide cockpit widgets unless their data source is backed by the remote agent
  or a local mirror.
- Hide or disable tabs that still call local-only IPC for the active remote
  workspace.
- If a feature is partially supported, show a short disabled state that says
  what remote capability is missing; do not show stale local data.
- Never let remote sessions write to local repo paths by accident. Remote file,
  ticket, MR, run, and search APIs must route through the remote workspace
  client.

Practical first slice:

- Supported: Terminal, remote badge/profile, host health/detect.
- Hidden until remote-backed: Cockpit, Tickets, MRs, Files, Docs, Search,
  Runs, Agents, Schedules, CI.
- Re-enable each surface one at a time only after its data path is remote-aware
  and tested against Ubuntu.

## Open design questions (to think on)

1. **Auth model.** SSH key forward + per-host config (zero extra creds)?
   Or per-host token signed by the agent install? Probably SSH key —
   it's what's already trusted on those boxes.
2. **Connection lifecycle.** Persistent SSH multiplex (ControlMaster) so
   spawning N sessions to one host is cheap? Or one tunnel per session?
3. **Agent install path.** TerMinal Settings "Add host" runs
   `scp terminal-agent host:~/.local/bin/` + a `launchctl`-equivalent
   bootstrap? Or just document the install and the app probes if it's
   present?
4. **File ops contract.** Does the activity tail + AIRuns mirroring
   stream incrementally (websocket-ish), or does TerMinal poll the agent
   for deltas every 5s? Probably incremental for activity (low-volume,
   high-importance), polled for AIRuns (high-volume, batchy).
5. **Multi-host UI.** Host selector lives in the sidebar / a top-level
   row? Sessions list groups by host? Per-host budget rollup?
6. **Forge CLIs on remote.** `gh` / `glab` / `claude` / `codex` must be
   installed + authed on the remote — TerMinal should detect missing
   pieces and surface "Install gh on this host" the same way the local
   env-detect surfaces local gaps.
7. **Cron parity.** Does cron continue to fire only locally (against
   local `terminal-cron`), or do remote-rooted schedules fire via the
   remote agent's launchd-equivalent? Probably the former for simplicity
   — schedules run from the Mac, dispatch work to remote.

## Non-goals (icebox-scope)

- Not a full VSCode-Remote-SSH replacement (no fs proxy for every
  read/write — only the cockpit surfaces above).
- Not multi-tenant — single-operator (Trevor), single Mac cockpit.
- Not running TerMinal itself headless on the remote.

## Implementation slices

1. Capability-gated remote shell bridge: add host profiles, launch a terminal
   through SSH, tag sessions as remote, and hide all local-only cockpit/tabs.
2. Local daemon parity: move local PTY/activity/artifact APIs behind the same
   daemon contract the renderer will use for remote hosts.
3. Ubuntu remote daemon: install/probe over SSH, report host health, engine
   availability, platform, workspace roots, and supported capabilities.
4. Remote PTY through daemon: spawn/resume engines via the daemon instead of
   raw SSH commands.
5. Remote artifacts one surface at a time: activity, HITL, runs, files/search,
   tickets, MRs, schedules, and cockpit widgets.

## Current first slice

The first shipped slice is intentionally narrow:

- Add remote host settings and SSH terminal launch.
- Use Ubuntu-compatible shell commands and explicit platform metadata.
- Treat remote sessions as terminal-only.
- Hide cockpit, tabs, snippets, skills, bootstrap, plugin widgets, local
  activity polling, and local workspace search for remote sessions.

This makes the smoke-test path usable without implying that local artifacts
are already remote-aware.
