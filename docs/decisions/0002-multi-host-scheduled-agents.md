---
id: 0002
title: Multi-host scheduled agents — always-on execution off the Mac
anchor: ADR-0002
status: proposed
date: 2026-07-12
supersedes:
superseded-by:
---

## [1] Context

Scheduled agents today are triggered by **launchd on the Mac** (`src/main/launchd.ts`),
so a schedule only fires while the laptop is awake. That is the one real weakness of
an otherwise solid system — the runner (`bin/terminal-cron`) is already a self-contained
Bun script with **zero app imports** and no launchd dependency (launchd merely calls
`terminal-cron run <id>`), and the read-back half (run records → Runs tab merge → host
filter → remote log fetch) was already built to be host-aware in #41/#42
(`src/main/remote.ts`, `remote-runs.ts`, `cron-runs.ts` `UnifiedRun`).

We want scheduled agents to run on always-on hosts (starting with an Ubuntu box, but
**generically any number of registered hosts**), while keeping the LLM-provider
independence we already have (engine switch + `.agents/<id>.sh` script-first path) and
keeping TerMinal as the control plane.

We evaluated adopting a self-hosted orchestrator (Windmill / Kestra / Temporal /
Trigger.dev). Rejected: they would *replace* the parts we already have working
(scheduler + run dashboard) and force re-plumbing tickets/HITL/PRs into their model —
high switching cost, marginal gain. See [4] C1.

## [2] Decision

Add a **Linux systemd trigger layer** alongside the existing macOS launchd layer, and
let each schedule choose where and how it runs. TerMinal stays the control plane; only
the execution substrate moves.

**Data model (generic, never host-name-specific):**

- `Schedule.host?: string` — a **hostId** referencing an entry in
  `settings.remoteHosts[]`. `undefined` = run locally. Never a literal like `"tm"`.
- `Schedule.runtime?: 'bare' | 'container'` — default `'bare'`.

**Trigger layer chosen by capability, not identity** — branch on the host's `platform`:

- `platform: 'darwin'` (local) → **launchd** (`launchd.ts`, unchanged).
- `platform: 'linux'` (any registered host) → **systemd `--user` timers**
  (`src/main/systemd.ts`, new) rendered/installed over SSH via the existing
  `remoteJson` transport and `isSafeSshTarget` guard.

**Execution substrate (per schedule):**

- `bare` (default) — `terminal-cron run <id>` on the host: `git worktree add` off the
  default base, spawn the engine directly, write `cron-runs/<id>.json`+`.log`. Same
  isolation model as today, maximum reuse.
- `container` (opt-in) — the systemd unit runs `docker run <agent-image>` whose
  entrypoint dispatches the engine, bind-mounting the `cron-runs` dir (so records still
  surface in the Runs tab) plus the worktree/repo and secret env. The **same image is
  the `k8s CronJob` artifact** for the `runtime: k8s` path — this is the deliberate
  bridge to running under Kubernetes without a rewrite. Note (2026-07-12): the k8s
  target is a **single-node cluster ON the always-on host (k3s), NOT a remote/cloud
  cluster** — same hardware as the systemd path, with k8s orchestration (CronJob
  history, concurrency policy, backoff, resource limits). See #16.

**Control plane = push model.** Editing a schedule in the Mac app writes the schedule
and, when `host` is set, pushes it to that host and reconciles its systemd units on save
(mirrors how launchd syncs a plist on save). Every reconcile/read op takes a host param
and loops over `remoteHosts[]`; nothing is single-host.

**Read-back is reused as-is.** If the host runner writes the exact `cron-runs/<id>.json`
shape, runs appear in the Runs tab with a host badge for free
(`collectRemoteRuns` already stamps `hostId`/`hostLabel`).

