// Schedule trigger routing (ADR-0002). A schedule fires either locally (launchd,
// via launchd.ts) or on an always-on host (systemd --user, via systemd.ts). This
// module is the single decision point: given a schedule's `host`, dispatch
// sync/remove/reconcile to the right layer, and for host schedules also mirror
// the record into the host's schedules.json so its runner can find it.
//
// All host handling is by hostId → RemoteHost lookup; nothing is host-name
// specific. Dependencies are injected (RouterDeps) so the dispatch logic is
// unit-testable without SSH or launchd.

import { syncSchedule, unscheduleJob, reconcileSchedules } from './launchd'
import { syncScheduleOnHost, reconcileSchedulesOnHost, type SystemdHost } from './systemd'
import { applyScheduleOnHost, removeScheduleOnHost, reconcileScheduleCronJobs } from './k8s'
import { remoteSchedules, type RemoteSessionRef } from './remote'
import { readSettings, type RemoteHost } from './settings'
import type { Schedule } from './schedules'

export type ReconcileResult = { loaded: number; removed: number; failed: { id: string; error: string }[] }

export type RouterDeps = {
  launchdSync: (s: Schedule) => { ok: boolean; error?: string }
  launchdUnschedule: (id: string) => void
  launchdReconcile: () => ReconcileResult
  systemdSync: (host: SystemdHost, s: Schedule) => Promise<{ ok: boolean; error?: string }>
  systemdReconcile: (host: SystemdHost, schedules: Schedule[]) => Promise<ReconcileResult>
  // k8s (runtime:'k8s') → CronJob on the host's k3s instead of a systemd timer (#16).
  k8sApply: (sshTarget: string, s: Schedule) => Promise<{ ok: boolean; error?: string }>
  k8sRemove: (sshTarget: string, s: Schedule) => Promise<{ ok: boolean; error?: string }>
  k8sReconcile: (sshTarget: string, schedules: Schedule[]) => Promise<ReconcileResult>
  pushRecord: (ref: RemoteSessionRef, s: Schedule) => Promise<unknown>
  removeRecord: (ref: RemoteSessionRef, id: string) => Promise<unknown>
  hosts: () => RemoteHost[]
}

const realDeps: RouterDeps = {
  launchdSync: syncSchedule,
  launchdUnschedule: unscheduleJob,
  launchdReconcile: reconcileSchedules,
  systemdSync: syncScheduleOnHost,
  systemdReconcile: reconcileSchedulesOnHost,
  k8sApply: (t, s) => applyScheduleOnHost(t, s),
  k8sRemove: (t, s) => removeScheduleOnHost(t, s),
  k8sReconcile: (t, ss) => reconcileScheduleCronJobs(t, ss),
  pushRecord: (ref, s) => remoteSchedules.save(ref, s),
  removeRecord: (ref, id) => remoteSchedules.remove(ref, id),
  hosts: () => readSettings().remoteHosts,
}

export function triggerLayerFor(s: Schedule): 'launchd' | 'systemd' {
  return s.host ? 'systemd' : 'launchd'
}

const sessionRef = (h: RemoteHost): RemoteSessionRef => ({
  hostId: h.id,
  label: h.label,
  sshTarget: h.sshTarget,
  cwd: h.defaultCwd || undefined,
  platform: h.platform,
  daemon: h.daemon,
})
const systemdHost = (h: RemoteHost): SystemdHost => ({ sshTarget: h.sshTarget })

