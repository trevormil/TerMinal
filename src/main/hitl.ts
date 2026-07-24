import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
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

// GLOBAL human-in-the-loop inbox — one cross-repo queue of TRUE human-needs
// (decisions, destructive/cost approvals, creds, a failed cron job, anything an
// agent can't resolve itself). NOT per-repo backlog tickets, and NOT review
// request-changes (those are iterative workflow, handled by the factory). Filing
// one surfaces a `blocked` activity event → macOS + Telegram notification.
const FILE = join(homedir(), '.config', 'TerMinal', 'hitl.json')

export type HitlSource =
  | 'manual'
  | 'cron-fail'
  | 'agent'
  | 'factory'
  | 'skill'
  | 'listener'
  | 'completion-hook'
  | 'review-pattern'
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
}

export function readHitl(): HitlItem[] {
  if (!existsSync(FILE)) return []
  try {
    const a = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function write(list: HitlItem[]): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(list, null, 2))
  } catch {
    /* best effort */
  }
}

export function openCount(): number {
  return readHitl().filter((h) => h.status === 'open').length
}

/** Open items you haven't seen yet — the badge that should actually nag you. */
export function unreadCount(): number {
  return readHitl().filter((h) => h.status === 'open' && !h.readAt).length
}

/** Mark items read (viewed) — or unread again with read=false, the email
 *  "keep this on my plate" gesture. Returns how many changed. */
export function markHitlRead(ids: string[], read = true): number {
  const set = new Set(ids)
  const list = readHitl()
  let changed = 0
  const next = list.map((h) => {
    if (set.has(h.id) && (read ? !h.readAt : !!h.readAt)) {
      changed++
      return read ? { ...h, readAt: Date.now() } : { ...h, readAt: undefined }
    }
    return h
  })
  if (changed) write(next)
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
  const existing = readHitl()
  const fp = hitlRecurrenceKey(input)
  const since = Date.now() - DEDUP_WINDOW_MS
  const dupIndex = existing.findIndex(
    (h) => h.status === 'open' && h.createdAt >= since && hitlRecurrenceKey(h) === fp,
  )
  if (dupIndex >= 0) {
    // Bump the count instead of double-filing, but the recurrence is new
    // information: the item goes back to unread and the notify decision runs
    // the same severity-threshold gate a fresh filing would get.
    const { item: dup, loud } = hitlRecurrenceBump(
      existing[dupIndex],
      readSettings().inbox.notifyThreshold,
    )
    existing[dupIndex] = dup
    write(existing)
    emitActivity(
      {
        kind: hitlActivityKind(input.source),
        title: `${input.source === 'completion-hook' ? 'Done recur' : 'HITL recur'} · ${input.title}`,
        detail: `duplicate filing collapsed (${dup.occurrenceCount} occurrences within 1h window)`,
        repo: input.repo,
        repoRoot: input.repoRoot,
        hitlId: dup.id,
        runId: input.runId,
        runSource: input.runSource,
        sessionId: input.sessionId,
        suppressTelegram: true,
      },
      { notify: loud },
    )
    if (loud) alwaysPingTelegram(dup)
    return dup
  }
  const item: HitlItem = {
    ...input,
    id: randomUUID(),
    status: 'open',
    severity: input.severity ?? defaultSeverity(input.source),
    createdAt: Date.now(),
    occurrenceCount: 1,
  }
  write([item, ...readHitl()])
  // Severity + the configurable threshold are the alert gate. At or above the
  // threshold notifies (macOS/Telegram/phone); below it, the item just waits in
  // the inbox for your next sweep. Default threshold 'urgent' → only urgent pings.
  const loud = shouldNotify(itemSeverity(item), readSettings().inbox.notifyThreshold)
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

export function resolveHitl(id: string, resolved = true): boolean {
  const list = readHitl()
  const i = list.findIndex((h) => h.id === id)
  if (i < 0) return false
  const item = list[i]
  list[i] = {
    ...item,
    status: resolved ? 'resolved' : 'open',
    resolvedAt: resolved ? Date.now() : undefined,
  }
  write(list)
  emitActivity(
    {
      kind: resolved ? 'task-complete' : 'blocked',
      title: `Inbox ${resolved ? 'resolved' : 'reopened'} · ${item.title}`,
      detail: item.action || item.detail,
      repo: item.repo,
      repoRoot: item.repoRoot,
      hitlId: item.id,
      runId: item.runId,
      runSource: item.runSource,
      sessionId: item.sessionId,
    },
    { notify: !resolved },
  )
  return true
}

export function removeHitl(id: string): boolean {
  const before = readHitl()
  const item = before.find((h) => h.id === id)
  const after = before.filter((h) => h.id !== id)
  write(after)
  const removed = after.length !== before.length
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
