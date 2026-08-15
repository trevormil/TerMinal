// Auto-file a global HITL item on a failed cron run + best-effort Telegram ping
// (works even with the app closed — reads the token straight from the sidecar
// the app mirrors for us).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { HitlItem } from '../shared/types/activity'
import { HITL_FILE, LEGACY_TG_SCRIPT } from './config'
import { log } from './log'
import { inboxNotifyThreshold, tgCreds } from './settings'
import { mirrorHitlToSlack, slackQuietsTelegram } from './slack'
import { inboxPathsFor, updateInbox } from '../shared/inbox-store'

const SEVERITY_RANK: Record<string, number> = { urgent: 3, normal: 2, low: 1 }

/** Does a severity clear the operator's configured notify threshold? An item
 *  with no explicit severity is loud (legacy policy — never silence a filer
 *  that predates the tiers). */
export function hitlIsLoud(severity: string | undefined): boolean {
  if (!severity || !SEVERITY_RANK[severity]) return true
  const threshold = inboxNotifyThreshold()
  return SEVERITY_RANK[severity] >= (SEVERITY_RANK[threshold ?? ''] || 3)
}

/** A cron-filed HITL. `ticketPath` stays nullable: the filers pass the result of
 *  a best-effort fileTicket() straight through, and the stored record has always
 *  carried the explicit null. */
export type HitlInput = Omit<Partial<HitlItem>, 'id' | 'status' | 'createdAt' | 'ticketPath'> & {
  title: string
  ticketPath?: string | null
}

export function fileHitl(item: HitlInput): HitlItem {
  const rec = {
    id: randomUUID(),
    status: 'open',
    createdAt: Date.now(),
    source: 'cron-fail',
    ...item,
  } as unknown as HitlItem
  try {
    updateInbox(inboxPathsFor(HITL_FILE()), (live) => [rec, ...live])
  } catch (e) {
    log(`hitl write failed: ${e}`)
  }
  mirrorHitlToSlack(rec)
  // An item that carries an explicit severity honors the same
  // inbox.notifyThreshold gate the desktop applies (mirrors terminal-cli's
  // fileHitl). Without one, the legacy always-ping policy stands so nothing
  // that used to alert goes silent.
  if (!hitlIsLoud(rec.severity) || slackQuietsTelegram()) return rec
  try {
    // HITL ALWAYS pings Telegram when bot+chat configured, regardless of the
    // general activity-feed `telegram.notify` toggle. HITL is by definition the
    // "I need attention" channel; never silence it. Include inline
    // [Resolve] / [Tail run] buttons so the chat ping is one-tap actionable;
    // the in-app poll loop dispatches callback_query taps back to
    // resolveHitl + tailRun.
    const text = `⛔ Inbox · ${rec.title}${rec.action ? ` — ${rec.action}` : ''}`
    const t = tgCreds()
    if (t) {
      const row = [{ text: '✅ Resolve', callback_data: `hitl:resolve:${rec.id}` }]
      if (rec.runId) row.push({ text: '🪵 Tail run', callback_data: `run:tail:${rec.runId}` })
      void fetch(`https://api.telegram.org/bot${t.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: t.chatId,
          text,
          reply_markup: { inline_keyboard: [row] },
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {})
    } else if (existsSync(LEGACY_TG_SCRIPT())) {
      // No native creds — fall back to the legacy script like the other filers
      // do, so a cron-filed HITL is never silently undelivered.
      try {
        const child = spawn(LEGACY_TG_SCRIPT(), ['--kind=blocked', text], { stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
      } catch {}
    }
  } catch {}
  return rec
}
