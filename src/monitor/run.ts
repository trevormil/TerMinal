// Running a monitor: probe, then commit.
//
// The two halves are separated on purpose. The connectivity verdict has to be
// decided for the WHOLE cycle before any state is written — the old shape wrote
// and alerted monitor-by-monitor, which is precisely why one dropped uplink
// produced one urgent item per monitor (ADR-0024).
import { applyThreshold, normalizeMinConsecutiveFailures } from '../shared/monitor-flap'
import { needsConfirmation } from '../shared/monitor-classify'
import { compose } from './compose'
import { localOutageVerdict, recordConnectivity } from './connectivity'
import { fileInbox } from './notify'
import { log } from './paths'
import { probe } from './probes'
import { readState, writeState } from './state'
import type { MonitorState, ProbeResult, Severity, StoredMonitor, StoredState } from './types'

export type Probed = {
  m: StoredMonitor
  prev: StoredState | null
  prevStatus: MonitorState
  res: ProbeResult
}

/** Phase 1: probe (with the confirm re-probe) and report — writes NO state. */
export async function probeOne(m: StoredMonitor): Promise<Probed> {
  const prev = readState(m.id)
  const prevStatus: MonitorState =
    prev && ['ok', 'warn', 'fail'].includes(prev.status) ? prev.status : 'ok'
  let res = await probe(m)
  if (needsConfirmation(prevStatus, res.status)) {
    const raw = Number(m.config?.confirmDelayMs)
    const delayMs = Number.isFinite(raw) && raw >= 0 ? raw : 5000
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    res = await probe(m)
  }
  return { m, prev, prevStatus, res }
}

/** Phase 2: fold the observation into published state and alert if warranted. */
export function commitOne(
  { m, prev, prevStatus, res }: Probed,
  now: number,
  localOutage: boolean,
): StoredState {
  const decision = applyThreshold({
    prev: { status: prevStatus, consecutiveFailures: prev?.consecutiveFailures },
    observed: res.status,
    minConsecutiveFailures: m.minConsecutiveFailures as number,
    localOutage,
  })
  const next = decision.status
  const notify = m.notify || {}

  if (decision.paused) {
    // Nothing about the monitor's health was learned, so nothing about it is
    // published — only the fact that the check was skipped and the counter
    // cleared, so resuming cannot complete a run of failures begun earlier.
    const state: StoredState = {
      ...(prev || { id: m.id, status: next, summary: '', history: [] }),
      id: m.id,
      status: next,
      lastCheckedAt: now,
      consecutiveFailures: 0,
      paused: true,
      pausedSince: prev?.pausedSince || now,
    }
    writeState(m.id, state)
    log(`run ${m.id} (${m.type}) skipped — no local connectivity`)
    return state
  }

  const changed = decision.changed
  const state: StoredState = {
    id: m.id,
    status: next,
    summary: res.summary || '',
    metrics: res.metrics,
    detail: res.detail,
    lastCheckedAt: now,
    since: changed ? now : prev?.since || now,
    lastTransition: changed
      ? { from: prevStatus, to: next, at: now }
      : prev?.lastTransition || null,
    history: [
      { at: now, status: next },
      ...(Array.isArray(prev?.history) ? prev.history : []),
    ].slice(0, 100),
    consecutiveFailures: decision.consecutiveFailures,
    // The raw verdict, kept when the threshold held it back, so the UI can say
    // "1 recent blip" instead of pretending the check was clean.
    observed: res.status,
    category: res.status === 'ok' ? undefined : res.category,
    paused: false,
  }
  writeState(m.id, state)

  // Re-nag a still-failing check after its window — only for a state that was
  // actually published as failing, never for suppressed blips.
  const renotifySec = Number(notify.renotifyAfterSec) || 0
  const lastAlertAt = prev?.lastTransition?.at ?? prev?.since ?? now
  const dueRenotify =
    !changed && next !== 'ok' && renotifySec && now - lastAlertAt >= renotifySec * 1000
  if (decision.alert || dueRenotify) {
    if (next === 'ok' && notify.onRecovery !== false) {
      const { title, body } = compose(m, prevStatus, next, res, now, state.since as number)
      fileInbox(title, body, 'low')
    } else if (next !== 'ok') {
      const sev: Severity =
        notify.onFailure && notify.onFailure !== 'off' ? notify.onFailure : 'urgent'
      if (notify.onFailure !== 'off') {
        const { title, body } = compose(
          m,
          prevStatus,
          next,
          res,
          now,
          state.since as number,
          decision.consecutiveFailures,
        )
        fileInbox(title, body, sev)
      }
    }
  }
  const suffix = decision.suppressed
    ? ` (blip ${decision.consecutiveFailures}/${normalizeMinConsecutiveFailures(m.minConsecutiveFailures)}, held)`
    : changed
      ? ' *'
      : ''
  log(`run ${m.id} (${m.type}) ${prevStatus}→${next}${suffix}`)
  return state
}

/** One monitor, end to end. `localOutage` null ⇒ decide it for this monitor. */
export async function runOne(
  m: StoredMonitor,
  now: number,
  localOutage: boolean | null = null,
): Promise<StoredState> {
  const probed = await probeOne(m)
  const offline =
    localOutage === null
      ? await localOutageVerdict([
          { failed: probed.res.status !== 'ok', category: probed.res.category },
        ])
      : localOutage
  if (localOutage === null) recordConnectivity(offline, now)
  return commitOne(probed, now, offline)
}
