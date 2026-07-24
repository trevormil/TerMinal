# 8. Remote sessions register themselves; the phone never touches a terminal

Date: 2026-07-22

## Status

Accepted

Supersedes [ADR-0007](0007-chat-first-mobile-client.md). Amends
[ADR-0006](0006-mobile-terminal-bridge.md): its transport, pairing and
security decisions stand unchanged — what it says about *terminals* does not.

## Context

0006 gave the phone a mirrored pty. 0007 kept the pty but made a chat over the
engine's transcript the primary view. Both were built and used on real hardware,
and both were wrong in the same way: they had the phone reach *into* the Mac and
reconstruct what was happening.

That inversion cost a lot. Streaming raw pty bytes needed SSE, a terminal
emulator on the phone, and geometry mirroring. Rendering a conversation needed a
transcript adapter per engine, and each adapter needed to know that engine's
private JSONL shape — claude's `isSidechain`, codex's injected `AGENTS.md`
turns, Claude Code's `[Request interrupted by user]` control text. Every one of
those was a bug found by looking at real data, not by testing.

It also produced the wrong product. A 100-column TUI on a phone is a debugger.
And the phone saw every pty, including the dozens you never wanted to supervise.

The thing that already worked for going AFK was the Telegram bridge: the agent
*tells you* what matters and you answer. The agent knows what is worth
reporting; a scraper never will.

## Decision

- **A session opts in.** Running `/remote-terminal` registers it via
  `terminal-cli remote register`. Sessions that never register are invisible to
  the phone. Several can register at once, each its own thread.
- **The agent is the participant, not the subject.** It calls `post` for
  updates and `ask` when it needs an answer. Nothing is scraped.
- **No pty access at all.** No streaming, no terminal emulator, no writing to a
  terminal's stdin. Deleted: SwiftTerm, the SSE stream, `/v1/sessions/:key/*`,
  and both transcript adapters.
- **State is two files per session** under `~/.config/TerMinal/remote/`: a JSON
  record and an append-only JSONL log. No database, and the store is readable
  by a plain shell script — which is what makes the CLI self-contained.
- **Replies queue behind a delivery cursor.** A message sent while the agent is
  busy is handed over at its next check rather than requiring the agent to be
  blocked at that moment, and is handed over exactly once.
- **Delivery is automatic.** A Stop hook (`remote-check.sh`) runs as a session
  ends a turn and blocks the stop to hand over anything waiting, so a reply is
  never left unread. Manual `check` remains for long stretches with no turn
  boundary.
- **HITL stays a separate queue.** Registered sessions are conversations you
  opted into; HITL is the cross-repo "something is blocked" feed that cron jobs
  and unregistered agents also file into.

## Consequences

- Engine-agnostic by construction. Nothing in the bridge or the client knows
  what an engine is, so a new one needs no adapter. The three transcript bugs
  above become structurally impossible.
- Much smaller: the bridge went from ~586 lines to ~290, and the change removed
  about 2,100 lines net.
- You only see what you asked to see, and the agent decides what is worth
  saying. Report quality is now a *prompt* problem — the skill's wording is the
  product, and a badly-written skill means a noisy or silent thread.
- An unregistered session is unreachable from the phone. That is the point, but
  it means forgetting to run the skill looks identical to the feature being
  broken.
- The Stop hook runs on every turn of every session, so it must be silent and
  cheap when there is no registration. It resolves `terminal-cli` from the repo
  first, because the copy in `~/.config/TerMinal/bin` is only synced at release
  and can predate the `remote` subcommand.
- Nothing carries over from an old session: the pty is no longer addressable, so
  history and resume (0007) are gone rather than reimplemented.
