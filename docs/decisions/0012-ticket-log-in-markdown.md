# 12. The ticket comment log lives in the ticket markdown

Date: 2026-07-27
Status: accepted

## Context

Tickets carried prose, frontmatter, and acceptance criteria, but nowhere to
record what a *run* learned. An agent would implement `#0042`, discover three
things worth knowing — a library that doesn't work in CI, a dead end already
explored, a decision about scope — open a PR, and exit. The next run on the
same ticket started cold and rediscovered the same dead ends.

Linear-style comments were the obvious shape to borrow, but the reason they
matter here is different. Linear's comments are humans talking to humans;
TerMinal is local-first and single-operator, so there is no team to notify.
What the log is actually for is **durable per-ticket context between runs** —
agents already read the ticket file, so anything written there reaches the next
run for free.

That reframing decides the storage question. A sidecar store (JSON next to the
backlog, or under `~/.config/TerMinal`) would need explicit plumbing into every
agent prompt to be useful, and would silently desync whenever a ticket is edited
by hand or through the Obsidian vault.

## Decision

**The log is a `## Log` section inside the ticket's own markdown**, parsed out
of the body into `Ticket.comments`. Entry headers are
`### <ISO-8601> · <author>` for humans and
`### <ISO-8601> · agent:<id> (<engine>/<model>)` for agent runs.

- **Prose and log are split on read.** `Ticket.body` is prose only, so the log
  never leaks into a prompt twice or into the ticket's own description.
- **Parsing is conservative.** Only a line matching the full header shape is a
  delimiter, and a `## Log` inside a fenced code block is ignored. An agent
  pasting markdown containing `### Root cause` must not split its own comment in
  two, and a ticket documenting this very format must not corrupt its own parse.
- **Appending never parses.** Writers only need to know whether a log has been
  opened, so the parser lives in exactly one place (`ticket-comments.ts`) even
  though four writers exist.
- **Agents write through tools, not the file.** `comment_ticket` (MCP) and
  `terminal-cli ticket comment <slug> "<body>"` (script bodies) stamp the author
  and engine/model from the run's environment.
- **Remote providers keep their own thread.** GitHub and Linear tickets map
  their platform comments into the same shape on read, and writes go to the
  platform's comment API — the thread stays where that platform's UI shows it.
  An agent's identity rides in the body, since those platforms attribute every
  comment to the authenticated account.
- **Relations, added alongside, follow the same "don't store what you can
  derive" rule.** `related` and `duplicate_of` are frontmatter; `blocks` is
  **not** — it is derived from every other ticket's `depends_on`, so the two
  directions of one dependency cannot drift apart the way two hand-maintained
  lists would.

## Consequences

- The whole comment history lands in `git log` with no extra plumbing, and
  `git blame` attributes it — for local and Obsidian tickets alike.
- A ticket's implementation prompt replays prior entries (`promptLogBlock`), so
  a run inherits what earlier runs learned. This is the payoff; without the
  replay the log would be write-only.
- **Lanes must not write.** Concurrent lanes share one ticket, so only a solo
  run is instructed to leave an entry — parallel writes would race.
- The remote-workspace script (`REMOTE_SCRIPT` in `remote.ts`) cannot import, so
  it carries a hand-kept copy of the format. Round-trip tests against the real
  script are what keep it honest.
- A ticket file is now append-heavy. Nothing truncates the log yet; if one grows
  long enough to bloat a prompt, the replay is the place to cap it, not the
  store.
