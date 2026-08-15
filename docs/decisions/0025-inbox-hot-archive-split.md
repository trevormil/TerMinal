# 25. The Inbox is a small hot file plus an append-only archive

Date: 2026-08-14

Status: accepted

Keeps the file name and location fixed by
[ADR-0020](0020-workflow-state-in-a-per-project-sidecar.md): `hitl.json` stays
`hitl.json` in `~/.config/TerMinal/`. Only its contents changed.

## Context

`hitl.json` was one JSON array holding every Inbox item ever filed. A daily
retention sweep moved items older than 60 days into `hitl-archive/hitl-<day>.json`,
which is a policy, not a bound — a real inbox still reached **6057 items / 4.8 MB**,
of which **3 were live**.

Everything paid for all of it:

- The drawer badge polled the whole list every 5 seconds to produce one integer.
- The Inbox tab re-fetched the whole list every 15 seconds.
- Resolving one item rewrote all 4.8 MB.
- The iOS bridge, the Telegram commands and the MCP `harness_status` rollup each
  re-parsed the file for their own filter.

Five processes write this file (the app, `terminal-cron`, `terminal-cli`,
`terminal-mcp-server`, and the hand-written remote-host script), so any fix had
to keep the existing advisory lock semantics intact rather than introduce a
second storage engine beside them.

## Decision

**Split the file by liveness, not by age.** `src/shared/inbox-store.ts` is the
one module that reads and writes the Inbox, and every process goes through it.

| file | contents |
|---|---|
| `hitl.json` | LIVE items only — unread and unresolved. Still a plain JSON array. |
| `hitl-archive.jsonl` | one JSON object per line, **append-only**. |
| `hitl-counts.json` | live / unread / archived totals and per-category counts. |
| `hitl-archive-hidden.json` | ids removed from the append-only archive. |

An item is live while `!readAt && status !== 'resolved'` — the inverse of the
app's existing `isHitlRead`, so both spellings of "dealt with" retire an item.

Four properties follow:

1. **Archiving is an append.** Retiring one item costs one `appendFileSync`, not
   a rewrite of everything else. This is why the archive is JSONL and not a
   second JSON array.
2. **Append-only means byte offsets are stable forever**, which is what lets
   history pagination use a plain byte offset as its cursor. The reader walks
   the file backward in 64 KB blocks, so "the newest 50" costs one block read
   rather than a full parse. Nothing ever rewrites the archive — removal is
   recorded as a hidden id instead, which is also why compaction is not offered.
3. **Badges read the index, never the items.** `hitl-counts.json` is written
   inside the same locked write that changed the items, so it cannot drift.
4. **Migration is the steady state, not a step.** A hot file containing
   non-live items is split on the first locked touch. An oversized legacy
   `hitl.json` therefore converts itself the first time anything reads or writes
   it (25 ms for the real 6057-item file), and the pre-split
   `hitl-archive/hitl-<day>.json` directory is folded into the JSONL on the same
   pass so no history is lost.

### Crash order

Every write happens inside the SAME advisory lock as `hitl.json` — the one the
five processes already contend for — in this order:

```
append archive → write hidden ids → rewrite hot → write counts
```

At every prefix of that sequence an item is present in the hot file, the
archive, or both, never neither. Duplicates are the tolerated failure mode:
readers dedup by id and keep the newest occurrence, and an id that is live in
the hot file is hidden from history entirely.

## Consequences

- The 60-day retention window is **gone**. `archiveHitl()` in the cron runner is
  now a flush that finishes a pending split, not a sweep with a policy;
  `archiveResolvedHitl()` in `src/main/run-retention.ts` was deleted rather than
  left as a second archiver writing a second format.
- Read items no longer appear inline in the drawer. They move to a **History**
  section that lazily loads pages of the archive. The drawer keeps items you
  read in the current session pinned in place so a row does not vanish
  mid-read.
- Two new IPC channels, `inbox:counts` and `inbox:archive`, each with the
  permanent `hitl:` alias the rename contract requires.
- `src/main/remote-host-script.cjs` was deliberately NOT taught the new format.
  It only ever lists, resolves and removes items that still want a human, and
  all of those are live. It keeps taking the same lock; an item it marks read
  waits in the hot file until the host's own retention pass flushes it.
- Reopening or removing an item that has already been archived is the one
  gesture that reads backwards, so those call sites name the ids explicitly
  (`updateInbox(..., { include })`). Marking read never scans history.
