import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Latest-status records written by `terminal-cli check-status` — one JSON per
// (scope, kind) under ~/.config/TerMinal/checks/. The CLI owns writes (it runs
// headless under cron); the app only reads.

export type CheckState = 'ok' | 'warn' | 'fail'

export type CheckStatus = {
  kind: string
  scope: string // 'global' or a repo root path
  repoLabel: string
  status: CheckState
  summary: string
  metrics?: Record<string, unknown>
  detail?: Record<string, unknown>
  updatedAt: number
  since: number
  lastTransition: { from: CheckState; to: CheckState; at: number } | null
  history: { at: number; status: CheckState }[]
}

const CHECKS_DIR = join(homedir(), '.config', 'TerMinal', 'checks')
const STATES: CheckState[] = ['ok', 'warn', 'fail']

/** A record older than this is reported stale — "I can't tell" must look
 *  different from "everything is fine". */
export const CHECK_STALE_MS = 2 * 60 * 60 * 1000

export function parseCheckStatus(raw: string): CheckStatus | null {
  let v: Record<string, unknown>
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const status = v.status as CheckState
  if (!STATES.includes(status)) return null
  if (typeof v.kind !== 'string' || !v.kind) return null
  return {
    kind: v.kind,
    scope: typeof v.scope === 'string' ? v.scope : 'global',
    repoLabel: typeof v.repoLabel === 'string' ? v.repoLabel : '',
    status,
    summary: typeof v.summary === 'string' ? v.summary : '',
    metrics: v.metrics && typeof v.metrics === 'object' ? (v.metrics as never) : undefined,
    detail: v.detail && typeof v.detail === 'object' ? (v.detail as never) : undefined,
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
    since: typeof v.since === 'number' ? v.since : 0,
    lastTransition: (v.lastTransition as CheckStatus['lastTransition']) || null,
    history: Array.isArray(v.history) ? (v.history as CheckStatus['history']) : [],
  }
}

export function isCheckStale(c: CheckStatus, now = Date.now()): boolean {
  return now - c.updatedAt > CHECK_STALE_MS
}

/** All latest check statuses, worst-first then most-recent-first. */
export function listChecks(dir = CHECKS_DIR): CheckStatus[] {
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const rank: Record<CheckState, number> = { fail: 0, warn: 1, ok: 2 }
  const out: CheckStatus[] = []
  for (const f of files) {
    try {
      const parsed = parseCheckStatus(readFileSync(join(dir, f), 'utf8'))
      if (parsed) out.push(parsed)
    } catch {}
  }
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt)
}
