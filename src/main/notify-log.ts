// Alert delivery log (ticket #0080).
//
// `dispatchAlert` isolates per-channel failures so one dead webhook can't block
// the others — correct, but it meant a revoked bot token or a stale webhook URL
// failed silently forever. This is the record: last N attempts per channel with
// the failure reason, plus a consecutive-failure count so a persistently broken
// channel can be escalated to Activity exactly once per streak.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type DeliveryRecord = {
  ts: number
  channel: string
  ok: boolean
  title: string
  error?: string
}

/** Keep the log short — it is a debugging aid, not an audit trail. */
export const MAX_DELIVERY_RECORDS = 100

/** Consecutive failures on one channel before we escalate to Activity. */
export const FAILURE_ESCALATION_THRESHOLD = 3

export function readDeliveryLog(file: string): DeliveryRecord[] {
  try {
    if (!existsSync(file)) return []
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function appendDeliveryRecord(
  log: DeliveryRecord[],
  record: DeliveryRecord,
): DeliveryRecord[] {
  return [...log, record].slice(-MAX_DELIVERY_RECORDS)
}

/** Failures at the tail of the log for one channel — reset by any success. */
export function consecutiveFailures(log: DeliveryRecord[], channel: string): number {
  let n = 0
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i]
    if (r.channel !== channel) continue
    if (r.ok) break
    n++
  }
  return n
}

/**
 * Escalate on the run of failures that *crosses* the threshold, and only then —
 * so a channel that has been dead for 40 alerts files one Activity event, not
 * 38. Crossing again requires a success in between to reset the streak.
 */
export function shouldEscalate(log: DeliveryRecord[], channel: string): boolean {
  return consecutiveFailures(log, channel) === FAILURE_ESCALATION_THRESHOLD
}

/** Most recent first, optionally narrowed to one channel. */
export function recentDeliveries(
  log: DeliveryRecord[],
  opts: { channel?: string; limit?: number } = {},
): DeliveryRecord[] {
  const { channel, limit = 25 } = opts
  return [...log]
    .reverse()
    .filter((r) => !channel || r.channel === channel)
    .slice(0, limit)
}

export function writeDeliveryLog(file: string, log: DeliveryRecord[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(log.slice(-MAX_DELIVERY_RECORDS), null, 2))
  } catch {
    /* best effort — losing the log must never break delivery */
  }
}