// Install/enable a schedule's trigger. Local → launchd. Host → mirror the record
// into the host's schedules.json (so its runner resolves the id) then install the
// systemd timer. Returns {ok,error} so callers surface a silent failure.
export async function routeSyncSchedule(s: Schedule, deps: RouterDeps = realDeps): Promise<{ ok: boolean; error?: string }> {
  if (!s.host) {
    // Local schedules ride launchd, which is macOS-only (see ADR-0003). On any
    // other platform, surface a real reason instead of the mystery "dark" badge
    // launchctl's swallowed failure would otherwise produce.
    if (process.platform !== 'darwin')
      return { ok: false, error: 'local scheduling requires macOS — assign this schedule to a remote host' }
    return deps.launchdSync(s)
  }
  const host = deps.hosts().find((h) => h.id === s.host)
  if (!host) return { ok: false, error: `unknown host: ${s.host}` }
  try {
    // Both systemd and k8s run the same runner reading the host's schedules.json,
    // so the record push is shared; only the trigger differs.
    await deps.pushRecord(sessionRef(host), s)
  } catch (e) {
    return { ok: false, error: `push schedule to host: ${(e as Error).message}` }
  }
  // systemdSync handles enabled:false by removing the unit; the k8s path must
  // mirror that — a disabled k8s schedule deletes its CronJob rather than
  // (re)applying one that would keep firing.
  if (s.runtime === 'k8s') return s.enabled ? deps.k8sApply(host.sshTarget, s) : deps.k8sRemove(host.sshTarget, s)
  return deps.systemdSync(systemdHost(host), s)
}

// Tear down a schedule's trigger. Local → unschedule the launchd job. Host →
// drop the host's schedules.json record and remove the systemd unit (a disabled
// sync). `s` carries the host binding so we know which layer owns it.
export async function routeRemoveSchedule(s: Schedule, deps: RouterDeps = realDeps): Promise<{ ok: boolean; error?: string }> {
  if (!s.host) {
    deps.launchdUnschedule(s.id)
    return { ok: true }
  }
  const host = deps.hosts().find((h) => h.id === s.host)
  if (!host) return { ok: false, error: `unknown host: ${s.host}` }
  try {
    await deps.removeRecord(sessionRef(host), s.id)
  } catch {
    /* best effort — still remove the trigger below */
  }
  return s.runtime === 'k8s'
    ? deps.k8sRemove(host.sshTarget, s)
    : deps.systemdSync(systemdHost(host), { ...s, enabled: false })
}

// Reconcile ONLY the host (systemd) trigger layers: one systemd reconcile per
// distinct host that owns schedules. Each reconcile SSHes to its host, so this
// is fire-and-forgettable at app launch (a slow/unreachable host mustn't block
// startup). A host with no schedules is skipped.
export async function reconcileHosts(all: Schedule[], deps: RouterDeps = realDeps): Promise<ReconcileResult> {
  const agg: ReconcileResult = { loaded: 0, removed: 0, failed: [] }
  const byHost = new Map<string, Schedule[]>()
  for (const s of all) if (s.host) (byHost.get(s.host) ?? byHost.set(s.host, []).get(s.host)!).push(s)

  const hosts = deps.hosts()
  for (const [hostId, schedules] of byHost) {
    const host = hosts.find((h) => h.id === hostId)
    if (!host) {
      agg.failed.push({ id: `host:${hostId}`, error: `unknown host: ${hostId}` })
      continue
    }
    // Split by trigger: systemd timers vs k8s CronJobs. Each reconcile removes its
    // own orphans, so a schedule that switched runtimes is cleaned by the layer it
    // left (its old timer/CronJob no longer appears in the other's wanted set).
    const k8sScheds = schedules.filter((s) => s.runtime === 'k8s')
    const sysScheds = schedules.filter((s) => s.runtime !== 'k8s')
    const rs = await deps.systemdReconcile(systemdHost(host), sysScheds)
    agg.loaded += rs.loaded
    agg.removed += rs.removed
    agg.failed.push(...rs.failed)
    if (k8sScheds.length) {
      const rk = await deps.k8sReconcile(host.sshTarget, k8sScheds)
      agg.loaded += rk.loaded
      agg.removed += rk.removed
      agg.failed.push(...rk.failed)
    }
  }
  return agg
}

// Reconcile every trigger layer: launchd for local schedules (filtered inside
// launchd.reconcileSchedules), plus reconcileHosts for the systemd side.
// Aggregates counts. Used by the on-demand reconcile IPC (safe to await).
export async function routeReconcile(all: Schedule[], deps: RouterDeps = realDeps): Promise<ReconcileResult> {
  const local = deps.launchdReconcile()
  const hosts = await reconcileHosts(all, deps)
  return {
    loaded: local.loaded + hosts.loaded,
    removed: local.removed + hosts.removed,
    failed: [...local.failed, ...hosts.failed],
  }
}
