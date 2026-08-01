---
title: 'Sandboxing the config dir sandboxed state, not side effects'
date: 2026-07-31
tags: [testing, isolation, notifications, activity-feed]
anchor: LRN-effect-isolation
---

# Test isolation covers state, not effects

## [1] The gotcha

`TERMINAL_CONFIG_DIR` (see `src/main/config-dir.ts`) points every state module at
a throwaway directory under test, and it works: after a full suite run the real
`~/.config/TerMinal/hitl.json` contains nothing a test wrote.

The operator still got two phone notifications per suite run.

`fileHitl` does more than write a file. It calls `emitActivity`, and
`src/main/events.ts` resolved the feed as `join(homedir(), '.config',
'TerMinal', 'activity.jsonl')` — outside the seam. The two events landed in the
**real** feed; the running app tails that file, treats anything it did not emit
in-process as an external event worth alerting on, and mirrors it to desktop,
Telegram and the phone. The test never touched a notification API. The app
notified on its behalf.

`alwaysPingTelegram` was the second channel, and worse: it POSTs the Bot API
*deliberately ignoring* the `telegram.notify` toggle, because a genuine blocker
should reach you even when the feed is muted. That is correct for production and
means no config-level opt-out can ever silence it from a test.

## [2] The invariant

**A state seam is not an effect seam.** Isolating where bytes land says nothing
about who gets told. Anything that leaves the process — an HTTP request, a
spawned notifier, a file another process is watching — needs its own refusal.

`src/main/effect-guard.ts` is that refusal. Every outbound sink asks
`blockEffect()` first, and under test (`NODE_ENV=test`, which `bun test` sets,
plus `TERMINAL_BLOCK_EFFECTS=1` from `src/test-preload.ts` as an independent
signal) the answer is always no. There is deliberately **no** env var that turns
it off: an escape hatch is how test traffic reaches a real phone again.

## [3] Watch for

- **A file another process watches is an effect, not state.** The activity feed
  looked like a log. It is an outbound channel with a subscriber.
- **Guard the default transport, not the fan-out.** `dispatchAlert` and the
  channel builders take injectable `fetchFn`/`spawnFn`; the guard sits on the
  *defaults*, so a channel built the way `events.ts` builds it cannot reach the
  network, while a unit test injecting its own stub still exercises the real
  logic.
- **`bun run test:effects`** (`scripts/effect-canary.ts`) is the canary: it runs
  the full suite with `HOME` pointed at a throwaway dir and `fetch` wrapped, then
  fails if a single non-loopback request or activity event escaped. Against the
  commit that shipped this bug it reports `2 activity event(s)` — `HITL · one`
  and `HITL · two`, the two pings the operator was getting.
