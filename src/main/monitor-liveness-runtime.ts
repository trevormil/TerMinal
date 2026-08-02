// The real-world wiring for the monitor-liveness policy (ticket 117).
//
// Split from monitor-liveness.ts on purpose: everything that touches launchctl,
// the filesystem, or the Inbox lives HERE, so the policy module stays pure and
// its tests can never shell out. A test for a notification path is the last
// place to risk a real effect — this suite pinged the operator's phone twice in
// one day already.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readJsonState, writeJsonAtomic } from './atomic-write'
import { configPath } from './config-dir'
import { fileHitl } from './hitl'
import { listMonitorsWithStatus } from './monitors'
import {
  checkMonitorDaemon,
  daemonHealth,
  type LivenessDeps,
  type LivenessOutcome,
  type LivenessState,
} from '../shared/monitor-liveness'

const execFileAsync = promisify(execFile)

/** launchd label for the monitoring daemon (see installMonitorDaemon). */
export const MONITOR_LABEL = 'com.terminal.monitor'

const stateFile = (): string => configPath('monitor-liveness.json')

/**
 * How often the app re-checks. Slow on purpose: the thing being detected lasted
 * 23 hours, so five minutes of detection latency is irrelevant, while a fast
 * timer would mean 276 chances to get the escalation logic wrong per outage.
 */
export const LIVENESS_TICK_MS = 5 * 60_000

async function launchctl(args: string[]): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('launchctl', args, { timeout: 10_000 })
    return { ok: true, detail: (stdout || stderr || '').slice(0, 4000) }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export function realLivenessDeps(): LivenessDeps {
  return {
    now: () => Date.now(),
    readState: () =>
      readJsonState<LivenessState>(stateFile(), () => ({}), {
        accept: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
      }).value,
    writeState: (next) => {
      try {
        writeJsonAtomic(stateFile(), next)
      } catch {
        // Bookkeeping only. Failing to persist means at worst one extra inbox
        // item; throwing here would take out the whole tick.
      }
    },
    kickstart: () =>
      launchctl(['kickstart', '-k', `gui/${process.getuid?.() ?? 501}/${MONITOR_LABEL}`]),
    diagnose: async () => {
      const printed = await launchctl([
        'print',
        `gui/${process.getuid?.() ?? 501}/${MONITOR_LABEL}`,
      ])
      // Keep the fields that actually distinguished the failure: the job was
      // loaded, enabled, last exit 0, and `runs` simply never incremented.
      const keep = /^\s*(state|runs|last exit code|pid|program|pended)\b/i
      const lines = printed.detail
        .split('\n')
        .filter((l) => keep.test(l))
        .map((l) => l.trim())
      return lines.length
        ? lines.join('\n')
        : printed.detail.slice(0, 800) || 'launchctl print returned nothing'
    },
    fileHitl: (item) =>
      fileHitl({
        title: item.title,
        action: item.action,
        detail: item.detail,
        source: 'monitor',
        severity: 'urgent',
        // First real caller of the category field (ticket 120). Nothing was
        // registered to make this work — passing the string IS the API.
        category: 'Monitoring',
      }),
  }
}

/** One liveness tick against the live monitor set. Never throws. */
export async function monitorLivenessTick(
  deps: LivenessDeps = realLivenessDeps(),
): Promise<LivenessOutcome | 'skipped'> {
  // launchd is macOS-only; on other platforms the daemon is a systemd timer and
  // kickstart/print would be meaningless. Better to do nothing than to file an
  // inbox item whose remedy does not exist on the operator's machine.
  if (process.platform !== 'darwin') return 'skipped'
  try {
    const rows = listMonitorsWithStatus()
    const statusById = new Map(rows.map((r) => [r.id, r.state]))
    const health = daemonHealth(rows, (id) => statusById.get(id) ?? null, deps.now())
    return await checkMonitorDaemon(health, deps)
  } catch (e) {
    console.error('[gt] monitor liveness tick failed:', e)
    return 'skipped'
  }
}

let timer: ReturnType<typeof setInterval> | null = null

export function startMonitorLivenessWatch(): void {
  if (timer) return
  // A dead daemon cannot report itself dead, so this check must live in a
  // process that is definitely running — the app the operator is looking at.
  timer = setInterval(() => void monitorLivenessTick(), LIVENESS_TICK_MS)
  void monitorLivenessTick()
}

export function stopMonitorLivenessWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
}
