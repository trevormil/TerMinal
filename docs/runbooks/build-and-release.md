---
title: Build & package the macOS app
last-verified: 2026-07-18
---

# Build & package (macOS)

Produce a branded, double-clickable `TerMinal.app` you can drop in
`/Applications` and pin to the Dock. Set `TERMINAL_APP_DEST` if you want to
install somewhere else, such as a per-user `~/Applications/TerMinal.app`.

## Versioned releases (cut → tag → GitHub Release)

Public releases are tagged semver versions (ADR-0004). The cut is **human-only**
(it pushes to `main`, which the agent hook blocks):

```bash
bun run cut-release          # auto bump from conventional commits since last tag
bun run cut-release minor    # force a bump level
bun run cut-release 1.0.0    # explicit version (required for the very first tag)
```

The script derives the next version (feat → minor, fix/other → patch,
`type!:` → major), updates `package.json`, cuts `CHANGELOG.md [Unreleased]` into
a `## [x.y.z] - date` section, commits `chore(release): vX.Y.Z`, tags, and
pushes. The tag triggers `.github/workflows/release.yml`, which builds the DMG
on a macOS runner and publishes a GitHub Release with `SHA256SUMS.txt` and the
changelog section as notes (commit-list fallback when `[Unreleased]` was empty).

After the Release is up, install locally with `bun run release` (below) — it
fast-forwards `main` and rebuilds, so the installed app matches the tag.

## Release discipline (PR-first) + build stamp

TerMinal follows the full PR + human-merge flow (CLAUDE.md / global §8). The
installed `/Applications/TerMinal.app` can lag `main`. To keep them honest:

1. **Release from `main`, after the PR merges.** `git checkout main && git pull`,
   then `bun run release`. Don't ship the installed app from a feature branch
   (except for local testing — see below).
2. **Check what's installed** in the app: **Settings → top-right build stamp**
   (version + commit sha + build time). It's baked in at build time by
   `electron.vite.config.ts` (`__APP_VERSION__` / `__BUILD_SHA__` /
   `__BUILD_BRANCH__` / `__BUILD_TIME__`). Compare the sha to
   `git log --oneline -1 main`:
   - matching sha (no `-dirty`) → installed app == merged main. ✅
   - a branch name / `-dirty` suffix → you're running unmerged or uncommitted
     code; re-release from clean `main` once the work has landed.
3. **Testing a branch locally** is fine — `bun run release` builds the current
   checkout and the stamp will show the branch, so it's obvious the installed
   app is a preview, not `main`.

## One shot

```bash
bun run dist
```

This runs `electron-vite build` then `electron-builder --mac` (config:
`electron-builder.yml`). Outputs to `dist/`:

- `dist/mac-arm64/TerMinal.app` — the app bundle
- `dist/TerMinal-<version>-arm64.dmg` — a draggable installer

The app icon comes from `build/icon.icns` (regenerate from `build/icon.png` with
`iconutil` if you change the logo).

## Make it launchable + install it

The build is **unsigned** (`identity: null` — no Apple Developer cert). On Apple
Silicon an unsigned bundle whose signature wasn't re-applied trips "app is
damaged". Re-sign deep ad-hoc, then install:

```bash
APP="dist/mac-arm64/TerMinal.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"   # should exit 0, no output
rm -rf "/Applications/TerMinal.app"
cp -R "$APP" /Applications/
xattr -cr "/Applications/TerMinal.app"
open "/Applications/TerMinal.app"   # right-click → Open the first time (Gatekeeper)
```

Then right-click the Dock icon → **Options → Keep in Dock**.

`bun run release` automates the same sequence and installs to
`/Applications/TerMinal.app` by default:

```bash
bun run release
TERMINAL_APP_DEST="$HOME/Applications/TerMinal.app" bun run release
```

Before building, `bun run release` fetches `origin` and fast-forwards clean
`main` / `master` checkouts to the remote default branch. It skips that pull and
builds the current checkout when the repo has local changes, is on a feature
branch, has no `origin`, or is not a git checkout. Set
`TERMINAL_RELEASE_SKIP_PULL=1` to bypass the latest check explicitly.

## Notes

- The packaged app is a **snapshot**. After code changes, re-run `bun run dist`
  and reinstall.
- `templates/` and `bin/` are **not** bundled into the app (electron-builder
  ships only `out/**` + `package.json`). The in-app "New project from template"
  flow clones project-template at runtime when the submodule isn't present.
- Sharing the `.dmg` to another Mac: that machine will quarantine it — the
  recipient needs right-click → Open (or `xattr -cr`) the first time.
- Dev runs (`bun run dev`) and the installed app can run side by side; the dev
  build reflects live code, the installed app is the frozen snapshot.
