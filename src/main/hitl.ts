import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { emitActivity } from './events'
import { readSettings } from './settings'
import { sendUrl } from './telegram-api'

// GLOBAL human-in-the-loop inbox — one cross-repo queue of TRUE human-needs
// (decisions, destructive/cost approvals, creds, a failed cron job, anything an
// agent can't resolve itself). NOT per-repo backlog tickets, and NOT review
// request-changes (those are iterative workflow, handled by the factory). Filing
// one surfaces a `blocked` activity event → macOS + Telegram notification.
const FILE = join(homedir(), '.config', 'TerMinal', 'hitl.json')

export type HitlSource = 'manual' | 'cron-fail' | 'agent' | 'factory' | 'skill'
export type HitlItem = {
  id: string
  title: string
  detail?: string
  action?: string // what the human needs to do
  repo?: string
  repoRoot?: string
  source: HitlSource
  status: 'open' | 'resolved'
  createdAt: number
  resolvedAt?: number
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

// HITL is by definition "I need attention" — always ping Telegram on file,
// regardless of the activity-feed `telegram.notify` toggle (which gates the
// general feed). Only requires bot token + chat to be configured. Falls back
// to the legacy ~/.claude/bin/telegram-notify.sh script if no native config.
const LEGACY_TG_SCRIPT = join(homedir(), '.claude', 'bin', 'telegram-notify.sh')
function alwaysPingTelegram(item: HitlItem): void {
  try {
    const { telegram } = readSettings()
    const msg = `⛔ HITL · ${item.title}${item.action ? ` — ${item.action}` : ''}`
    if (telegram.botToken && telegram.chatId) {
      fetch(sendUrl(telegram.botToken), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: msg }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {})
      return
    }
    if (!existsSync(LEGACY_TG_SCRIPT)) return
    spawn(LEGACY_TG_SCRIPT, [`--kind=blocked`, msg], { stdio: 'ignore' }).unref()
  } catch {
    /* best effort — never fail a HITL filing because of a notify glitch */
  }
}

/** File a HITL item (newest first) and fire the blocked notification. */
export function fileHitl(input: Omit<HitlItem, 'id' | 'status' | 'createdAt'>): HitlItem {
  const item: HitlItem = { ...input, id: randomUUID(), status: 'open', createdAt: Date.now() }
  write([item, ...readHitl()])
  emitActivity(
    {
      kind: 'blocked',
      title: `HITL · ${item.title}`,
      detail: item.action || item.detail,
      repo: item.repo,
      repoRoot: item.repoRoot,
    },
    { notify: true },
  )
  // Belt-and-suspenders: HITL ALWAYS pings Telegram when configured, even if
  // the general activity-feed notify toggle is off.
  alwaysPingTelegram(item)
  return item
}

export function resolveHitl(id: string, resolved = true): boolean {
  const list = readHitl()
  const i = list.findIndex((h) => h.id === id)
  if (i < 0) return false
  list[i] = { ...list[i], status: resolved ? 'resolved' : 'open', resolvedAt: resolved ? Date.now() : undefined }
  write(list)
  return true
}

export function removeHitl(id: string): boolean {
  const before = readHitl()
  const after = before.filter((h) => h.id !== id)
  write(after)
  return after.length !== before.length
}
