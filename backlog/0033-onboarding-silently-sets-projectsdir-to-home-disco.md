---
id: 33
title: "Onboarding silently sets projectsDir to home, discovering zero repos for nested layouts"
status: open
priority: medium
horizon: now
hitl: false
type: ux
source: Discovered live 2026-07-18 while registering cfo-ai (~/workspace/cfo-ai) with the harness
created: 2026-07-18
updated: 2026-07-18
prs:
  - "https://github.com/trevormil/TerMinal/pull/109"
refs: []
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Problem

Onboarding lets a user finish with `projectsDir: ""` (blank field or "Skip for now"), which
`configuredProjectsDir()` resolves to the **home folder**. Repo discovery
(`knownRepoRoots()` in the MCP server, `terminal-mcp-server`) then scans only **one directory
level** under that folder. Anyone who keeps repos nested — e.g. `~/workspace/*`, `~/code/*` —
gets a green onboarding, `onboarded: true`, and **zero discovered repos**, with the UI copy
cheerfully saying "leave blank to use your home folder."

Concretely: a machine with 66 repos under `~/workspace` and one repo directly in `~`
(`project-template`) discovered exactly that one. The factory looked empty for every real project.

The existing validation catches the *rare* mistake — pointing the field **at** a repo
(`validateProjectsDir` → `reason: 'is-repo'`, with a "Use parent" button at
`src/renderer/src/components/Onboarding.tsx:118-128`) — but says nothing about the *common* one:
a folder whose repos live one level too deep. The consequence (how many repos this choice will
manage) is never shown before the user commits.

The default isn't wrong; the onboarding hides the one number that would reveal when it's wrong.

## Fix — three changes, highest-leverage first

### AC1 — Live "repos found" count under the Projects folder field (minimum viable)
As the user types or browses, run the same one-level discovery scan and render a count:
- `Manages N repos in this folder` when N > 0
- `⚠ 0 repos found here — they may be nested one level deeper` when N = 0

This makes the invisible discovery rule visible at the moment of decision, and also makes the
blast radius legible (pointing at `~/workspace` = "manages 66 repos") **before** committing.
Reuse the discovery logic; do not duplicate the scan rule.

### AC2 — Autodetect the default instead of hardcoding home
`Onboarding.tsx` already calls `detectEnv()` on mount. Add a parent-scan that checks candidate
roots — `~`, `~/workspace`, `~/code`, `~/projects`, `~/dev`, `~/src` — one level down, counts git
repos in each, and pre-fills the field with the **densest** one. "Leave blank for home" becomes a
fallback, not the recommended path. (On the reference machine this selects `~/workspace` (66) over
`~` (1).)

### AC3 — Extend validation to flag zero-discovery
Add a `no-repos-found` reason to `ProjectsDirValidation` and render it in the **same amber banner**
already used for `is-repo`, with the same suggested-fix button — except the suggestion descends to
the densest child (e.g. "Use ~/workspace (66 repos)") rather than "Use parent". The UI pattern
exists (`Onboarding.tsx:118-130`); it just handles the wrong case today.

## Explicitly out of scope (the tempting wrong fix)

Do **not** make discovery recurse 2+ levels so a home default finds `~/workspace/*`. That trades
this bug for over-registration (it would sweep `~/Downloads/some-clone`, etc.) and is a heavier
behavioral change. Keep discovery shallow and predictable; AC1 is the lever that makes shallow
discovery legible. If deeper scanning is ever wanted, file it separately with its own guardrails.

## Verification
- Fresh onboarding with `~/workspace` typed → field shows "Manages N repos"; finishing writes that
  path; `factory_health` lists those repos.
- Fresh onboarding left blank on a machine whose repos are all nested → AC3 banner fires with a
  concrete suggested parent; accepting it fixes discovery.
- AC2: on a machine with repos under `~/workspace`, the field is pre-filled to `~/workspace`, not left
  blank.

## Pointers
- `src/renderer/src/components/Onboarding.tsx` — the step, the `finish()` write (`projectsDir.trim()`),
  the existing `validateProjectsDir` hook and amber banner.
- `src/renderer/src/components/SettingsPanel.tsx` — same field post-onboarding; the count/validation
  should ideally show here too.
- `~/.config/TerMinal/bin/terminal-mcp-server` — `configuredProjectsDir()` (empty → homedir) and
  `knownRepoRoots()` (one-level scan). Source of truth for the discovery rule AC1 must mirror.

