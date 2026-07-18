# 5. Embed project-template in the TerMinal repo

Date: 2026-07-18

## Status

Accepted

## Context

The project template lived as a standalone repo
(`github.com/trevormil/project-template`) vendored into TerMinal as a git
submodule at `templates/project-template`. That split meant two histories, a
submodule pointer to keep bumped, a `git submodule update --init` step for
contributors, an on-use `git pull` inside the submodule, and a network clone
fallback for the packaged app — all for content that only TerMinal consumes.

## Decision

- **Embed the template as regular tracked files** at
  `templates/project-template` (the root `.gitignore`'s `.TerMinal/` pattern is
  anchored to `/` so the template's seed `.TerMinal/` content stays tracked).
- **Bundle it into the packaged app** via electron-builder `extraResources`, so
  scaffolding works offline with no clone.
- **Resolution order** (`src/main/template.ts`): configured path/URL → source
  checkout → packaged copy (`process.resourcesPath`) → shallow clone of
  `DEFAULT_TEMPLATE_REPO` (now the TerMinal repo), resolving the
  `templates/project-template` subdir of whatever was cloned. The remote-host
  bootstrap copy in `remote.ts` mirrors the same logic.
- **Template provenance** (`__TEMPLATE_SHA__`, ticket 0045) becomes the last
  main-repo commit touching `templates/project-template`.
- **Archive the standalone repo** (read-only; history preserved there,
  content + future history live here). The on-use upstream `pull` in
  `scaffold.ts` is removed — the template versions with the checkout/app.

## Consequences

- One repo, one history, one PR flow for app + template changes; template edits
  now go through the same review gate as app code.
- `vendor/agentview` remains the only submodule (`.gitmodules` keeps it).
- Scaffolds no longer auto-track a moving upstream: a scaffold is as fresh as
  the checkout/app doing the scaffolding. Bootstrap-stamp repair (ticket 0045)
  covers refreshing older repos.
- Anyone who had `templateRepo` configured to the old standalone URL keeps
  working (archived repos clone fine) but should clear it to pick up the new
  default.
