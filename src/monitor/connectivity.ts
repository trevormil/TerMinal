// The local-connectivity gate (ADR-0024). The pure decisions live in
// src/shared/monitor-flap.ts; this module supplies the two things that cannot be
// pure — the reference requests, and the persisted verdict.
import {
  confirmsLocalOutage,
  isNetworkLayer,
  REFERENCE_PROBES as DEFAULT_REFERENCE_PROBES,
  suspectsLocalOutage,
  type CycleResult,
} from '../shared/monitor-flap'
import { log } from './paths'
import { categorizeFetchError } from './probes'
import { emitActivity } from './notify'
import { readConnectivity, writeConnectivity } from './state'
import { humanSince } from './compose'

// TERMINAL_MONITOR_REFERENCE_URLS exists so the pause/resume behaviour can be
// exercised without unplugging the machine — there is no other way to make a
// test observe a real local outage.
function referenceUrls(): readonly string[] {
  const override = (process.env.TERMINAL_MONITOR_REFERENCE_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return override.length ? override : DEFAULT_REFERENCE_PROBES
}

/**
 * Ask whether WE still have connectivity. Only ever called after
 * suspectsLocalOutage — two extra requests on a cycle where everything already
 * failed is free, and on every healthy cycle it costs nothing at all.
 */
async function referenceReachability(): Promise<boolean[]> {
  return Promise.all(
    referenceUrls().map(async (url) => {
      try {
        await fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          headers: { 'user-agent': 'terminal-monitor/1.0' },
        })
        // Any HTTP answer at all proves the packet made the round trip; the
        // status is irrelevant here.
        return true
      } catch (e) {
        // A refused/TLS error still proves reachability — only network-layer
        // errors count as "we are offline".
        return !isNetworkLayer(await categorizeFetchError(url, e))
      }
    }),
  )
}

/** Resolve the connectivity verdict for a set of cycle results. */
export async function localOutageVerdict(results: readonly CycleResult[]): Promise<boolean> {
  if (!suspectsLocalOutage(results)) return false
  return confirmsLocalOutage(await referenceReachability())
}

/** Persist the verdict for the UI, and announce only the EDGES to Activity. */
export function recordConnectivity(offline: boolean, now: number): void {
  const prev = readConnectivity()
  if (prev.offline === offline) return
  writeConnectivity({ offline, since: now })
  if (offline) {
    emitActivity(
      'check',
      'Monitoring paused — no local connectivity',
      'Every check failed at the network layer and both reference hosts were unreachable, so this machine is offline. Checks are not counting and no alerts will be filed until connectivity returns.',
    )
  } else {
    const downFor = prev.since ? humanSince(prev.since, now) : ''
    emitActivity(
      'check',
      'Monitoring resumed — local connectivity restored',
      `Reference hosts are reachable again${downFor ? ` (paused since ${downFor})` : ''}. Failure counters were reset, so a monitor must fail afresh before it alerts.`,
    )
  }
  log(`connectivity ${offline ? 'LOST' : 'RESTORED'}`)
}
