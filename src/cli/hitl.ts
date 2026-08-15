// Filing Inbox items — the `inbox-item` / `hitl` verb, and the completion hook.
import { mkdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { inboxPathsFor, updateInbox } from '../shared/inbox-store'
import { emitActivity } from './activity'
import { HITL_FILE, CFG, readSettings, repo, repoLabel, runId } from './env'
import { hitlButtons, mirrorHitlToSlack, pingTelegram, slackQuietsTelegram } from './notify'
import type { HitlItem, Severity } from './types'

const SEVERITY_RANK: Record<string, number> = { urgent: 3, normal: 2, low: 1 }

// Category normalization (ticket 120). Deliberately NOT the app's
// `normalizeCategory` from src/shared/inbox-categories.ts: that one also splits
// nested `A/B` paths, and adopting it here would change what this verb writes.
// Canonical impl + tests: src/shared/inbox-categories.ts — keep in sync.
export function normalizeCategoryShared(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return clean ? clean.slice(0, 40) : undefined
}

export function fileHitl(
  title: string | undefined,
  action: string | undefined,
  opts: { severity?: string; category?: string; source?: string } = {},
): void {
  const severity = (opts.severity && SEVERITY_RANK[opts.severity] ? opts.severity : undefined) as
    Severity | undefined
  const category = normalizeCategoryShared(opts.category)
  const item: HitlItem = {
    id: randomUUID(),
    title: title || 'untitled',
    action: action || '',
    repo: repoLabel(),
    repoRoot: repo(),
    source: opts.source || 'skill',
    status: 'open',
    createdAt: Date.now(),
    ...(severity ? { severity } : {}),
    ...(category ? { category } : {}),
    ...(runId() ? { runId: runId(), runSource: 'cron' } : {}),
    sessionId: process.env.GT_TERMINAL_SESSION_ID || '',
    terminalKey: process.env.GT_TERMINAL_SESSION_KEY || '',
    terminalCwd: process.env.GT_TERMINAL_CWD || repo(),
  }
  updateInbox<HitlItem>(inboxPathsFor(HITL_FILE()), (live) => [item, ...live])
  mirrorHitlToSlack(item)
  emitActivity('blocked', `Inbox · ${item.title}`, item.action, { suppressTelegram: true })
  // Without an explicit severity, HITL always pings Telegram (legacy policy).
  // With one, the ping honors the same inbox.notifyThreshold gate the desktop
  // applies, so e.g. a 'normal' digest lands in the inbox without a ping.
  const threshold = readSettings()?.inbox?.notifyThreshold
  const loud = !severity || (SEVERITY_RANK[severity] || 3) >= (SEVERITY_RANK[threshold] || 3)
  if (loud && !slackQuietsTelegram())
    pingTelegram(
      `⛔ Inbox · ${item.title}${item.action ? ` — ${item.action}` : ''}`,
      hitlButtons(item),
    )
  console.log(item.id)
}

function completionHookEnabled(): boolean {
  const settings = readSettings()
  return settings?.inbox?.completionHook !== false
}

function safeBasename(path: string | undefined): string {
  try {
    return basename(path || '')
  } catch {
    return ''
  }
}

export function completionHitl(engine: string): void {
  const input = readFileSync(0, 'utf8')
  if (!completionHookEnabled()) return

  let payload: any = {}
  try {
    payload = input.trim() ? JSON.parse(input) : {}
  } catch {
    payload = {}
  }

  const cwd = payload.cwd || process.env.PWD || ''
  if (String(cwd).includes('/.claude-mem')) return

  const project = safeBasename(cwd) || repoLabel() || 'workspace'
  const transcript = payload.transcript_path || payload.transcriptPath || ''
  const lastMessage = String(payload.last_assistant_message || payload.last_message || '')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
  const hashInput = JSON.stringify({
    engine: engine || 'agent',
    cwd,
    transcript,
    lastMessage,
    session:
      payload.session_id ||
      payload.sessionId ||
      process.env.GT_TERMINAL_SESSION_ID ||
      payload.conversation_id ||
      payload.conversationId ||
      '',
    terminalKey: process.env.GT_TERMINAL_SESSION_KEY || '',
  })
  const id = `completion-${createHash('sha256').update(hashInput).digest('hex').slice(0, 16)}`

  const item: HitlItem = {
    id,
    title: `${engine || 'Agent'} completion · ${project}`,
    action: 'Review the completed agent turn.',
    detail: lastMessage || (transcript ? `transcript: ${transcript}` : ''),
    repo: project,
    repoRoot: cwd,
    source: 'completion-hook',
    status: 'open',
    createdAt: Date.now(),
    sessionId: payload.session_id || payload.sessionId || process.env.GT_TERMINAL_SESSION_ID || '',
    terminalKey: process.env.GT_TERMINAL_SESSION_KEY || '',
    terminalCwd: process.env.GT_TERMINAL_CWD || cwd,
    ...(transcript ? { transcriptPath: transcript } : {}),
  }
  mkdirSync(CFG(), { recursive: true })
  // The dedup check happens INSIDE the lock: this hook fires from every engine
  // turn, so two overlapping invocations both reading "no such id" is exactly
  // the race that files the same completion twice.
  const filed = updateInbox<HitlItem>(inboxPathsFor(HITL_FILE()), (live) =>
    live.some((h) => h.id === id) ? undefined : [item, ...live],
  )
  if (!filed) {
    console.log(id)
    return
  }
  mirrorHitlToSlack(item)
  emitActivity('blocked', `Inbox · ${item.title}`, item.action, { suppressTelegram: true })
  if (!slackQuietsTelegram())
    pingTelegram(
      `⛔ Inbox · ${item.title}${item.action ? ` — ${item.action}` : ''}`,
      hitlButtons(item),
    )
  console.log(id)
}
