# 7. Chat is the mobile client's primary surface

Date: 2026-07-21

## Status

Accepted

Amends [ADR-0006](0006-mobile-terminal-bridge.md): the transport, pairing, and
security decisions there stand unchanged. What changes is what the phone shows.

## Context

ADR-0006 shipped a phone that mirrors and drives a live pty. Using it on real
hardware made the ceiling obvious: a 100-column TUI on a phone is a debugger,
not a remote control. You can read it, but you would not choose to work that
way.

The thing that already works for AFK operation is the Telegram bridge
(`src/main/telegram.ts`): it tells you something needs you, you answer in a
conversation, the agent continues. Its limits are that it is one global channel
for every repo, and that acting on anything real means going back to the Mac.

Meanwhile TerMinal already stores what a conversation needs. Every engine writes
a structured transcript — claude to `~/.claude/projects/**.jsonl`, codex to
`~/.codex/sessions/**.jsonl` — with user turns, assistant turns, and tool calls.
The pty is a rendering of that conversation, not the source of it.

## Decision

- **The phone's primary surface is a chat per session.** The terminal mirror
  stays, one tap away, as the escape hatch for anything the chat cannot express.
- **One thread per session, plus the HITL queue**, rather than Telegram's single
  global channel. Threads carry repo, branch, engine, and a "your turn" state.
- **`src/main/chat/messages.ts` is the engine seam** — the only place transcript
  parsing lives. It reads raw JSONL rather than the observability index, which
  is claude-only and skips sessions whose telemetry isn't `ready`; building on
  it would have produced silently empty threads for most sessions. An engine
  with no adapter reports `unsupported` so the UI offers the terminal instead
  of an empty conversation.
- **The composer is gated on session state.** Sending is possible only when the
  agent has finished its turn; while it is working the control becomes a stop
  button. Typing into a pty running a TUI is not "sending a message" — if the
  agent is mid-turn showing a prompt, free text answers *that*.
- **History costs nothing extra.** A finished session's transcript is still on
  disk, so past threads are addressed as `past:<sessionId>` and read through the
  same seam. They are read-only: a dead pty has nowhere to put a keystroke.
- **Push is an alert channel, not a parallel path.** `createPushChannel` joins
  telegram/desktop/webhook in the existing `dispatchAlert` fan-out, so anything
  that pings Telegram pings a paired iPhone with the same content and a
  deep-link to the thread.
- **APNs is sent by the Mac itself.** It signs an ES256 JWT with an APNs `.p8`
  and posts to `api.push.apple.com` over HTTP/2. No relay, no third-party
  service, no subscription — consistent with the zero-paid-services constraint.
  The phone hands over its device token on the already-authenticated bridge.

## Consequences

- Adding an engine means writing one adapter, not touching the bridge or client.
- Codex's JSONL is not a public contract. The adapter degrades to "no messages,
  open the terminal" rather than throwing, and fixture tests pin the shapes so a
  format change fails in CI instead of in your hand.
- Push needs a human step exactly once: APNs auth keys cannot be minted through
  any API. `ios/scripts/setup-push.sh` files the key and derives the config from
  `project.yml`. Until then the channel reports itself disabled and stays inert.
- Debug builds must talk to APNs sandbox and TestFlight builds to production.
  The environment is recorded per registered device, because getting it wrong is
  a silent delivery failure rather than an error.
- The chat is a poll, not a push, over the bridge (2s in a thread, 4s in the
  list). That is cheap for JSON of this size and avoids a second streaming
  protocol next to the pty SSE. If it ever costs too much, the SSE stream is the
  place to fold it into.
