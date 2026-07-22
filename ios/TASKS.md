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

## In progress
- [ ] **Push notifications on every new inbox/HITL item** (this PR)
  - Q: sessions kept alive enough? → NO need: HITL/inbox creation flows through
    the desktop main process, which is always running when the Mac is awake and
    sends APNs directly. Not session-dependent. Requirement: Mac awake + APNs key
    + a registered device.
  - Verify current firing, make sure EVERY new HITL/inbox item pushes.

## Queued (newest asks)
- [ ] **Inbox revamp**
  - a) Persist + show ALL items with read/unread tags (today only open items
       show; resolved ones vanish). Add filters. Do it on desktop AND terminal
       remote.
  - b) Severity levels: `push` (highest, notifies) vs `normal` (inbox-only
       fallback, user checks 1–2×/day). Support both; wire into existing
       inboxes + notifications.

- [ ] **Seamless desktop ↔ remote handoff** (this PR)
  - Move between a desktop session and a remote/listener session and back with
    no friction. Fix flakiness: turning listeners on/off, delete/remove,
    unregister. Think through the whole lifecycle: register → run → go remote →
    come back → stop. One session, many surfaces.

## Parked / needs human
- [ ] APNs key: created once in Apple portal (no API). Push is inert until the
      .p8 + apns.json are dropped in ~/.config/TerMinal/bridge/. (ios/scripts/setup-push.sh)
