import { existsSync } from 'node:fs'
import { normalizeCategory } from '../shared/inbox-categories'
import { readJsonState, updateJsonState } from './atomic-write'
import { configPath } from './config-dir'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { blockEffect } from './effect-guard'
import { emitActivity } from './events'
import { readSettings } from './settings'
import { sendUrl } from './telegram-api'
import { hitlRecurrenceKey, hitlRecurrenceBump } from './hitl-recurrence'
import { defaultSeverity, itemSeverity, shouldNotify, type HitlSeverity } from './hitl-severity'
import {
  hitlActivityKind,
  hitlNotifyKind,
  hitlTelegramKeyboard,
  hitlTelegramText,
} from './hitl-telegram'
import { inboxIsLoud } from '../shared/slack'
import {
  deliverSlackPost,
  reactSlackResolved,
  slackDelivery,
  threadSlackRecurrence,
} from './slack-mirror'

// GLOBAL human-in-the-loop inbox — one cross-repo queue of TRUE human-needs
// (decisions, destructive/cost approvals, creds, a failed cron job, anything an
// agent can't resolve itself). NOT per-repo backlog tickets, and NOT review
// request-changes (those are iterative workflow, handled by the factory). Filing
// one surfaces a `blocked` activity event → macOS + Telegram notification.
export const hitlFile = (): string => configPath('hitl.json')

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
export { itemSeverity, type HitlSeverity } from './hitl-severity'

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

export function readHitl(): HitlItem[] {
  return readJsonState<HitlItem[]>(hitlFile(), () => [], { accept: Array.isArray }).value
}

/**
 * Locked read-modify-write over the inbox.
 *
 * Three independent processes file into hitl.json (the app, terminal-cron,
 * terminal-cli). A cron-filed blocker overlapping a resolve used to silently
 * drop one of the two writes, so `mutate` re-reads inside the lock and every
 * mutation below is expressed as a transform of the CURRENT list, never of a
 * snapshot the caller read earlier. Returning undefined means "no change".
 *
 * Throws CorruptStateError if the file is unreadable — refusing to file is far
 * better than replacing the whole inbox with one item.
 */
function mutate(fn: (list: HitlItem[]) => HitlItem[] | undefined): void {
  updateJsonState<HitlItem[]>(hitlFile(), () => [], fn, { accept: Array.isArray })
}

export function openCount(): number {
  return readHitl().filter((h) => h.status === 'open').length
}

/** Open items you haven't seen yet — the badge that should actually nag you. */
export function unreadCount(): number {
  return readHitl().filter((h) => h.status === 'open' && !h.readAt).length
}

/** Read = readAt is set OR the item was resolved (a resolved item has been
 *  dealt with, so it reads as read). One axis: unread vs read. */
export function isHitlRead(h: { readAt?: number; status?: string }): boolean {
  return !!h.readAt || h.status === 'resolved'
}

/** Mark items read (viewed) — or unread again with read=false, the email
 *  "keep this on my plate" gesture. Unread also clears a prior resolve so a
 *  resolved item can genuinely return to the unread pile. Returns how many
 *  changed. */
export function markHitlRead(ids: string[], read = true): number {
  const set = new Set(ids)
  let changed = 0
  mutate((list) => {
    changed = 0
    const next = list.map((h) => {
      if (!set.has(h.id)) return h
      if (read ? isHitlRead(h) : !isHitlRead(h)) return h
      changed++
      return read
        ? { ...h, readAt: Date.now() }
        : { ...h, readAt: undefined, status: 'open' as const, resolvedAt: undefined }
    })
    return changed ? next : undefined
  })
  return changed
}

/** Mark every unread item read (open or resolved) — the "mark all read" sweep. */
export function markAllHitlRead(): number {
  return markHitlRead(
    readHitl()
      .filter((h) => !h.readAt)
      .map((h) => h.id),
  )
}

