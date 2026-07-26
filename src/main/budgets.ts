// Cost guardrails (ticket #0002). Reads today's spend from the ai-runs
// ledger, compares to a configurable daily budget + per-agent caps, and
// gates new background-task / cron-fired spawns when over.
//
// Mid-turn aborts NOT supported (kills worktree state). Current runs
// finish; only NEW background spawns are refused at the cap.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { summaryFor } from './ai-runs'
import { fileHitl } from './hitl'

const FILE = join(homedir(), '.config', 'TerMinal', 'budgets.json')

export type Budgets = {
  dailyTotalUsd: number // 0 = no global cap
  perAgent: Record<string, number> // agentId → cap usd (0 = no cap)
  warnAt: number[] // e.g. [0.5, 0.8, 1.0] — fractions of dailyTotalUsd
  overrideUntil: number | null // ms epoch; null = no override active
}

const DEFAULTS: Budgets = {
  dailyTotalUsd: 0, // off by default until user sets it
  perAgent: {},
  warnAt: [0.5, 0.8, 1.0],
  overrideUntil: null,
}

function ensure(): void {
  const dir = join(homedir(), '.config', 'TerMinal')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readBudgets(): Budgets {
  ensure()
  if (!existsSync(FILE)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeBudgets(b: Budgets): Budgets {
  ensure()
  writeFileSync(FILE, JSON.stringify(b, null, 2))
  return b
}

export function setDailyCap(usd: number): Budgets {
  const b = readBudgets()
  b.dailyTotalUsd = Math.max(0, usd)
  return writeBudgets(b)
}

export function setAgentCap(agentId: string, usd: number): Budgets {
  const b = readBudgets()
  if (usd <= 0) delete b.perAgent[agentId]
  else b.perAgent[agentId] = usd
  return writeBudgets(b)
}

export function setOverride(durationMs: number): Budgets {
  const b = readBudgets()
  b.overrideUntil = durationMs > 0 ? Date.now() + durationMs : null
  return writeBudgets(b)
}

// ---- gate ------------------------------------------------------------------

export type GateDecision = {
  decision: 'allow' | 'warn' | 'refuse'
  reason?: string
  spentTodayUsd: number
  capRemainingUsd: number
  capUsd: number
  agentSpentUsd?: number
  agentCapUsd?: number
}

/** Check whether a new spawn should be allowed. Returns 'allow' when no caps
 *  are set OR override is active OR spend is well under cap. Returns 'refuse'
 *  when at/over cap. 'warn' covers the warning-band states. */
export function gateSpawn(agentId?: string): GateDecision {
  const b = readBudgets()
  // Override window — bypass the gate entirely
  if (b.overrideUntil && b.overrideUntil > Date.now()) {
    return {
      decision: 'allow',
      reason: 'override active',
      spentTodayUsd: 0,
      capRemainingUsd: Infinity,
      capUsd: b.dailyTotalUsd,
    }
  }
  const summary = summaryFor('today')
  const total = summary.totalUsd
  const cap = b.dailyTotalUsd
  const agentSpent = agentId ? summary.byAgent[agentId]?.usd || 0 : 0
  const agentCap = agentId ? b.perAgent[agentId] || 0 : 0

  // Agent-cap check first (more specific)
  if (agentCap > 0 && agentSpent >= agentCap) {
    return {
      decision: 'refuse',
      reason: `agent ${agentId} hit per-agent cap of $${agentCap.toFixed(2)}`,
      spentTodayUsd: total,
      capRemainingUsd: cap > 0 ? Math.max(0, cap - total) : Infinity,
      capUsd: cap,
      agentSpentUsd: agentSpent,
      agentCapUsd: agentCap,
    }
  }

  // Global cap
  if (cap > 0 && total >= cap) {
    return {
      decision: 'refuse',
      reason: `daily cap of $${cap.toFixed(2)} reached`,
      spentTodayUsd: total,
      capRemainingUsd: 0,
      capUsd: cap,
      agentSpentUsd: agentSpent,
      agentCapUsd: agentCap,
    }
  }

  // Warning band
  if (cap > 0) {
    const frac = total / cap
    if (frac >= b.warnAt[b.warnAt.length - 1] - 0.001) {
      return {
        decision: 'warn',
        reason: `at ${Math.round(frac * 100)}% of daily cap`,
        spentTodayUsd: total,
        capRemainingUsd: cap - total,
        capUsd: cap,
        agentSpentUsd: agentSpent,
        agentCapUsd: agentCap,
      }
    }
  }

  return {
    decision: 'allow',
    spentTodayUsd: total,
    capRemainingUsd: cap > 0 ? cap - total : Infinity,
    capUsd: cap,
    agentSpentUsd: agentSpent,
    agentCapUsd: agentCap,
  }
}

// ---- warn-threshold tracker (file-of-record so we don't re-ping) ----------

const PINGED_FILE = join(homedir(), '.config', 'TerMinal', 'budget-pings.json')

function readPinged(): Record<string, number> {
  try {
    return existsSync(PINGED_FILE) ? JSON.parse(readFileSync(PINGED_FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}
function writePinged(p: Record<string, number>): void {
  try {
    writeFileSync(PINGED_FILE, JSON.stringify(p))
  } catch {
    /* best effort */
  }
}

const dayKey = (): string => new Date().toISOString().slice(0, 10)

/** Side-effect: if we just crossed a warnAt threshold today that hasn't been
 *  pinged yet, file a HITL + return the threshold we crossed. Called by the
 *  watcher loop. */
export function maybeCrossedThreshold(): { crossed: number; spent: number; cap: number } | null {
  const b = readBudgets()
  if (b.dailyTotalUsd <= 0) return null
  const summary = summaryFor('today')
  const frac = summary.totalUsd / b.dailyTotalUsd
  const pinged = readPinged()
  const today = dayKey()
  const last = pinged[today] || 0
  let crossed = 0
  for (const t of b.warnAt) {
    if (frac >= t - 0.001 && t > last) crossed = t
  }
  if (!crossed) return null
  // Update pinged BEFORE filing HITL so a slow file write doesn't double-fire
  pinged[today] = crossed
  writePinged(pinged)
  // File a HITL — uses the standard fileHitl path which already pings TG
  fileHitl({
    title: `Budget · ${Math.round(crossed * 100)}% of $${b.dailyTotalUsd.toFixed(2)}`,
    action:
      crossed >= 1
        ? 'Daily cap reached — new background spawns refused. /budget override <h> to bypass.'
        : `Heads up: $${summary.totalUsd.toFixed(2)} / $${b.dailyTotalUsd.toFixed(2)} spent today.`,
    detail: `Top spenders: ${Object.entries(summary.byModel)
      .sort((a, b) => b[1].usd - a[1].usd)
      .slice(0, 3)
      .map(([m, v]) => `${m} $${v.usd.toFixed(2)}`)
      .join(', ')}`,
    source: 'manual',
    // The cap being *reached* refuses new spawns — that's a block, it wants you
    // now. An intermediate warn ("50% of today's budget") changes nothing and
    // needs no action; it belongs in the inbox, not on your phone.
    severity: crossed >= 1 ? 'urgent' : 'normal',
  })
  return { crossed, spent: summary.totalUsd, cap: b.dailyTotalUsd }
}

let watchTimer: ReturnType<typeof setInterval> | null = null

export function startBudgetWatcher(): void {
  if (watchTimer) return
  // Check every 5 min (cheaper than the 5s spawn-gate, but plenty for
  // threshold pings since cron-fired runs land at minute boundaries).
  setTimeout(() => maybeCrossedThreshold(), 30_000)
  watchTimer = setInterval(() => maybeCrossedThreshold(), 5 * 60 * 1000)
}

export function stopBudgetWatcher(): void {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
}
