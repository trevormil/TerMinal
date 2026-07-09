---
title: "`bun run release` doesn't replace an already-running TerMinal process"
date: 2026-07-09
tags: [release, electron, ops, single-instance]
anchor: LRN-release-relaunch
---

# Release relaunch ≠ process replacement

## [1] The gotcha

`bun run release` rebuilds, signs, reinstalls `/Applications/TerMinal.app`, and
runs `open` to relaunch it. But if an instance is **already running**, Electron's
single-instance lock makes the "new" launch **focus the existing in-memory
process** instead of starting the new binary. Result: the on-disk app is new, but
the **running main process is still the old code** until a full **Cmd-Q →
reopen**.

Symptom seen 2026-07-09: after releasing the HITL/Telegram fix, `ps` showed the
TerMinal main process still stamped from *before* the release, and a module-level
startup side effect (`syncTelegramSidecar()`) had not run.

## [2] What DOES update immediately

The helper bins are copied to `~/.config/TerMinal/bin/` as part of the release,
so **out-of-process code updates right away**:

- `terminal-cron`, `terminal-cli`, `terminal-mcp-server` — launchd/agents/MCP
  spawn these fresh each run, so they pick up new code without an app restart.
- Verify with a timestamp + content check:
  `ls -la ~/.config/TerMinal/bin/terminal-cron` and grep for a new symbol.

What does **not** update until Cmd-Q → reopen: anything in the **main process** —
IPC handlers, startup side effects, poll loops, the settings cache.

## [3] Why we don't auto-kill the running instance

TerMinal **hosts Claude Code / agent sessions**. Force-quitting it from inside a
session (or from an agent running in that TerMinal) can kill the very session
doing the release. So the release intentionally does **not** kill a running
instance — the operator does the Cmd-Q → reopen when convenient.

## [4] Operator checklist after a release

1. Confirm the **installed** artifact via the build stamp in Settings (sha +
   build time) vs `git log` on `main`.
2. If the change touches **only** helper bins (cron/cli/mcp), it's live now.
3. If it touches **main-process** code, Cmd-Q → reopen to activate it.
4. A `-dirty` build stamp means it was built from an uncommitted tree.
