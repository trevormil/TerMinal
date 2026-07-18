# Changelog

All notable changes to TerMinal are recorded here.

TerMinal is released as tagged semver versions: `bun run cut-release` (human-run,
from `main`) derives the next version from conventional commits, cuts the
`[Unreleased]` section below into a dated release section, and pushes a `vX.Y.Z`
tag; CI then builds the DMG and publishes a GitHub Release whose notes are that
section (see `docs/decisions/0004-versioned-releases.md`). The **build stamp**
(version + commit SHA + build time, shown top-right in Settings) still identifies
*exactly* what a given install is running between releases. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); curate notable changes
into `[Unreleased]` as they merge.

## [Unreleased]

### Added
- Versioned releases: `bun run cut-release` (auto semver from conventional
  commits), a tag-triggered Release workflow publishing the DMG + checksums to
  GitHub Releases, and the app version shown in the Settings build stamp.
- CI hardening: `bun audit` job (blocks on High/Critical), dependency-review on
  PRs, superseded-run cancellation, and explicit workflow permissions.
- Ctrl-C'd (or crashed) engine sessions now drop to a live local shell in the
  same cwd instead of leaving a dead "process exited" pane.
- Cockpit Git panel is a link to Files → Changes; the Open-PRs/MRs and
  TDD/Review cards deep-link into the MRs tab.
- Click-to-copy affordances for the full session id, a PR's source branch, and
  a skill's slash-command.
- Open-source project hygiene: `CHANGELOG.md`, `NOTICE`, GitHub issue templates,
  `CODE_OF_CONDUCT.md`, and SHA-256 checksums emitted for release artifacts.
- Documented supported platforms (macOS-primary) and a download-verification
  step in `docs/setup.md`.

### Changed
- The local automation inbox now defaults to **opt-in** (was on by default) — it
  auto-runs full-access agents on dropped files, so it must be enabled
  deliberately.

### Security
- OpenRouter requests from the bundled `or-exec` helper no longer carry a
  personal repository handle in the `HTTP-Referer` header.

---

Earlier history predates this file; see `git log` and the build stamp for the
full record.
