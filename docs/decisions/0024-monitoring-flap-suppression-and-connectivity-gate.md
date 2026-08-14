---
anchor: ADR-0024
status: accepted
date: 2026-08-13
---

# [24] Monitoring suppresses flaps and pauses when WE are the ones offline

## [24.1] Context

Over a week of real use, essentially every "is down" the Inbox received was
noise, and it arrived in two distinct shapes that look identical in the state
file:

- **Their end, briefly.** One blown probe — no response once, HTTP 200 on the
  next check. `needsConfirmation` already re-probes once *within* a tick, which
  catches the sub-second blip, but not a laptop sleep/wake or a Wi-Fi hiccup
  that spans both probes. Each one filed an urgent item plus a recovery item.
- **Our end, entirely.** The operator's own uplink drops and *every* monitor
  fails at once. No per-monitor threshold helps here: each monitor genuinely
  fails N times in a row, so a threshold just delays a burst of N × urgent
  items about services that are perfectly healthy.

## [24.2] Decision

Two mechanisms, deliberately separate, both living as pure functions in
`src/shared/monitor-flap.ts`:

1. **Per-monitor `minConsecutiveFailures` (default 2).** A monitor is published
   as down — and alerts — only after N checks fail in a row. The threshold
   guards the ok→bad promotion **only**: warn→fail escalation and recovery to
   ok are believed on the first check, because delaying "it got worse" or "it's
   back" helps nobody. `1` restores the old alert-on-first-failure behaviour.
   Absent on every monitor written before the field existed, so it is read
   through `normalizeMinConsecutiveFailures` (migrate-on-load, clamped 1–10),
   never raw.

2. **A local-connectivity gate.** A cycle in which *every* monitor failed and
   *every* one of those failures was network-layer (dns / unreachable /
   timeout) is only a **suspicion** — it earns two reference probes against
   independent majors. Confirmed offline only when those also fail at the
   network layer. While offline the whole cycle is discarded: no counters, no
   transitions, no alerts, no notifications. Resume is automatic.

Both are gated on a **failure category** (`dns`, `refused`, `unreachable`,
`timeout`, `tls`, `http-status`, `body`, `command`, `unknown`) that every probe
now reports. The category also earns its keep in the UI and the alert text: an
alert that says "their end returned an error status" and one that says "no
network path to the host" call for opposite reactions, where "is down" called
for a guess.

## [24.3] Consequences and the invariants that hold it up

- **A failure that proves connectivity can never vote for a local outage.** An
  HTTP status, a refused port, a bad certificate — all mean our packets made the
  round trip. One of them anywhere in the cycle settles it as their problem.
  `unknown` is likewise excluded. This is what stops the gate from muting a real
  outage that happens to take several targets down at once.
- **No reference evidence ⇒ no pause.** An empty reference result is treated as
  no evidence, not as confirmation.
- **Counters do not survive a pause.** They are reset, not frozen: one failure
  before the outage plus one after must not add up to a transition, because the
  pre-outage failure was plausibly the leading edge of our own outage. A
  genuinely-down target re-earns its alert within N checks of resuming.
- **Suppression is visible, never silent.** The raw probe verdict is kept in
  `observed`, and the row/detail render `blip N/M` from it. A threshold that
  hides its own state is indistinguishable from a broken monitor.
- **Pause is Activity, not Inbox.** A local outage is something the operator is
  already looking at; a notification for it would be the very spam this removes.

## [24.4] The Bun ambiguity this exposed

Bun's `fetch` reports an unresolvable name and a refused port as the *same*
opaque error (`ConnectionRefused` / `FailedToOpenSocket`, no `cause`). Taken at
face value every HTTP probe failure would categorise as `unknown`, so the gate
would never see a network-layer failure and could never pause an all-HTTP
setup — i.e. every real one. `categorizeError` deliberately still returns
`unknown` for it (guessing "unreachable" would let a refused port mute a real
outage); the daemon disambiguates with a name lookup, on the failure path only.

## [24.5] Duplication, on purpose, for now

`bin/terminal-monitor` runs from `~/.config/TerMinal/bin` under launchd and
cannot import from the app bundle, so the pure logic is mirrored there the same
way the classifiers already are. Both copies are exercised: the canonical one by
`src/shared/monitor-flap.test.ts`, the daemon's by
`src/main/monitor-threshold.test.ts` and `src/main/monitor-connectivity.test.ts`,
which drive the real binary. The typed-bin refactor is where the two collapse.
