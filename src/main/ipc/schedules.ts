// Schedules IPC (ticket 91 index.ts decomposition). The launchd/systemd/k8s
// scheduling surface: CRUD + run-now routing + disabled toggles + reconcile.
// Session context (active repo/session, attached remote, host lookup) is
// injected via deps so this module stays free of index.ts's pty state.

import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { emitActivity } from '../events'
import {
  readSchedules,
  addSchedule,
  updateSchedule,
  removeSchedule,
  toggleSchedule,
  getSchedule,
  type NewSchedule,
} from '../schedules'
import { describeSpec, nextRun, type ScheduleSpec } from '../cron'
import { removeAllJobs, runScheduleNow, scheduleLoadedState, unscheduleJob } from '../launchd'
import {
  routeSyncSchedule,
  routeRemoveSchedule,
  routeReconcile,
  routeRunNow,
} from '../schedule-router'
import { ensureHostRepo } from '../host-repo'
import { readSettings } from '../settings'
import { remoteProbe, remoteSchedules, type RemoteSessionRef } from '../remote'
import { readCronRuns, readCronRunLog } from '../cron-runs'
import { repoForCwd, repoRootOf } from '../repo'
import { readAgents } from '../agent-registry'
import { runScheduleDesignerSpawn, type Agent, type Engine } from '../agents'
import {
  listDisabledDetail,
  setDisabled as setAgentDisabled,
  setAllDisabled as setAllSchedulesDisabled,
} from '../agents-disabled'
import { hostBreakerState, setHostDisabled, type HostBreakerSnapshot } from '../host-disabled'
import {
  REMOTE_ENABLED_REJECTION,
  remoteMutation,
  teardownWarning,
  type MutationResult,
} from '../schedule-honesty'

/** Breaker state for the UI: local entries (no host) plus each host's own, and
 *  the hosts we could not read — never silently "nothing disabled". */
export type DisabledDetailResult = {
  entries: { id: string; reason?: string; disabledAt: number; host?: string; hostLabel?: string }[]
  errors: HostBreakerSnapshot['errors']
}

export type SchedulesIpcDeps = {
  /** The active tab's pinned session (cwd + sessionId are all this module reads). */
  cur(): { cwd: string; sessionId: string }
  /** The attached remote session, if the active tab is remote. */
  curRemote(): RemoteSessionRef | undefined
  repoLabelFor(cwdOrRoot: string): string
  /** Defaults merged with the remote host's agent list. */
  remoteAgentCatalog(remote: RemoteSessionRef): Promise<Agent[]>
  remoteFromHostId(hostId: string): RemoteSessionRef | null
}

