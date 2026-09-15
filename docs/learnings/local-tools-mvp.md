---
title: Local diagnostics, path notes, and daily cost estimates
date: 2026-09-10
tags: [files, notes, cockpit]
---

Files → Run check is a manual action on saved files. It discovers the active
local repo's `check`, `typecheck`, and `lint` package scripts and installed
TypeScript/ESLint binaries. It never installs tools. Package scripts can execute
arbitrary project code, so the panel shows the command before the user runs it.
Main revalidates the displayed plan and repo, allows one check per repo, and
bounds execution to two minutes and captured output to 512 KB (32,000 characters
displayed). Remaining processes in the check's process group are killed on exit.
Results are ephemeral text; inline markers and LSP are outside this MVP.

Notes → Path notes stores one editable Markdown note for an exact repo-relative
file or folder path. It extends KnowledgeScope with a path and expected repo,
and uses the existing knowledge reader/writer with a SHA-256 path key under the
repo sidecar's `path-notes` directory. The key is lexical: slash/dot spelling is
normalized, traversal and absolute paths are rejected, and symlinks are not
followed. Notes survive deletion but do not follow renames. Repo/global knowledge,
scratch notes, and RAG scopes keep their existing behavior. Saves are explicit;
drafts survive switching between the Notes views, but must be saved before
leaving the Notes tab or closing the session. Remote path notes are unavailable in this MVP.

The optional AI cost per day cockpit widget is disabled by default and reuses
the local AI run ledger. It groups estimates by run start date, using local
calendar days, across all local repos. A long-running session's cost belongs to
its start date. The window covers today plus six prior calendar days, with a
visible notice when the latest 2,000-record cap may omit data. Missing records
are not reported as zero spend. These are ledger estimates, not billing totals;
coverage depends on the collectors and model prices, and subscription usage
may have no incremental charge.
