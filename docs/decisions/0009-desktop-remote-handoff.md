# 9. One session, two surfaces: desktop ⇄ remote handoff is forgiving

Date: 2026-07-22

## Status

Accepted

Builds on [ADR-0008](0008-remote-sessions-register-themselves.md) (a session
opts in via `/remote-terminal`).

## Context

A session is meant to move between the desktop and the phone freely: work at the
Mac, register it to the phone before stepping out, drive it remotely, then come
back to the desktop. In practice the handoff was flaky. The root cause was that
the lifecycle CLI treated a missing session as a hard error:

- Deleting a thread from the phone while the desktop agent kept working meant its
  next `terminal-cli remote post --id X` hit `resolveRemoteId` → `readRemote(X)`
  null → `process.exit(1)`. The delete didn't stop the listener; it **crashed
  the agent's command** on the next report.
- `remote end` on an already-ended or already-deleted session errored the same
  way, so "toggle remote off" was itself an error.
- There was no way for a human or agent to ask "is this session still on the
  phone?" and no obvious symmetric on/off.

Switching surfaces is a routine, expected action. It must never throw.

## Decision

The handoff is **one session with two surfaces**, and every lifecycle operation
is idempotent and non-fatal:

- **`resolveRemoteId` gains a `soft` mode.** `post`/`ask`/`end`/`status` use it:
  a missing session returns `''` instead of exiting 1.
- **`post` to a gone session** prints a soft notice and exits 0 — the post is
  dropped, the turn continues. Deleting from the phone just means "not remote
  anymore".
- **`ask` a gone session** behaves like a timeout: no stdout, exit 3 — the agent
  picks its safe default and carries on (same contract as a real timeout).
- **`end` / `off`** (aliases) are idempotent: ending an already-ended or deleted
  session succeeds silently. `off` is the "come back to the desktop" verb.
- **`status`** prints `working | awaiting | ended | none` so a human or agent can
  see where a handoff stands.
- **Re-`register --id X`** turns the listener back on and resumes the same thread
  — go remote again mid-session at will.
- The blocking Stop-hook wait already re-checks the session each 2s and unparks
  within a couple of seconds when it's deleted (`waitForReplies` bails on a
  missing session), so a currently-parked session releases cleanly on delete.

## Consequences

- Deleting a thread from the phone is a safe, first-class way to stop remoting a
  session — the desktop agent degrades to local silently rather than erroring.
- "Toggle remote off/on" is symmetric and never fails, which is what makes moving
  between surfaces feel seamless.
- The skill documents the whole flow (register → run → go remote → come back with
  `off` → resume with `register`), and states plainly that nothing in the handoff
  can crash a turn.
- Read-state and severity (the inbox revamp) are orthogonal to this and unchanged.
- Not addressed here: a desktop *UI* affordance to see/toggle which sessions are
  on the phone. Today that's driven from the agent/CLI; a desktop indicator is a
  reasonable follow-up but wasn't needed to fix the flakiness.
