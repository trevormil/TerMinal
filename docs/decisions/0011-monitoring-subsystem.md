# 11. Native Monitoring subsystem

Date: 2026-07-24
Status: accepted
Supersedes: [0010](0010-health-checks-contract.md)

## Context

TerMinal needed first-class infrastructure observability — uptime, cert
expiry, port/DNS reachability, and arbitrary custom checks — as a drop-in
replacement for the standalone control-plane app. The prior `check-status`
contract (ADR-0010) leaned on scheduled *agents* emitting a status one-liner;
monitoring is deterministic and should not be entangled with agents, runs, or
inference.

## Decision

A dedicated **Monitoring subsystem**, wholly separate from runs/agents/schedules
and with **zero inference**.

- **Own process.** `bin/terminal-monitor` is a self-contained daemon fired by
  its own launchd job `com.terminal.monitor` (`StartInterval`, `RunAtLoad`) —
  it runs even when the desktop app is closed. Not a cron job, not an agent.
- **Generic core check types only:** `http`, `tls-cert`, `tcp`, `dns`,
  `command`. Nothing stack-specific (Kubernetes, a particular CI, DOKS) lives
  in core. The `command` type is the extensibility escape hatch: it runs any
  user shell command and maps exit code — or a `{status,summary,metrics,detail}`
  stdout JSON — to health. Custom stacks are user config, never core code.
- **Config + state as plain JSON.** `~/.config/TerMinal/monitors.json` (edited
  by the Monitoring tab or `terminal-cli monitor`) and
  `~/.config/TerMinal/monitor-state/<id>.json` (daemon-owned). The app and
  bridge only READ; the daemon owns all probing and writes.
- **Inbox is the alert channel.** On a status transition the daemon files a HITL
  item via `terminal-cli hitl --severity=…`, reusing the existing severity +
  notify-threshold + Telegram/push path. Per-monitor prefs: `onFailure`
  severity (or `off`), `onRecovery`, `renotifyAfterSec` (re-nag a still-failing
  check), and an optional daily digest at an hour.
- **Surfaces.** A desktop Monitoring tab (its own tab, add/edit/run, history) and
  a mobile Monitoring tab over `GET /v1/monitors` (read-only). `terminal-cli
  monitor add|list|status|remove|enable|disable|check` for scripts.

## Consequences

- The `check-status` contract, `src/main/checks.ts`, the Reports "Live checks"
  strip, `/v1/checks`, and the template `http-check.sh`/`fleet-health.sh` are
  removed (ADR-0010 superseded).
- Control-plane parity is reached in user space: uptime/cert = `http`/`tls-cert`
  monitors; k8s/CI/DOKS = `command` monitors (kubectl / GitHub API / curl the
  control-plane backend). The control-plane iOS app can be deprecated while its
  backend stays as an optional data source.
- Automation stays where it belongs: if you want an agent to *act* on a check,
  that's a Run/Schedule that may call `terminal-cli monitor` — the Monitoring
  tab itself never infers or acts.
