# Changelog

All notable changes to TerMinal are recorded here.

TerMinal ships continuously from `main` rather than tagging a semver release per
change, so the **build stamp** (commit SHA + build time, shown top-right in
Settings) is the source of truth for *exactly* what a given install is running.
This file is the human-readable companion: it groups notable merged changes so
you can map a build stamp back to what changed. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
