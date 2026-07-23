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
- [x] APNs key installed (AuthKey_Z63G85LJTK) + verified end-to-end: real
      sendPush → APNs sandbox → phone lock screen (sent:1, failed:0).

## Queued (newest)
- [x] Fix medium review regression: WorkspaceView/New Session + push tap didn't
      open the thread after the RootView TabView restructure (in progress).
- [x] Inbox = real email UX (desktop + phone): drop the dashboard/filter feel,
      subject-only list → click/hover for full body, render markdown/line breaks.
- [x] Severity tags in the email UX + CONFIGURABLE notify rules in Settings:
      urgent/emergency always pings; normal+low are email-style (async). Add a
      notify-threshold setting. 3-tier: urgent | normal | low.
- [x] Clear the app icon badge when the inbox is read (iOS keeps it until the app resets it via setBadgeCount).
- [x] GENERICITY PASS: audit everything for machine-specific hardcoding (Trevor's
      paths/names/hosts). Make settings customizable where needed so any TerMinal
      user can download + use it. (harness scanRepos root, any hardcoded paths, etc.)
