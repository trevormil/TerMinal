# 6. Mobile terminal bridge over pinned HTTPS, terminals only

Date: 2026-07-21

## Status

Accepted

Supersedes the PWA framing in `backlog/0034-mobile-remote-control-pwa.md`.
Amended by [ADR-0007](0007-chat-first-mobile-client.md), then by
[ADR-0008](0008-remote-sessions-register-themselves.md), then on 2026-07-23
by the tailnet auto-pair amendment below (a second unauthenticated route,
`/v1/pair`). Every transport, pairing and security decision below still
holds. The terminal decisions do not:
0008 removed pty access entirely in favour of sessions that register
themselves.

## Context

Ticket 0034 captured the shape of a phone-sized TerMinal remote: a mobile-
responsive PWA served from the main process, read-only over runs / HITL /
tickets / schedules / activity, reachable over the tailnet while the Mac is
awake. It was iceboxed by design.

Revisiting it, the goal sharpened: the point is not a read-only dashboard, it
is **driving a live agent session from the phone**. That reframes every choice.

- A PWA renders a live TUI badly. Claude Code and Codex use the alternate
  screen with heavy redraw; without real terminal emulation the output is a
  garbled mess, and a browser gives no good way to send Esc, Ctrl-C, or arrows.
- Once you can talk to a live session, the *session* answers questions about
  tickets, PRs, and CI. Bespoke read-only screens for those are redundant
  surface area — more code, more endpoints, more to keep in sync.

Connectivity is a home LAN plus a tailnet; there is no relay and the Mac must
be awake either way. The transport carries terminal output, which routinely
contains secrets, and accepts input that executes commands.

## Decision

- **Native iOS app, not a PWA.** SwiftUI + SwiftTerm (MIT, pinned), living at
  `ios/` in this repo so the wire protocol and its only client change together
  in one commit. Distributed via internal TestFlight; no App Store submission.
- **Terminals only.** The bridge exposes exactly three authenticated routes:
  list sessions, stream one session, write to one session. HITL, tickets, and
  PRs get no endpoints — ask the agent. *(Superseded: 0007 added a chat surface,
  and 0008 removed the terminal routes altogether. Tickets and PRs still have no
  endpoints.)*
- **A second transport, never a second backend.** `bridgeBroadcast()` hangs off
  the existing `proc.onData` in `src/main/index.ts` alongside the renderer send
  and the session log. The bridge owns no session state.
- **HTTPS with a self-signed certificate, pinned by fingerprint.** The pairing
  QR carries base64 SHA-256 of the DER certificate; the client accepts that one
  and refuses to fall back. This is stronger than CA validation for a private
  address — no third party can issue a certificate the client would trust.
- **Bearer token on every route but `/v1/health`**, compared with
  `timingSafeEqual` over digests. `/v1/health` exists only so the client can
  race candidate addresses, and reveals nothing but "a bridge is here".
- **Token and TLS key live at `~/.config/TerMinal/bridge/` (0600), not in
  `settings.json`.** Settings seals secrets through Electron `safeStorage`,
  which *drops* the value entirely when OS encryption is unavailable (unsigned
  and dev builds) — a paired phone would silently stop working after a restart.
- **SSE downstream, plain POST upstream.** No WebSocket dependency on the Mac,
  and the client uses `URLSession.bytes` directly.
- **Off by default.** Nothing binds a port until the Settings toggle is on, and
  `will-quit` releases it.
- **The phone mirrors geometry; it never resizes the pty.** It renders at the
  desktop's cols×rows in a zoomable scroll view. Resizing would rewrap the
  terminal the human is looking at on the Mac.

## Consequences

- The Mac must be awake and reachable. Accepted: same constraint the icebox
  ticket set, and `ssh tm` still covers the headless case.
- Rotating the token unpairs every device. That is the intended kill switch.
- Certificate pinning means regenerating the bridge identity forces a re-pair.
- Reading tickets/PRs on the phone now costs a sentence to the agent instead of
  a tap. Accepted deliberately — if that proves annoying, the follow-up is a
  screen, not a new backend.
- The QR contains the bearer token, so it is as sensitive as a password. The
  Settings pane says so, hides the text form behind a reveal, and offers
  rotation.
- Off the tailnet and off the LAN, nothing works. There is no relay, and adding
  one would change the security model entirely — it would need its own ADR.

## Amended 2026-07-23 — tailnet auto-pair route

"Bearer token on every route but `/v1/health`" gains one deliberate second
exception: **`GET /v1/pair`**, the tailnet auto-pairing bootstrap.

- **Why it cannot be bearer-authenticated:** the whole point of the route is to
  hand the token to a phone that does not have one yet. Requiring the token
  would be circular; requiring the QR would defeat zero-QR pairing.
- **What gates it instead:**
  - the request must arrive over the tailnet — the socket's remote address is
    pre-checked against the CGNAT range (100.64.0.0/10) Tailscale uses, using
    the kernel's view of the peer, not anything the client claims;
  - `tailscale whois` must identify the peer as a node owned by the **same
    tailnet user that owns this Mac** (`tailscalePeerAllowed` in
    `src/main/bridge/tailscale.ts`). Any failure — unknown peer, tailnet down,
    different user — is a refusal, never an accidental grant;
  - the route is rate-limited, so it cannot be used as a probe or brute-force
    surface.
- **Why this is sound:** the request rides inside the WireGuard tunnel, which
  is already encrypted and mutually authenticated — the tailnet identity *is*
  the shared secret. Everything after pairing uses the bearer token normally.
- When Tailscale is unavailable the route answers 501 and QR pairing remains
  the only path. The pinning, token, and storage decisions above are unchanged.