**Cross-host data plane (2026-07-12).** State is coherent across hosts by leaning on
whatever store is *already global*, and only aggregating what is genuinely host-local:
- **PRs/MRs → the forge; code/branches → git remote.** Global by construction, zero sync.
- **Tickets → left as-is** (per-repo backlog / provider) — the operator confirmed this is
  fine; not made cross-host here.
- **Runs + HITL → control-plane fan-out.** The Mac reads all hosts over SSH (host-stamped)
  and routes writes/resolves back to the owning host (`collectRemoteRuns`,
  `collectRemoteHitl`, `hitl:resolve`/`remove` route by `hostId`).
- **Budgets, kill-switch, circuit-breaker, agent-state → intentionally PER-HOST, not
  centralized.** Hosts are single-purpose (one host per kind of work), so separate limits
  are correct, not a gap. Revisit only if one host ever runs mixed workloads that must
  share a global cap.

## [3] Consequences

- Schedules fire regardless of laptop state, on any number of registered Linux hosts.
- One genuinely new file (`systemd.ts`), a schedule-model addition, a runner port, and a
  control-plane extension — the rest is reuse. No third copy of the engine switch: the
  *same* `terminal-cron` runs on Mac and Linux (though the existing hand-mirror between
  `terminal-cron` and `agents.ts` remains — this ADR does not fix that, but adds the
  missing `openrouter`/`hermes` branches so hosts don't silently fall through to codex).
- Two trigger layers to maintain (launchd + systemd) — the accepted cost of the hybrid,
  per-schedule model that lets us migrate incrementally with a local fallback.
- **Headless gotcha:** systemd `--user` timers require `loginctl enable-linger <user>`
  or they won't fire without an active login — captured as a host-provisioning step.
- **Failure-surfacing gap:** a host-side run files its HITL/backlog into *that host's*
  `~/.config/TerMinal`; the Mac Inbox only reads local state (only *runs* fan out over
  SSH today). v1 relies on the Runs-tab failed badge (free) + Telegram notify
  (creds sidecar already works cross-host); fanning HITL/activity out over SSH is a
  fast-follow. See [4] C3.

## [4] Conflicts resolved

- **C1 — adopt a self-hosted orchestrator vs. port our own runner:** chose **port our
  own**. Windmill/Kestra/Temporal/Trigger.dev replace the scheduler+dashboard we already
  own and would force re-plumbing tickets/HITL/PRs. The runner is already portable; the
  read-back is already host-aware.
- **C2 — full migration to a host vs. hybrid per-schedule host:** chose **hybrid**.
  Per-schedule `host` (local | any registered host) allows incremental migration with the
  Mac path untouched as a fallback; the end-state cost is two coexisting trigger layers.
- **C3 — bare vs. containerized execution:** chose **bare as the v1 default,
  `runtime:'container'` as an opt-in**. Bare is the fastest, maximum-reuse path (hosts
  already have the engine CLIs); the container path is the reproducible, isolated option
  and doubles as the `CronJob` artifact for the `runtime: k8s` path (k3s ON the host, #16).
- **C4 — host identity:** chose **hostId reference into `remoteHosts[]`**, never a
  hardcoded name. The design is multi-host by construction; `"tm"` is only ever a *label*
  of the operator's first registered host.

## [5] Unchanged and still binding

- The human-only merge gate (global §8) is unaffected; this ships via the PR flow.
- TDD-first remains the gate — `systemd.ts` gets pure unit tests like `cron.ts`/
  `launchd.ts`; the schedule-model + routing changes get integration coverage.
- LLM-provider independence via the engine switch + `.agents/<id>.sh` script-first path
  is preserved and extended, not replaced.
- The `cron-runs/<id>.json`+`.log` run-record contract and `UnifiedRun` shape are the
  stable interface between any host runner and the Runs tab — do not fork it.

## [6] Superseded decisions

| Prior | Was | Now | Why |
|---|---|---|---|
| (none) | launchd-only, Mac-tethered scheduling | +systemd multi-host, hybrid per-schedule | always-on off the laptop |
