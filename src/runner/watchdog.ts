// Fleet heartbeat. Every cron invocation sweeps stale runs; the dedicated
// `watchdog` action also checks that enabled schedules are still firing, and
// piggybacks the two rate-limited housekeeping jobs.
import type { HitlItem } from '../shared/types/activity'
import { HITL_FILE, readJson } from './config'
import { prevExpectedFire } from './cron-match'
import { readDisabled } from './disabled'
import { fileHitl } from './hitl'
import { activity, log } from './log'
import { maybeRunRetention } from './retention'
import { maybeRunReviewPatterns } from './review-patterns'
import { readSchedules } from './schedules'
import { sweepStaleRuns } from './runs'

// Open overdue HITLs, keyed by schedule id — so a stuck schedule pings once,
// not on every watchdog tick.
export function openOverdueHitlIds(): Set<string> {
  const list = readJson<HitlItem[]>(HITL_FILE())
  if (!Array.isArray(list)) return new Set()
  const ids = new Set<string>()
  for (const h of list) if (h.status === 'open' && h.overdueScheduleId) ids.add(h.overdueScheduleId)
  return ids
}

// Cadence health check: an enabled schedule that has missed its TWO most recent
// expected fires (2x-cadence tolerance) is overdue — launchd may have unloaded
// it or the plist drifted. lastRun is stamped at run START, so a long in-flight
// run never reads as overdue. Deduped against open overdue HITLs. Returns count.
export function watchdogCadenceCheck(): number {
  const schedules = readSchedules()
  const disabled = readDisabled()
  const openOverdue = openOverdueHitlIds()
  let overdue = 0
  const now = Date.now()
  for (const s of schedules) {
    if (!s.enabled) continue
    if (disabled.has(s.id)) continue // kill-switched — not expected to fire
    if (!s.lastRun) continue // never run yet — let it ride
    const prev = prevExpectedFire(s.spec, now)
    if (!prev) continue
    const prev2 = prevExpectedFire(s.spec, prev - 60_000)
    if (!prev2) continue
    if (s.lastRun >= prev2) continue // fired within the last 2 expected slots
    overdue++
    if (openOverdue.has(s.id)) continue // already flagged, don't re-ping
    const mins = Math.round((now - s.lastRun) / 60_000)
    fileHitl({
      overdueScheduleId: s.id,
      title: `Schedule overdue · ${s.agentTitle}`,
      action: `missed its last 2 expected fires — last ran ${mins} min ago. Check the launchd plist / re-enable from the Schedules tab.`,
      detail: `schedule ${s.id} · ${s.repoLabel}`,
      repo: s.repoLabel,
      repoRoot: s.repoRoot,
    })
    activity({
      kind: 'blocked',
      title: `Schedule overdue · ${s.agentTitle}`,
      detail: `${mins} min since last run`,
      repo: s.repoLabel,
      repoRoot: s.repoRoot,
      suppressTelegram: true,
    })
    log(`watchdog: schedule ${s.id} (${s.agentTitle}) overdue — last ran ${mins} min ago`)
  }
  return overdue
}

export async function runWatchdog(): Promise<number> {
  log('watchdog: tick')
  const swept = sweepStaleRuns()
  const overdue = watchdogCadenceCheck()
  log(`watchdog: swept=${swept} overdue=${overdue}`)
  activity({
    kind: 'check',
    title: `Watchdog · swept ${swept} stale · ${overdue} overdue`,
    detail: 'fleet heartbeat',
  })
  // Piggyback: once a week, mine review-finding patterns. Rate-limited via a
  // marker file so this watchdog tick stays cheap on every other day.
  try {
    await maybeRunReviewPatterns()
  } catch (e) {
    log(`review-patterns piggyback failed: ${e}`)
  }
  // Piggyback: once a day, the mechanical half of retention (ticket 0073).
  try {
    await maybeRunRetention()
  } catch (e) {
    log(`retention piggyback failed: ${e}`)
  }
  return 0
}
