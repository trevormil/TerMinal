// Slack as an inbox destination (alternative or mirror to the in-app Inbox).
//
// Pure and dependency-free so main, the renderer (sidebar #channel hints), and
// the bin filers share ONE definition of "which channel does this category go
// to" — two slugifiers would file the same category into two channels.
//
// Categories stay free-form (`shared/inbox-categories.ts`); this maps a path to
// a Slack channel name deterministically: `Monitoring/Certs` →
// `<prefix>-monitoring-certs`. Uncategorized (or a category that slugifies to
// nothing) lands in the configured default channel.

import { UNCATEGORIZED } from './inbox-categories'

/**
 * Where inbox posts go. 'inbox' — the current behavior, no Slack. 'both' —
 * mirror every filing to Slack alongside the normal notify fan-out. 'slack' —
 * Slack is the triage surface: items still persist (dedup, recurrence, resolve
 * state, and the iOS app all read hitl.json) but the desktop badge and
 * macOS/Telegram pings go quiet.
 */
export type InboxDestination = 'inbox' | 'both' | 'slack'

export function normalizeDestination(raw: unknown): InboxDestination {
  return raw === 'both' || raw === 'slack' ? raw : 'inbox'
}

/** Does this destination post to Slack at all? */
export const mirrorsToSlack = (d: InboxDestination): boolean => d !== 'inbox'

/** Does the in-app inbox still nag (badge + macOS/Telegram/push)? */
export const inboxIsLoud = (d: InboxDestination): boolean => d !== 'slack'

/**
 * Should the in-app nag actually go quiet? Only when Slack is BOTH the chosen
 * destination AND able to deliver (token configured). Destination alone must
 * not silence anything: 'slack' with no token would mean no Slack post, no
 * badge, no ping — an urgent item persisted invisibly. Misconfiguration
 * degrades to loud, never to silent.
 */
export function inboxQuiet(destination: InboxDestination, slackConfigured: boolean): boolean {
  return destination === 'slack' && slackConfigured
}

export type SlackChannelCfg = {
  /** Channel for Uncategorized + fallback, '#' optional. '' → terminal-inbox. */
  defaultChannel: string
  /** Prepended to every derived channel ('inbox' → #inbox-monitoring). '' → none. */
  channelPrefix: string
}

const FALLBACK_CHANNEL = 'terminal-inbox'
const MAX_CHANNEL_LEN = 80 // Slack's limit

/** Slack channel names: lowercase a-z0-9, - and _ only. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[/\s]+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The channel (bare name, no '#') a category files into. Deterministic and
 * total: every input maps somewhere, worst case the default channel.
 */
export function slackChannelName(category: string | undefined, cfg: SlackChannelCfg): string {
  const fallback = slugify(cfg.defaultChannel).slice(0, MAX_CHANNEL_LEN) || FALLBACK_CHANNEL
  if (!category || category === UNCATEGORIZED) return fallback
  const slug = slugify(category)
  if (!slug) return fallback
  const prefix = slugify(cfg.channelPrefix)
  return (prefix ? `${prefix}-${slug}` : slug).slice(0, MAX_CHANNEL_LEN)
}

// ---- message shape ----------------------------------------------------------

export type SlackMessage = { text: string; blocks: unknown[] }

type SlackableItem = {
  title: string
  source: string
  severity?: 'urgent' | 'normal' | 'low'
  category?: string
  repo?: string
  action?: string
  detail?: string
}

// Mirrors hitl-telegram.ts markers: a completion reminder is a ✅, a block is a
// ⛔; the middle/low tiers get quieter glyphs.
function marker(item: SlackableItem): string {
  if (item.source === 'completion-hook') return '✅'
  if (item.severity === 'normal') return '🟠'
  if (item.severity === 'low') return '⚪'
  return '⛔'
}

/** Slack caps a section's text at 3000 chars; leave room for the code fence. */
const DETAIL_CAP = 2900

function truncate(s: string, cap: number): string {
  return s.length > cap ? s.slice(0, cap - 1) + '…' : s
}

export function slackMessageFor(item: SlackableItem): SlackMessage {
  const head = `${marker(item)} ${item.title}${item.action ? ` — ${item.action}` : ''}`
  const context = [item.repo, item.category, item.source].filter(Boolean).join('  ·  ')
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: truncate(`*${head}*`, 3000) } },
  ]
  if (item.detail)
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '```' + truncate(item.detail, DETAIL_CAP) + '```' },
    })
  if (context)
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: truncate(context, 3000) }] })
  return { text: truncate(head, 3000), blocks }
}

/** Threaded under the original post when a dedup window collapses a re-filing. */
export function slackRecurrenceText(item: { title: string; occurrenceCount?: number }): string {
  return `🔁 recurred — ${item.occurrenceCount ?? 2} occurrences within the dedup window`
}

/** Reaction stamped on the original message when the item is resolved/read. */
export const SLACK_RESOLVE_REACTION = 'white_check_mark'
