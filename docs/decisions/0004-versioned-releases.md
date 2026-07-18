# 4. Versioned releases: semver tags, GitHub Releases, curated changelog

Date: 2026-07-18

## Status

Accepted

## Context

TerMinal shipped continuously from `main`: `bun run release` rebuilt whatever
was checked out and reinstalled `/Applications/TerMinal.app`, with the build
stamp (commit sha + time, Settings top-right) as the only identity a build had.
`package.json` sat frozen at `0.1.0`, there were no git tags and no GitHub
Releases, and `CHANGELOG.md` explicitly documented the stamp-only stance.

That stopped scaling once the repo went public and PR-first: downloads had no
verifiable versioned artifact, "what changed since my install" required reading
git log against a sha, and every install was a bespoke local build.

## Decision

- **Semver, auto-derived from conventional commits.** `bun run cut-release`
  computes the bump from commits since the last tag (`feat` → minor,
  `type!:` breaking → major, everything else → patch), with `patch|minor|major`
  or an explicit `x.y.z` as overrides. Pure logic lives in
  `src/shared/release/versioning.ts` (unit-tested); the script is a thin wrapper.
- **The cut is human-only.** `cut-release` commits the version bump + changelog
  cut to `main` and pushes a `vX.Y.Z` tag. Since it pushes `main`, the
  block-main-merge hook keeps agents out by construction — releasing is a
  deliberate human act, same as merging (global §8).
- **CI builds and publishes on tag push.** `.github/workflows/release.yml`
  (macOS runner) verifies tag == `package.json` version, runs the test suite,
  builds the unsigned DMG, and publishes a GitHub Release with the DMG,
  `SHA256SUMS.txt`, and notes taken from the changelog section
  (`scripts/release/notes.ts`, commit-list fallback).
- **Changelog stays hand-curated.** Notable changes accumulate in
  `[Unreleased]` (Keep a Changelog); the cut moves them into a dated
  `## [x.y.z]` section that doubles as the release notes.
- **The build stamp remains** for identifying local/interim builds between
  releases, now prefixed with the app version (`__APP_VERSION__`).

## Consequences

- Every published artifact is reproducible from a tag and verifiable via
  checksums; "what version am I on" is answerable from Settings.
- `bun run release` (local build + install to /Applications) is unchanged and
  still the way an installed app gets updated — GitHub Releases are the public
  distribution channel, not an auto-updater. True self-update still needs an
  Apple Developer ID signature + notarization (out of scope here).
- Supersedes the stamp-only continuous-release stance previously described in
  `CHANGELOG.md`'s header (rewritten with this change).
