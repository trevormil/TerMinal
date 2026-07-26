// The notification matrix — which event CATEGORIES reach which CHANNELS.
//
// Pure, dependency-free (no electron/node) so BOTH the main process (dispatch)
// and the renderer (Settings UI) import the same single source of truth. The
// old model fanned every notifying event to every enabled channel, so a paired
// phone got pushed for routine activity (tickets, PR verdicts, test runs). Now
// each channel opts into categories, and the phone stays quiet by default.

export const NOTIFY_CHANNELS = ['desktop', 'telegram', 'webhook', 'push'] as const
export type NotifyChannelId = (typeof NOTIFY_CHANNELS)[number]

export const CHANNEL_META: Record<NotifyChannelId, { label: string }> = {
  desktop: { label: 'Desktop' },
  telegram: { label: 'Telegram' },
  webhook: { label: 'Webhook' },
  push: { label: 'Phone' },
}

// Ordered for the settings table (most-important first).
export const NOTIFY_CATEGORIES = [
  'needs-you',
  'completions',
  'code-review',
  'tickets',
  'tests-ci',
  'runs-agents',
  'errors',
  'sessions',
  'ops',
] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]

export const CATEGORY_META: Record<NotifyCategory, { label: string; desc: string }> = {
  'needs-you': { label: 'Needs you', desc: 'Inbox / HITL items waiting on a human decision' },
  completions: { label: 'Completions', desc: 'An agent finished its turn' },
  'code-review': { label: 'Code review', desc: 'PRs opened, reviewed, or merged' },
  tickets: { label: 'Tickets', desc: 'Tickets filed or closed' },
  'tests-ci': { label: 'Tests & CI', desc: 'Test runs and check results' },
  'runs-agents': { label: 'Runs & agents', desc: 'Scheduled/agent runs' },
  errors: { label: 'Errors', desc: 'Failures and unexpected errors' },
  sessions: { label: 'Sessions', desc: 'Sessions starting and ending' },
  ops: { label: 'Ops', desc: 'Deploys, docs, and misc info' },
}

// ActivityKind → category. A HITL filing (event carries a hitlId) is always
// 'needs-you' regardless of its kind — handled in categoryFor below.
const KIND_CATEGORY: Record<string, NotifyCategory> = {
  blocked: 'needs-you',
  'task-complete': 'completions',
  'pr-opened': 'code-review',
  'pr-verdict': 'code-review',
  'pr-merged': 'code-review',
  'ticket-filed': 'tickets',
  'ticket-closed': 'tickets',
  'tests-pass': 'tests-ci',
  'tests-fail': 'tests-ci',
  check: 'tests-ci',
  'agent-run': 'runs-agents',
  error: 'errors',
  'session-start': 'sessions',
  'session-end': 'sessions',
  deploy: 'ops',
  doc: 'ops',
  info: 'ops',
}

/** Which category an event belongs to. An inbox/HITL filing wins over its kind. */
export function categoryFor(ev: { kind: string; hitlId?: string }): NotifyCategory {
  if (ev.hitlId) return 'needs-you'
  return KIND_CATEGORY[ev.kind] ?? 'ops'
}

// The shipped defaults. Phone (push) opts into ONLY the two things worth
// interrupting a pocket for: something needs you, or your agent finished.
export const DEFAULT_MATRIX: Record<NotifyChannelId, Record<NotifyCategory, boolean>> = {
  desktop: {
    'needs-you': true,
    completions: true,
    'code-review': true,
    tickets: true,
    'tests-ci': true,
    'runs-agents': true,
    errors: true,
    sessions: false,
    ops: false,
  },
  telegram: {
    'needs-you': true,
    completions: true,
    'code-review': true,
    tickets: false,
    'tests-ci': true,
    'runs-agents': false,
    errors: true,
    sessions: false,
    ops: false,
  },
  webhook: {
    'needs-you': true,
    completions: false,
    'code-review': false,
    tickets: false,
    'tests-ci': false,
    'runs-agents': false,
    errors: true,
    sessions: false,
    ops: false,
  },
  push: {
    'needs-you': true,
    completions: true,
    'code-review': false,
    tickets: false,
    'tests-ci': false,
    'runs-agents': false,
    errors: false,
    sessions: false,
    ops: false,
  },
}

/** User overrides on top of DEFAULT_MATRIX; a missing entry falls to the default. */
export type NotifyMatrix = Partial<
  Record<NotifyChannelId, Partial<Record<NotifyCategory, boolean>>>
>

/** Does this channel want this category? Override wins, else the shipped default. */
export function channelWants(
  channel: NotifyChannelId,
  category: NotifyCategory,
  matrix?: NotifyMatrix,
): boolean {
  const override = matrix?.[channel]?.[category]
  return typeof override === 'boolean' ? override : DEFAULT_MATRIX[channel][category]
}

/** Would ANY channel fire for this category — the gate on emitting a notification at all. */
export function anyChannelWants(category: NotifyCategory, matrix?: NotifyMatrix): boolean {
  return NOTIFY_CHANNELS.some((c) => channelWants(c, category, matrix))
}