export function registerSchedulesIpc(deps: SchedulesIpcDeps): void {
  ipcMain.handle('schedules:design', (_e, text: string, engine: Engine) =>
    deps.curRemote()
      ? { error: 'remote schedule design needs the remote daemon writer' }
      : runScheduleDesignerSpawn(repoRootOf(deps.cur().cwd), text, engine),
  )

  ipcMain.handle('schedules:list', () => {
    const now = Date.now()
    const remote = deps.curRemote()
    if (remote) {
      return (
        remoteSchedules
          .list(remote)
          .then((rows) =>
            rows.map((s) => ({
              ...s,
              describe: describeSpec(s.spec),
              nextRun: nextRun(s.spec, now),
            })),
          )
          // NOT `.catch(() => [])`: an unreachable host read as "no schedules",
          // making a network blip indistinguishable from every cron job on that
          // host having been deleted. Surface the failure instead.
          .catch((e) => {
            const message = String((e as Error)?.message || e)
            console.error(`[gt] schedules:list remote failed: ${message}`)
            emitActivity({
              kind: 'error',
              title: `Could not reach ${remote.label || remote.sshTarget}`,
              detail: `Schedule list unavailable — ${message}`,
            })
            return []
          })
      )
    }
    return readSchedules(now).map((s) => ({
      ...s,
      describe: describeSpec(s.spec),
      // Calendar/cron jobs fire at fixed wall-clock times, so the next fire is a
      // pure function of the spec — no load-time anchor needed.
      nextRun: nextRun(s.spec, now),
      // Real "will it fire?" signal — probes launchd for LOCAL schedules only; a
      // host schedule (systemd/k8s) has no launchd job by design (see helper).
      loaded: scheduleLoadedState(s),
    }))
  })
  ipcMain.handle(
    'schedules:save',
    async (
      _e,
      input: {
        id?: string
        agentId: string
        engine: Engine
        model?: string
        effort?: string
        spec: ScheduleSpec
        enabled?: boolean
        env?: Record<string, string>
        retry?: { maxRetries: number; backoffSec: number }
        timeoutSec?: number
        host?: string // hostId → fire on that host via systemd (ADR-0002); absent → local launchd
        runtime?: 'bare' | 'container' | 'k8s'
      },
    ) => {
      // Normalize the optional flaky-run knobs; drop anything non-numeric so a
      // half-filled editor field never writes garbage into schedules.json.
      const retry =
        input.retry && Number.isFinite(input.retry.maxRetries)
          ? {
              maxRetries: Math.max(0, Math.floor(input.retry.maxRetries)),
              backoffSec: Math.max(1, Math.floor(Number(input.retry.backoffSec) || 30)),
            }
          : undefined
      const timeoutSec =
        Number.isFinite(input.timeoutSec) && (input.timeoutSec as number) > 0
          ? Math.floor(input.timeoutSec as number)
          : undefined
      const remote = deps.curRemote()
      if (remote) {
        // This path writes a RECORD on the host and installs no trigger (that
        // needs the remote daemon writer), so `enabled: true` would render a
        // healthy row that never fires. Refuse it instead of lying; Run Now
        // still works over SSH. Same honesty as 'pause-all is local-only'.
        if (input.enabled !== false) return { error: REMOTE_ENABLED_REJECTION }
        return (async () => {
          const probe = await remoteProbe(remote).catch(() => null)
          const agents = await deps.remoteAgentCatalog(remote)
          const agent = agents.find((a) => a.id === input.agentId)
          if (!agent) return { error: 'unknown agent' }
          const sched = {
            id: input.id || randomUUID(),
            repoRoot: probe?.repoRoot || '',
            repoLabel: deps.repoLabelFor(deps.cur().cwd),
            agentId: agent.id,
            agentTitle: agent.title,
            engine: input.engine || agent.engine || remote.daemon?.defaultEngine || 'codex',
            model: input.model ?? agent.model,
            effort: input.effort ?? agent.effort,
            prompt: agent.prompt,
            spec: input.spec,
            enabled: false,
            env: sanitizeScheduleEnv(input.env),
            retry,
            timeoutSec,
            createdAt: Date.now(),
            lastStatus: 'never' as const,
          }
          const r = await remoteSchedules.save(remote, sched)
          emitActivity({
            kind: 'check',
            title: `Remote schedule ${input.id ? 'updated' : 'created'} · ${agent.title}`,
            detail: `${sched.engine}${sched.model ? `/${sched.model}` : ''} · ${describeSpec(sched.spec)} · Run Now works over SSH; recurring timers need remote daemon install`,
            repo: sched.repoLabel,
            sessionId: deps.cur().sessionId,
          })
          return {
            ...r,
            warning:
              'saved PAUSED — an attached-remote save installs no recurring timer; use Run Now, or create it from the local control plane with the host selector',
          }
        })()
      }
      const root = repoRootOf(deps.cur().cwd)
      if (!root) return { error: 'not a git repo' }
      const agent = readAgents(root).find((a) => a.id === input.agentId)
      if (!agent) return { error: 'unknown agent' }
      // Host-targeted schedule: store the HOST repo path (~/repos/<name>, expanded by
      // the runner on the host) and ensure the repo is cloned there — the Mac repo
      // path wouldn't exist on the host, so the runner's worktree base would fail (#18).
      let hostRepoRootPath: string | undefined
      if (input.host) {
        const h = readSettings().remoteHosts.find((x) => x.id === input.host)
        if (!h) return { error: `unknown host: ${input.host}` }
        const er = await ensureHostRepo(h.sshTarget, root)
        if (!er.ok) return { error: `host repo: ${er.error}` }
        hostRepoRootPath = er.repoRoot
      }
      const base: NewSchedule = {
        repoRoot: hostRepoRootPath || root,
        repoLabel: repoForCwd(deps.cur().cwd)?.path || basename(root),
        agentId: agent.id,
        agentTitle: agent.title,
        engine: input.engine || agent.engine || 'codex',
        model: input.model ?? agent.model,
        effort: input.effort ?? agent.effort,
        prompt: agent.prompt, // snapshot — runner uses this offline
        spec: input.spec,
        enabled: input.enabled ?? true,
        // Drop empty/whitespace-only keys so a half-filled editor doesn't pollute
        // the spawn env with bogus blanks; treat missing field as "no env vars".
        env: sanitizeScheduleEnv(input.env),
        retry,
        timeoutSec,
        host: input.host || undefined,
        runtime: input.runtime,
      }
      // Capture the prior schedule BEFORE the update so we can tear down its old
      // trigger if host or runtime changed — otherwise switching host A→B, k8s→bare,
      // bare→k8s, or local↔host would leave the previous timer/CronJob/plist firing.
      const prev = input.id ? getSchedule(input.id) : null
      const sched = input.id ? updateSchedule(input.id, base) : addSchedule(base)
      if (!sched) return { error: 'schedule not found' }
      // A teardown that fails leaves the OLD timer firing forever. It used to be
      // `.catch(() => {})`; carry the failure out in the save result so the UI
      // can say which host still holds a live trigger.
      let warning: string | undefined
      if (prev && (prev.host !== sched.host || prev.runtime !== sched.runtime)) {
        const torn = await routeRemoveSchedule(prev).catch((e) => ({
          ok: false,
          error: (e as Error)?.message || String(e),
        }))
        if (!torn.ok)
          warning = teardownWarning(
            prev,
            prev.host
              ? readSettings().remoteHosts.find((h) => h.id === prev.host)?.label
              : undefined,
            torn.error,
          )
      }
      const r = await routeSyncSchedule(sched)
      if (!r.ok) return { error: r.error }
      emitActivity({
        kind: 'check',
        title: `Schedule ${input.id ? 'updated' : 'created'} · ${agent.title}`,
        detail: `${sched.engine}${sched.model ? `/${sched.model}` : ''} · ${describeSpec(sched.spec)}`,
        repo: sched.repoLabel,
        repoRoot: root,
        sessionId: deps.cur().sessionId,
      })
      if (warning) {
        emitActivity({
          kind: 'error',
          title: `Old trigger left behind · ${agent.title}`,
          detail: warning,
          repo: sched.repoLabel,
          repoRoot: root,
          sessionId: deps.cur().sessionId,
        })
      }
      return warning ? { ok: true, id: sched.id, warning } : { ok: true, id: sched.id }
    },
  )

  function sanitizeScheduleEnv(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = k.trim()
      if (!key) continue
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue // POSIX-shaped var names only
      out[key] = String(v ?? '')
    }
    return Object.keys(out).length ? out : undefined
  }
  ipcMain.handle('schedules:remove', async (_e, id: string): Promise<MutationResult> => {
    const remote = deps.curRemote()
    // Was `.catch(() => false)`: an unreachable host looked exactly like the host
    // refusing, so a schedule the SSH failure left in place read as removed.
    if (remote)
      return remoteMutation(remote.label || remote.sshTarget, () =>
        remoteSchedules.remove(remote, id),
      )
    const s = getSchedule(id)
    // Removing the local record while the HOST's timer survives is the same
    // silent-orphan bug as a failed host switch — carry the failure out.
    let warning: string | undefined
    if (s) {
      const torn = await routeRemoveSchedule(s).catch((e) => ({
        ok: false,
        error: (e as Error)?.message || String(e),
      }))
      if (!torn.ok)
        warning = teardownWarning(
          s,
          s.host ? readSettings().remoteHosts.find((h) => h.id === s.host)?.label : undefined,
          torn.error,
        )
    } else unscheduleJob(id)
    const ok = removeSchedule(id)
    if (ok) {
      emitActivity({
        kind: 'check',
        title: `Schedule removed · ${s?.agentTitle || id}`,
        detail: s ? describeSpec(s.spec) : id,
        repo: s?.repoLabel,
        repoRoot: s?.repoRoot,
        sessionId: deps.cur().sessionId,
      })
    }
    if (warning)
      emitActivity({
        kind: 'error',
        title: `Old trigger left behind · ${s?.agentTitle || id}`,
        detail: warning,
        repo: s?.repoLabel,
        repoRoot: s?.repoRoot,
        sessionId: deps.cur().sessionId,
      })
    if (!ok) return { ok: false, reason: 'refused', error: `no such schedule: ${id}` }
    return warning ? { ok: true, warning } : { ok: true }
  })
  ipcMain.handle(
    'schedules:toggle',
    async (_e, id: string, enabled: boolean): Promise<MutationResult> => {
      const remote = deps.curRemote()
      if (remote)
        return remoteMutation(remote.label || remote.sshTarget, () =>
          remoteSchedules.toggle(remote, id, enabled),
        )
      return toggleLocal(id, enabled)
    },
  )
  async function toggleLocal(id: string, enabled: boolean): Promise<MutationResult> {
    const ok = toggleSchedule(id, enabled)
    const s = getSchedule(id)
    let warning: string | undefined
    if (s) {
      const synced = await routeSyncSchedule(s).catch((e) => ({
        ok: false,
        error: (e as Error)?.message || String(e),
      }))
      // A failed sync means the record says one thing and the trigger layer
      // another — most often a host we could not reach. Say so.
      if (!synced.ok)
        warning = `${enabled ? 'enabled' : 'paused'} locally, but the trigger did not update: ${synced.error || 'unknown error'}`
      if (ok) {
        emitActivity({
          kind: 'check',
          title: `Schedule ${enabled ? 'enabled' : 'paused'} · ${s.agentTitle}`,
          detail: describeSpec(s.spec),
          repo: s.repoLabel,
          repoRoot: s.repoRoot,
          sessionId: deps.cur().sessionId,
        })
      }
    }
    if (!ok) return { ok: false, reason: 'refused', error: `no such schedule: ${id}` }
    return warning ? { ok: true, warning } : { ok: true }
  }
  // Fire a schedule's run on a remote — the same mechanism as the Runs-tab
  // re-run (remote-helper `schedules.runNow` over SSH).
  async function remoteRunNow(
    remote: RemoteSessionRef,
    id: string,
  ): Promise<{ ok: true } | { error: string }> {
    const sched = (await remoteSchedules.list(remote).catch(() => [])).find((s) => s.id === id)
    const run = await remoteSchedules.runNow(remote, id, {
      worktreesDir: remote.daemon?.worktreesDir,
      enginePath: sched ? remote.daemon?.engines?.[sched.engine]?.path : undefined,
    })
    if ('error' in run) return run
    emitActivity({
      kind: 'agent-run',
      title: `Remote schedule run requested · ${sched?.agentTitle || id}`,
      detail: sched ? `${sched.engine}${sched.model ? `/${sched.model}` : ''}` : id,
      repo: sched?.repoLabel || deps.repoLabelFor(deps.cur().cwd),
      sessionId: deps.cur().sessionId,
      runId: run.id,
      runSource: 'cron',
    })
    return { ok: true }
  }
  ipcMain.handle('schedules:run-now', (_e, id: string, hostId?: string) => {
    // Routed by routeRunNow (#43): an explicit hostId (the Runs-tab re-run path)
    // or the schedule's own `host` binding triggers the host-side runner over
    // SSH; only unbound schedules fall through to the attached-session remote or
    // the local launchd runner. A host schedule must never fire locally — its
    // repoRoot is a host-side path.
    const attached = deps.curRemote()
    return routeRunNow(id, hostId, {
      getSchedule,
      hosts: () => readSettings().remoteHosts,
      hostRunNow: (host, sid) => {
        const remote = deps.remoteFromHostId(host.id)
        return remote
          ? remoteRunNow(remote, sid)
          : Promise.resolve({ error: `unknown host: ${host.id}` })
      },
      attachedRunNow: attached ? (sid) => remoteRunNow(attached, sid) : undefined,
      localRunNow: (sid) => {
        const s = getSchedule(sid)
        runScheduleNow(sid)
        emitActivity({
          kind: 'agent-run',
          title: `Schedule run requested · ${s?.agentTitle || sid}`,
          detail: s ? `${s.engine}${s.model ? `/${s.model}` : ''}` : sid,
          repo: s?.repoLabel,
          repoRoot: s?.repoRoot,
          sessionId: deps.cur().sessionId,
        })
      },
    })
  })
  ipcMain.handle('schedules:runs', (_e, id?: string) => {
    const remote = deps.curRemote()
    return remote ? remoteSchedules.runs(remote, id).catch(() => []) : readCronRuns(id)
  })

  // Breaker state INCLUDING each host's own disabled.json. The host's runner
  // trips the breaker there, so a Mac that reads only its local file renders a
  // dead schedule as enabled/healthy (host-disabled.ts).
  ipcMain.handle('schedules:disabled-detail', async (): Promise<DisabledDetailResult> => {
    const attached = deps.curRemote()
    if (attached) {
      const snap = await hostBreakerState([attached])
      return { entries: snap.entries, errors: snap.errors }
    }
    const local = listDisabledDetail().map((e) => ({ ...e, host: undefined, hostLabel: undefined }))
    const refs = [...new Set(readSchedules().flatMap((s) => (s.host ? [s.host] : [])))].flatMap(
      (hostId) => {
        const ref = deps.remoteFromHostId(hostId)
        return ref ? [ref] : []
      },
    )
    const snap = await hostBreakerState(refs)
    return { entries: [...local, ...snap.entries], errors: snap.errors }
  })
  ipcMain.handle(
    'schedules:disabled-toggle',
    async (_e, id: string, disabled: boolean): Promise<MutationResult> => {
      // Route to whichever disabled.json actually gates this schedule: the
      // attached remote's, its assigned host's, or the local one.
      const attached = deps.curRemote()
      const ref = attached || hostRefForSchedule(id)
      if (ref) {
        const r = await setHostDisabled(ref, id, disabled)
        if (r.ok)
          emitActivity({
            kind: 'check',
            title: `Scheduled agent ${disabled ? 'paused' : 'resumed'} on ${ref.label || ref.sshTarget} · ${id}`,
            detail: 'Manual override (host kill-switch)',
            sessionId: deps.cur().sessionId,
          })
        return r
      }
      setAgentDisabled(id, disabled)
      emitActivity({
        kind: 'check',
        title: `Scheduled agent ${disabled ? 'paused' : 'resumed'} · ${id}`,
        detail: 'Manual override',
        sessionId: deps.cur().sessionId,
      })
      return { ok: true }
    },
  )
  function hostRefForSchedule(id: string): RemoteSessionRef | null {
    const host = getSchedule(id)?.host
    return host ? deps.remoteFromHostId(host) : null
  }
  ipcMain.handle('schedules:disabled-all', (_e, disabled: boolean) => {
    if (deps.curRemote()) return false
    const ids = readSchedules(Date.now()).map((s) => s.id)
    const ok = setAllSchedulesDisabled(ids, disabled)
    emitActivity({
      kind: 'check',
      title: `All schedules ${disabled ? 'paused' : 'resumed'}`,
      detail: `${ids.length} schedule${ids.length === 1 ? '' : 's'}`,
      sessionId: deps.cur().sessionId,
    })
    return ok
  })
  ipcMain.handle('schedules:run-log', (_e, runId: string) => {
    const remote = deps.curRemote()
    return remote ? remoteSchedules.runLog(remote, runId).catch(() => '') : readCronRunLog(runId)
  })
  ipcMain.handle('schedules:reconcile', () =>
    deps.curRemote()
      ? { ok: false, error: 'remote schedule reconcile needs the remote daemon runner' }
      : routeReconcile(readSchedules()),
  )

  ipcMain.handle('schedules:remove-all', () => {
    if (deps.curRemote()) return { removed: 0 }
    const n = removeAllJobs()
    for (const s of readSchedules()) removeSchedule(s.id)
    emitActivity({
      kind: 'check',
      title: 'All launchd schedules removed',
      detail: `${n} job${n === 1 ? '' : 's'} removed`,
      sessionId: deps.cur().sessionId,
    })
    return { removed: n }
  })
}
