# 18. The tracked `backlog/` is frozen history, not a second ticket system

Date: 2026-07-31

Status: accepted

## Context

Two ticket directories exist in this repo:

- **`backlog/`** — tracked, 41 markdown tickets, ids 0001–0049, created between
  2026-05-30 and roughly 2026-06.
- **`.TerMinal/backlog/`** — gitignored (`/.TerMinal/` in `.gitignore`), where
  every ticket filed today lands.

To a newcomer that reads as two competing systems, and stale tickets in a
tracked directory rot trust in the whole backlog. It is worth stating plainly
what each one is.

`src/main/project-layout.ts` already models this correctly and has since the v2
layout landed: `V1_REL.backlog = 'backlog'`, `V2_REL.backlog =
'.TerMinal/backlog'`, `detectProjectLayout()` returns `v2` for this repo, reads
merge **both** directories (`existingProjectAreaPaths`) and writes go **only** to
the detected layout's directory (`projectAreaPathForWrite`). So nothing is lost,
nothing new can land in the old directory, and no reader has to choose. What was
missing was the decision, in writing.

## Decision

**`backlog/` is frozen v1 history. It is never written to again, and it is not
deleted.**

- Not written to: the layout resolver already guarantees this. No process, agent
  or human files a ticket there.
- Not deleted: those 41 tickets are the only *public* record of the project's
  first month of work — the v2 backlog is gitignored, so deleting them would
  erase that history from the repo entirely.
- `.TerMinal/backlog/` is the one live backlog, and `docs/decisions/` is where
  its durable conclusions end up.

### What the reconcile actually found

The audit that prompted this expected ~42 *open* tickets, several of them
shipped-but-not-closed. That is not the state:

- **All 41 are already `status: closed`.** Nothing needed closing.
- **40 of 41 have `prs: []`.** Provenance lives in git history, not the
  frontmatter — e.g. `1dbf0d3 feat(budgets): ticket #0002`, `da2c9a4 feat(tray):
  ticket #0011`. Some were swept closed together in `72b1fdc chore: close
  completed backlog tickets` (2026-06-01) with no per-ticket commit.
- `backlog/.next-id` reads `37` while ids run to `0049` — another sign the
  counter stopped being maintained when the directory went dormant.

So **`closed` in this directory means "no longer tracked here", not "verifiably
shipped"**, and it should not be read as a completion record. Two of the
features it covers were built and *later removed* (the menu-bar tray; the
Cloudflare deploy poller, `c265ed5`), which is a normal outcome and not a
bookkeeping error.

## Consequences

- The trust problem is answered by labelling, not by deleting or by a migration:
  `backlog/README.md` says the same thing at the place someone stumbles on it.
- Anything in the old directory that is still genuinely wanted must be **re-filed
  in `.TerMinal/backlog/`** with today's evidence. Nothing is inherited by
  assumption. Re-litigating whether each 2026-05 idea is still wanted is explicitly
  *not* part of freezing the directory.
- Because reads merge both directories, those closed tickets still appear in the
  Tickets tab under a closed filter. That is intended — history should be
  visible — and is the reason `listTickets` skips non-`NNNN-` filenames, so a
  `README.md` can live alongside them.
- Downstream repos on the v1 layout are unaffected: `projectAreaCandidates`
  keeps `backlog/` working as the primary directory for them.
