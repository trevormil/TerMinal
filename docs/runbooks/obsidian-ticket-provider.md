---
title: Configure Obsidian ticket provider
last-verified: 2026-07-11
anchor: RB-obsidian-ticket-provider
---

# Configure Obsidian Ticket Provider

TerMinal can store a repo's tickets in an Obsidian vault instead of the repo's
`backlog/` directory. The provider is per repo and is recorded in the repo's
gitignored `.TerMinal/tickets.json` file. Ticket files stay markdown with the
same `NNNN-slug.md` naming and frontmatter shape used by the local backlog
provider.

## New Repos

1. [RB-obsidian-ticket-provider#1] In the session picker, choose **New project
   template**.
2. [RB-obsidian-ticket-provider#2] Select **Obsidian** in the Tickets row.
3. [RB-obsidian-ticket-provider#3] Choose the vault location:
   - **Sibling** creates `<parent>/<name>-vault` next to the new repo.
   - **In repo** creates a gitignored `tickets-vault/` inside the repo.
   - **Existing** uses the selected vault folder.
4. [RB-obsidian-ticket-provider#4] Create the project. TerMinal writes
   `.TerMinal/tickets.json`, adds the necessary gitignore entries before the
   first commit, creates the vault's `tickets/` folder, and seeds the vault
   helper files.

## Existing Repos

1. [RB-obsidian-ticket-provider#5] Attach a session to the repo.
2. [RB-obsidian-ticket-provider#6] Open **Settings -> Tickets**.
3. [RB-obsidian-ticket-provider#7] Set provider to **Obsidian**, pick a vault
   folder, and save.
4. [RB-obsidian-ticket-provider#8] Use the provider test in Settings when you
   need to verify the vault is writable. The smoke test creates, updates, and
   closes a safe test ticket in the configured vault.

## Files TerMinal Creates

Within the vault, `scaffoldObsidianVault` creates:

- `tickets/` for ticket markdown files.
- `_TerMinal.md` with the vault's TerMinal conventions.
- `_Boards/Tickets.md`, a Dataview board over the ticket folder.
- `_Templates/Ticket.md`, a Templater-compatible ticket template.

Dataview and Templater are optional Obsidian community plugins. TerMinal does
not require either plugin to read or write tickets.

## Agent And CLI Behavior

Agents and scripts should use TerMinal ticket tools or `terminal-cli ticket`
commands. Those commands route through the configured provider, so Obsidian
repos write to the vault rather than to `backlog/`.

Interactive sessions launched for an Obsidian-backed repo receive:

- `OBSIDIAN_VAULT_PATH`: the configured vault folder.
- `OBSIDIAN_TICKETS_DIR`: the ticket folder, normally
  `$OBSIDIAN_VAULT_PATH/tickets`.

Use those environment variables only for raw browsing or manual file inspection.
Do not create repo-local `backlog/` tickets for an Obsidian-backed repo unless
you are intentionally migrating provider state.

## Moving A Vault

1. [RB-obsidian-ticket-provider#9] Move the vault folder in Finder or with
   shell tools.
2. [RB-obsidian-ticket-provider#10] Reopen **Settings -> Tickets** for the repo.
3. [RB-obsidian-ticket-provider#11] Update the Obsidian vault path and save.
4. [RB-obsidian-ticket-provider#12] Run the provider test to confirm the new
   path is writable.

`.TerMinal/tickets.json` is intentionally gitignored, so every machine that uses
the repo can point at its own local vault path.