// HITL usually means "I need attention", but deterministic completion-hook
// items are review reminders, not blockers. Ping Telegram on file when
// configured, regardless of the activity-feed `telegram.notify` toggle (which
// gates the general feed). If no bot/chat or legacy script exists, this is a
// no-op: Inbox filing must never be blocked by notification setup.
const LEGACY_TG_SCRIPT = join(homedir(), '.claude', 'bin', 'telegram-notify.sh')
function alwaysPingTelegram(item: HitlItem): void {
  // This deliberately ignores the `telegram.notify` toggle, so a config-level
  // opt-out cannot silence it — right for a real blocker, wrong for a test. The
  // effect guard is what makes it unreachable from one.
  if (blockEffect('notify', 'hitl-telegram')) return
  try {
    const { telegram } = readSettings()
    const msg = hitlTelegramText(item)
    if (telegram.botToken && telegram.chatId) {
      // Inline [Resolve] (always) + [Tail run] (when we know the run id) so
      // the chat ping is one-tap actionable instead of "now go open the app
      // and click Resolve."
      fetch(sendUrl(telegram.botToken), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegram.chatId,
          text: msg,
          reply_markup: { inline_keyboard: hitlTelegramKeyboard(item) },
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {})
      return
    }
    if (!existsSync(LEGACY_TG_SCRIPT)) return
    const child = spawn(LEGACY_TG_SCRIPT, [`--kind=${hitlNotifyKind(item.source)}`, msg], {
      stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* best effort — never fail a HITL filing because of a notify glitch */
  }
}

const DEDUP_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export function fileHitl(input: Omit<HitlItem, 'id' | 'status' | 'createdAt'>): HitlItem {
  // Dedup window — if an open HITL with the same fingerprint already exists
  // (filed within the last hour), return that one instead of double-filing.
  // Avoids cron-retry storms that flood the inbox.
  //
  // Dedup detection AND the append happen inside one lock. Deciding "is this a
  // duplicate?" from a read taken before the write is the same read/write gap
  // that loses updates: two processes both see no duplicate and both file.
  const fp = hitlRecurrenceKey(input)
  const since = Date.now() - DEDUP_WINDOW_MS
  const fresh: HitlItem = {
    ...input,
    id: randomUUID(),
    status: 'open',
    severity: input.severity ?? defaultSeverity(input.source),
    // Normalized HERE, at the only write path, so a bad value from a
    // shell-built CLI call never reaches the file — and every reader can then
    // trust the field without re-checking it.
    category: normalizeCategory(input.category),
    createdAt: Date.now(),
    occurrenceCount: 1,
  }
  // A holder object rather than two `let`s: TypeScript does not track
  // assignments made inside the callback, so a plain `let` narrows to null.
  const out: { dup: HitlItem | null; loud: boolean } = { dup: null, loud: false }
  mutate((list) => {
    const i = list.findIndex(
      (h) => h.status === 'open' && h.createdAt >= since && hitlRecurrenceKey(h) === fp,
    )
    if (i < 0) return [fresh, ...list]
    // Bump the count instead of double-filing, but the recurrence is new
    // information: the item goes back to unread and the notify decision runs
    // the same severity-threshold gate a fresh filing would get.
    const bumped = hitlRecurrenceBump(list[i], readSettings().inbox.notifyThreshold)
    out.dup = bumped.item
    out.loud = bumped.loud
    const next = [...list]
    next[i] = bumped.item
    return next
  })

  // Destination gate: in 'slack' mode the item still persists (above) and the
  // activity event still fires, but the desktop/Telegram nag goes quiet — Slack
  // is the triage surface.
  const quiet = !inboxIsLoud(readSettings().inbox.destination)
  const slack = slackDelivery()

  const duplicate = out.dup
  if (duplicate) {
    if (slack) void threadSlackRecurrence(slack, duplicate)
    const loud = out.loud && !quiet
    emitActivity(
      {
        kind: hitlActivityKind(input.source),
        title: `${input.source === 'completion-hook' ? 'Done recur' : 'HITL recur'} · ${input.title}`,
        detail: `duplicate filing collapsed (${duplicate.occurrenceCount} occurrences within 1h window)`,
        repo: input.repo,
        repoRoot: input.repoRoot,
        hitlId: duplicate.id,
        runId: input.runId,
        runSource: input.runSource,
        sessionId: input.sessionId,
        suppressTelegram: true,
      },
      { notify: loud },
    )
    if (loud) alwaysPingTelegram(duplicate)
    return duplicate
  }
  const item = fresh
  // Fire-and-forget: the post's channel+ts come back later and are stamped onto
  // the stored item (if it still exists) so recurrence/resolve can find it.
  if (slack)
    void deliverSlackPost(slack, item).then((ref) => {
      if (ref) stampSlackRef(item.id, ref)
    })
  // Severity + the configurable threshold are the alert gate. At or above the
  // threshold notifies (macOS/Telegram/phone); below it, the item just waits in
  // the inbox for your next sweep. Default threshold 'urgent' → only urgent pings.
  const loud = shouldNotify(itemSeverity(item), readSettings().inbox.notifyThreshold) && !quiet
  emitActivity(
    {
      kind: hitlActivityKind(item.source),
      title: `${item.source === 'completion-hook' ? 'Done' : 'HITL'} · ${item.title}`,
      detail: item.action || item.detail,
      repo: item.repo,
      repoRoot: item.repoRoot,
      // Drive the [Resolve] / [Tail run] inline-button rendering in
      // events.ts buttonsFor — without these, the TG ping is plain text.
      hitlId: item.id,
      runId: item.runId,
      runSource: item.runSource,
      sessionId: item.sessionId,
      suppressTelegram: true,
    },
    { notify: loud },
  )
  // HITL pings Telegram when configured even if the general feed toggle is off —
  // but only at or above the configured notify threshold.
  if (loud) alwaysPingTelegram(item)
  return item
}

// The inbox is one axis now — read vs unread, no separate archive. Legacy
// "resolve" (Telegram button, MCP resolve_hitl, agent-side) maps to mark-read;
// "reopen" maps to mark-unread. Items stay in the one list, just read.
/** Attach the Slack message ref once the async post lands. The item may have
 *  been removed in the meantime — then there is nothing to stamp. */
function stampSlackRef(id: string, ref: { channelId: string; ts: string }): void {
  try {
    mutate((list) => {
      const i = list.findIndex((h) => h.id === id)
      if (i < 0) return undefined
      const next = [...list]
      next[i] = { ...next[i], slackChannel: ref.channelId, slackTs: ref.ts }
      return next
    })
  } catch {
    /* best effort — a lost stamp only costs threading, never the item */
  }
}

export function resolveHitl(id: string, resolved = true): boolean {
  const item = readHitl().find((h) => h.id === id)
  if (!item) return false
  const changed = markHitlRead([id], resolved) > 0
  if (changed && resolved) {
    const slack = slackDelivery()
    if (slack) void reactSlackResolved(slack, item)
  }
  if (changed && !resolved)
    // A reopen puts it back in your face; a read never re-notifies.
    emitActivity(
      {
        kind: 'blocked',
        title: `Inbox reopened · ${item.title}`,
        detail: item.action || item.detail,
        repo: item.repo,
        repoRoot: item.repoRoot,
        hitlId: item.id,
        runId: item.runId,
        runSource: item.runSource,
        sessionId: item.sessionId,
      },
      { notify: true },
    )
  return true
}

export function removeHitl(id: string): boolean {
  let item: HitlItem | undefined
  mutate((list) => {
    item = list.find((h) => h.id === id)
    return item ? list.filter((h) => h.id !== id) : undefined
  })
  const removed = !!item
  if (removed && item) {
    emitActivity(
      {
        kind: 'info',
        title: `Inbox removed · ${item.title}`,
        detail: item.action || item.detail,
        repo: item.repo,
        repoRoot: item.repoRoot,
        hitlId: item.id,
        runId: item.runId,
        runSource: item.runSource,
        sessionId: item.sessionId,
      },
      { notify: false },
    )
  }
  return removed
}
