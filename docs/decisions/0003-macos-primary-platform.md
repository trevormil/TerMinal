---
id: 0003
title: macOS-primary platform (Apple Silicon) — Linux/Windows not yet packaged
anchor: ADR-0003
status: accepted
date: 2026-07-15
supersedes:
superseded-by:
---

## [1] Context

TerMinal is a desktop control plane for coding agents. Several core pieces are
tied to macOS today:

- **Packaging** — `electron-builder.yml` targets `dmg` only; no Linux
  (AppImage/deb) or Windows target is built.
- **Local scheduling** — `src/main/launchd.ts` mirrors enabled schedules into
  **launchd** jobs (`launchctl`), which exists only on macOS.
- **External-app handoffs** — "open in editor/browser" shells out to `open -a`
  (macOS), defaulting to Cursor/Brave (configurable in Settings).
- **Install/relaunch** flow assumes `/Applications` and ad-hoc `codesign`.

Note the distinction: **remote** scheduled execution already runs on Linux hosts
via `systemd --user` / k8s (see [[ADR-0002]]). It is the **local desktop app**
that is macOS-bound.

## [2] Decision

Treat macOS (Apple Silicon) as the **primary, supported** platform for the
desktop app and document it plainly (README "Platform" note, `docs/setup.md`
"System prerequisites: macOS-first"). Do not claim cross-platform support we
don't test or ship.

`bun run dev` may launch on Linux for development, but OS-specific features
(local schedules, app handoffs, packaging) are expected to degrade or no-op
there rather than be first-class.

## [3] Consequences

- Honest expectations for new users and forkers; no silent breakage from an
  implied-but-absent Linux/Windows build.
- Cross-platform support becomes an explicit, opt-in future effort: a Linux/
  Windows packaging target, a non-launchd local scheduler (or "remote-only
  schedules" on those platforms), and detected-app handoffs. Tracked in the
  backlog rather than assumed.
- Any code path that would call a macOS-only tool (e.g. `launchctl`) on a
  non-darwin host should guard on `process.platform === 'darwin'` and surface a
  clear "macOS-only" message instead of throwing.

## [4] Alternatives considered

- **C1 — Claim/attempt full cross-platform now.** Rejected: launchd, `open -a`,
  and the packaging/signing flow all need real per-platform work and testing we
  can't currently sustain; claiming it without shipping it misleads users.
- **C2 — Say nothing.** Rejected: the implicit assumption is exactly what trips
  up a Linux user who clones and runs — an unguarded `launchctl` call or a
  missing build is a worse first impression than an upfront "macOS-first".
