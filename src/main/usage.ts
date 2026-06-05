import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { readStatusLine } from './statusline'

// ---------------------------------------------------------------------------
// Plan usage — mirrors Claude Code's `/usage`.
//
// Source: GET https://api.anthropic.com/api/oauth/usage with the OAuth token
// Claude Code stores in the macOS keychain ("Claude Code-credentials"). The
// response carries rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}
// plus overage info. This endpoint is rate-limited, so we cache for 2 min and
// serve the last good value (and back off) on 429.
// ---------------------------------------------------------------------------

export type Window = { pct: number; resetsAt: number | null } | null
export type Usage = {
  ok: boolean
  plan: string
  tier: string
  fiveHour: Window
  sevenDay: Window
  overagePct: number | null
  stale: boolean
  error?: string
  ts: number
}

const TTL = 30_000
let cache: Usage | null = null
let backoffUntil = 0

function keychainOauth(): {
  accessToken: string
  subscriptionType?: string
  rateLimitTier?: string
} | null {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-a', userInfo().username, '-w'],
      { encoding: 'utf8' },
    )
    const o = JSON.parse(raw)
    return o.claudeAiOauth || o
  } catch {
    return null
  }
}

function win(w: any): Window {
  if (!w) return null
  const pct =
    typeof w.used_percentage === 'number'
      ? w.used_percentage
      : typeof w.utilization === 'number'
        ? w.utilization * 100
        : 0
  const resetsAt = typeof w.resets_at === 'number' ? w.resets_at : null
  return { pct, resetsAt }
}

export async function readUsage(sessionId?: string): Promise<Usage> {
  const now = Date.now()

  // Preferred source: the statusLine cache for the active session — zero API
  // calls, never throttled, and authoritative. Claude only emits rate_limits
  // after the first API response (and only for Pro/Max), so fall through to the
  // API when the cache lacks them.
  if (sessionId) {
    const sl = readStatusLine(sessionId)
    if (sl && (sl.fiveHour || sl.sevenDay)) {
      const creds = keychainOauth()
      return {
        ok: true,
        plan: creds?.subscriptionType || '',
        tier: creds?.rateLimitTier || '',
        fiveHour: sl.fiveHour ?? null,
        sevenDay: sl.sevenDay ?? null,
        overagePct: null,
        stale: false,
        ts: sl.ts,
      }
    }
  }

  if (cache && now - cache.ts < TTL) return cache
  if (now < backoffUntil && cache) return { ...cache, stale: true }

  const creds = keychainOauth()
  if (!creds?.accessToken) {
    cache = {
      ok: false,
      plan: '',
      tier: '',
      fiveHour: null,
      sevenDay: null,
      overagePct: null,
      stale: false,
      error: 'no Claude Code credentials',
      ts: now,
    }
    return cache
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'User-Agent': 'TerMinal',
      },
    })
    if (res.status === 429) {
      backoffUntil = now + 90_000
      return cache
        ? { ...cache, stale: true }
        : { ...empty(creds), stale: true, error: 'rate limited', ts: now }
    }
    if (!res.ok) {
      return cache
        ? { ...cache, stale: true }
        : { ...empty(creds), error: `http ${res.status}`, ts: now }
    }
    const j: any = await res.json()
    const rl = j.rate_limits || j.rateLimits || {}
    const overage =
      typeof j.overage?.used_percentage === 'number'
        ? j.overage.used_percentage
        : typeof j.extra_usage?.used_percentage === 'number'
          ? j.extra_usage.used_percentage
          : null
    cache = {
      ok: true,
      plan: creds.subscriptionType || j.plan || '',
      tier: creds.rateLimitTier || '',
      fiveHour: win(rl.five_hour),
      sevenDay: win(rl.seven_day),
      overagePct: overage,
      stale: false,
      ts: now,
    }
    return cache
  } catch (e) {
    return cache
      ? { ...cache, stale: true }
      : { ...empty(creds), error: String((e as Error).message), ts: now }
  }
}

function empty(creds: { subscriptionType?: string; rateLimitTier?: string }): Usage {
  return {
    ok: false,
    plan: creds.subscriptionType || '',
    tier: creds.rateLimitTier || '',
    fiveHour: null,
    sevenDay: null,
    overagePct: null,
    stale: false,
    ts: Date.now(),
  }
}
