# 16. One-click update is a rebuild-from-source, not an auto-updater

Date: 2026-07-31

Status: accepted

Amends the release story in
[ADR-0004](0004-versioned-releases.md) (which stands otherwise). Ships as
[#180](https://github.com/trevormil/TerMinal/pull/180).

> **Status update (2026-08).** The *decision* stands — one-click update is still
> a rebuild-from-source — but its premise has since changed: releases ARE signed
> with a Developer ID and notarized now (`bin/release` +
> `.github/workflows/release.yml`, ticket 93). The blocker described in Context
> below is therefore historical. `electron-updater` is no longer *blocked*, it is
> simply not what we chose; revisit as a new ADR if the rebuild path stops
> fitting. The unsigned build remains a supported fallback
> (`TERMINAL_UNSIGNED=1`, or a fork without the signing secrets).

## Context

ADR-0004 made published artifacts versioned and verifiable, but left the
installed app's own upgrade path manual: `bun run release` in a checkout, by
hand. Once TerMinal went PR-first, `/Applications/TerMinal.app` routinely lagged
`main` — and the only way to notice was to compare the build stamp in Settings
against `git log` yourself.

The obvious answer, `electron-updater` against the GitHub Releases from ADR-0004,
is blocked: an auto-updater requires a Developer ID signature and notarization,
and the DMGs are unsigned (`identity: null` in `electron-builder.yml`, first
launch needs right-click → Open). Waiting for signing meant staying manual
indefinitely.

The user is, however, a developer with the source checkout on the same machine —
which is a capability a normal desktop app doesn't have.

## Decision

Ship a one-click update that **rebuilds from the local source checkout** instead
of downloading a release artifact.

- **Detect, don't nag.** `src/main/update-check.ts` compares the sha baked into
  the build (`__BUILD_SHA__`, stamped by `electron.vite.config.ts`) against
  upstream: preferably through the local checkout's `origin/main`
  (fetch + merge-base — exact, and works on any fork), falling back to the
  unauthenticated GitHub compare API when no checkout is found. Every failure
  degrades to `status: 'unknown'`. The check runs once, 2.5s after first paint,
  and stays silent unless the build is confirmed `behind`.
- **The stamp is the version identity between releases**, including its `-dirty`
  suffix for builds made from an uncommitted tree — a dirty build is
  uncomparable, and says so rather than guessing.
- **Update now = `bin/release`, detached.** `release:start` spawns the same
  script a human would run, in its own process group with stdio ignored and
  `unref()`ed, streaming to `~/.config/TerMinal/release.log` for the renderer to
  tail. It must outlive its parent: `bin/release` kills the running app in order
  to replace `/Applications/TerMinal.app`, and a child in the parent's group
  would kill its own build.
- **Stage the install.** The copy into `/Applications` is staged so a failure
  cannot leave the user with no app at all — the failure mode of "quit the app,
  then fail to install the new one" is unacceptable for a daily driver.

## Consequences

- The installed app can be brought current from inside itself, with no terminal
  and no manual commands — the single highest-friction step in the PR-first
  workflow.
- This works **only for users who have the source checkout**. It is a
  developer-tool affordance, not a distribution mechanism; GitHub Releases
  (ADR-0004) remain the path for everyone else, and a real signed auto-updater
  remains the eventual answer. That ADR's decisions about semver, tags, CI
  publishing and the curated changelog are unchanged.
- The app can restart itself as a side effect of a button, which makes the
  release script part of the app's runtime surface rather than a dev script:
  breaking `bin/release` now breaks a shipped feature.
- Comparing against `origin/main` (not a tag) means "up to date" tracks the
  branch, so a user can be ahead of the latest release and still be current.
