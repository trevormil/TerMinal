# Running task list — TerMinal Remote + related

Live scratchpad so nothing thrown my way gets dropped. Newest asks at the bottom.

## Done (this PR / session)
- [x] Terminate/delete sessions from the phone
- [x] Per-repo workspaces (Sessions/Tickets/PRs/Runs/Schedules) + global Inbox
- [x] Drill-downs: ticket bodies, PR diffs/review/findings/CI, run logs, prompts
- [x] Chat UX: real newlines/paragraphs + copy-message
- [x] Stop hook no longer hangs ordinary sessions (origin gate)
- [x] All engines w/ logos, recent-first repos, Scratch, proper casing
- [x] Cursor Router — SEPARATE PR #122 off main (live model catalog)

## Done (cont.)
- [x] **Push on every new HITL** — already wired (createPushChannel); severity
      'push' sets notify=true so every push item fires it. Inert only until the
      APNs key is added. Not session-dependent (desktop main process fires).
- [x] **Inbox revamp** — ALL items, read/unread + Unread/Open/Resolved/All
      filters + severity (push/normal), desktop AND phone; badge = unread.

- [x] **Seamless desktop ↔ remote handoff** — lifecycle is idempotent + never
      crashes a turn. post→soft-skip, ask→safe-default, end/off→idempotent,
      status verb, re-register resumes. ADR-0010 + skill (×4). The delete-crash
      was the root flakiness.

## Pending (not code)
- [x] Install build 25 (inbox revamp + handoff) to the phone

## Parked / needs human
- [ ] APNs key: created once in Apple portal (no API). Push is inert until the
      .p8 + apns.json are dropped in ~/.config/TerMinal/bridge/. (ios/scripts/setup-push.sh)
