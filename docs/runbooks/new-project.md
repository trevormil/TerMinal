---
title: Spin up new project from project-template
last-verified: 2026-07-11
anchor: RB-new-project
---

# New project from project-template

TerMinal vendors [project-template](https://github.com/trevormil/project-template)
as the `templates/project-template` git submodule and can scaffold a brand-new
repo from it. Scaffolding never overwrites an existing directory: the target
path must not already exist.

## App

1. [RB-new-project#1] Launch TerMinal (`bun run dev` from source, or the
   installed app) and open the session picker.
2. [RB-new-project#2] Choose **New project template**, enter a project name,
   and optionally pick a parent folder. The default parent is the configured
   projects directory; if that setting is blank, TerMinal falls back to the
   home directory.
3. [RB-new-project#3] Pick a ticket provider for the new repo:
   - **Local backlog** writes ticket markdown into the repo's `backlog/`.
   - **Obsidian** writes ticket markdown into a private vault and stores the
     per-machine pointer in `.TerMinal/tickets.json`.
4. [RB-new-project#4] If you picked Obsidian, choose where the vault should
   live:
   - **Sibling** creates `<parent>/<name>-vault` next to the repo. This is the
     default.
   - **In repo** creates a gitignored `tickets-vault/` folder inside the repo.
   - **Existing** points at an existing vault folder you select.
5. [RB-new-project#5] Click **Create**. TerMinal copies the template, applies
   ticket-provider config and gitignore rules, runs `git init` plus the first
   commit, then opens a session in the new repo.

If the target folder already exists, scaffolding fails before writing the new
repo. Pick a new name or parent directory and retry.

GitHub Issues and Linear are not offered during bootstrap. Configure them later
from **Settings -> Tickets** after the repo exists.

## Terminal

```bash
bin/new-project my-app
bin/new-project my-app /path/to/parent
```

The terminal helper scaffolds from the same template path and creates the repo
under the configured projects directory unless you pass an explicit parent.

Then create the remote when ready:

```bash
cd <dest>
# fill CLAUDE.md placeholders first
gh repo create <name> --source=. --private --push
```

## Keeping Template In Sync

Both scaffolders try `git pull --ff-only` against the local template submodule
before copying, so fresh scaffolds track the maintained template even when this
repo's submodule pointer is behind.

To bump the committed submodule pointer in TerMinal:

```bash
git submodule update --remote templates/project-template
git add templates/project-template
git commit -m "chore: bump project-template"
```

## Template Resolution

- Development/source runs use the local submodule at `templates/project-template`.
- Packaged app runs do not bundle the submodule, so `scaffoldProject` falls back
  to a shallow clone of the configured template repo.

Both paths skip `.git`, `.gitmodules`, `node_modules`, and the template's
top-level `modules/` catalog while copying.
