// Canonical activity kinds — workflow checkpoints emitted by the app AND by the
// skills (the tm plugin's bin/activity + bin/gt-notify emit these by
// name). Keep in sync with src/renderer/src/lib/types.ts and the tab's ICON/tone
// maps. Unknown kinds still render (Info icon + mute tone fallbacks).
export type ActivityKind =
  | 'session-start'
  | 'session-end'
  | 'deploy'
  | 'ticket-filed'
  | 'ticket-closed'
  | 'pr-opened'
  | 'pr-verdict'
  | 'pr-merged'
  | 'tests-pass'
  | 'tests-fail'
  | 'check'
  | 'doc'
  | 'agent-run'
  | 'task-complete'
  | 'blocked'
  | 'error'
  | 'info'

export type ActivityEvent = {
  id: string
  ts: number
  kind: ActivityKind
  title: string
  detail?: string
  repo?: string
  repoRoot?: string
  sessionId?: string
  // join keys for cycle-time linkage: connect a ticket's events across its life
  // (ticket-filed → pr-opened{ticket,pr} → pr-verdict{pr} → pr-merged{pr}).
  ref?: { ticket?: number; pr?: number }
  // Pointer back to the originating cron / in-process run, so clicking the
  // event in the Activity tab can jump to that run's log in the Runs tab.
  runId?: string
  runSource?: 'cron' | 'agent' | 'bg' | 'session'
  // Set when the event is a HITL filing — drives the inline Telegram buttons
  // ([Resolve] / [View run]) so the user can act from the chat without
  // having to text /hitl + /resolve.
  hitlId?: string
  // Set by HITL producers that already send a direct Telegram message. The
  // activity event should still hit the in-app feed and desktop notifications,
  // but must not be mirrored to Telegram a second time by the app tail.
  suppressTelegram?: boolean
}

export type DeliveryRecord = {
  ts: number
  channel: string
  ok: boolean
  title: string
  error?: string
}

export type HitlSource =
  | 'manual'
  | 'cron-fail'
  | 'agent'
  | 'factory'
  | 'skill'
  | 'listener'
  | 'completion-hook'
  | 'review-pattern'
  | 'monitor'

export type HitlItem = {
  id: string
  title: string
  detail?: string
  action?: string // what the human needs to do
  repo?: string
  repoRoot?: string
  source: HitlSource
  status: 'open' | 'resolved'
  /** Alert loudness — see HitlSeverity. Absent on legacy items ⇒ treated as
   *  'push' so nothing that used to notify goes silent after the upgrade. */
  severity?: HitlSeverity
  /** Free-form grouping for the Inbox sidebar (ticket 120). Deliberately NOT a
   *  union: a caller names a category by passing one, and nothing else changes.
   *  Absent ⇒ 'Uncategorized'. Normalized on write, never validated against a
   *  list — membership checks are how a free string becomes an enum by the back
   *  door. */
  category?: string
  /** When you first saw it. Absent ⇒ unread. Independent of resolve: an item
   *  can be read-but-open (you saw it, haven't acted) or unread-and-resolved
   *  (auto-resolved before you looked). */
  readAt?: number
  createdAt: number
  resolvedAt?: number
  // Optional pointer back to the run that produced this HITL. Lets the HITL
  // tab show a "View run" button that jumps to the Runs tab + selects the
  // source run so the operator can read the log that prompted the block.
  runId?: string
  runSource?: 'cron' | 'agent' | 'bg' | 'session'
  // Path to the auto-filed backlog ticket that pairs with this HITL (cron
  // failures file both — HITL is the "look at me" channel, the ticket is
  // the durable triage record). Lets the HITL tab link straight to the
  // ticket in the Tickets tab.
  ticketPath?: string
  // Pointer back to the AI session that produced this HITL.
  sessionId?: string
  // Pointer back to the live TerMinal pty instance that produced this HITL.
  terminalKey?: string
  terminalCwd?: string
  // Stable bucket id for review-pattern HITLs so re-mining doesn't dup.
  patternKey?: string
  occurrenceCount?: number
  lastOccurredAt?: number
  // Stamped by the remote fan-out (hitl:remote-all) for HITLs filed by a run on a
  // host, so the Inbox can show + badge them alongside local ones (ADR-0002 #14).
  hostId?: string
  hostLabel?: string
  // Slack mirror (inbox.destination 'both'|'slack'): where the original message
  // landed, so recurrences thread under it and a resolve stamps ✅ on it.
  slackChannel?: string
  slackTs?: string
}

// Pure severity logic, split out so it's testable without importing hitl.ts
// (which transitively pulls in Electron via the activity feed).
//
// Three tiers, and a CONFIGURABLE notify threshold, so the inbox behaves like
// real email: only what you've said is loud enough interrupts you; the rest
// waits for your next sweep.
//   'urgent' — emergency / a real block: notifies (push/Telegram/desktop).
//   'normal' — worth seeing, not worth a buzz: inbox-only unless you lower the
//              threshold.
//   'low'    — FYI / a completion reminder: inbox-only.
// Every item persists in the inbox regardless; severity only gates the alert.
export type HitlSeverity = 'urgent' | 'normal' | 'low'
