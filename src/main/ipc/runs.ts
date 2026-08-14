// Runs IPC (ticket 0122 index.ts decomposition) — the Runs tab: the merged
// local run list, the per-host remote fan-out, log reads (full and tailed),
// run artifacts, and cron cancellation.
//
// Every remote path is best-effort by design: an unreachable host contributes
// an error entry, never a failed view. The one session-scoped input is the
// focused session's remote, injected via deps.

import { handle } from '../typed-ipc'
import { readSettings } from '../settings'
import { readFileTail } from '../fs-tail'
import { listRuns, readAgentRunLog, agentRunLogPath } from '../agents'
import { readBgTaskLog, bgTaskLogPath } from '../bg-tasks'
import {
  getCronRun,
  readCronRunLog,
  cronRunLogPath,
  readSessionRunLog,
  sessionRunLogPath,
  listAllRuns,
} from '../cron-runs'
import { collectRemoteRuns } from '../remote-runs'
import { listRepoArtifacts } from '../run-artifacts'
import { remoteRuns, type RemoteSessionRef } from '../remote'

export type RunsIpcDeps = {
  curRemote(): RemoteSessionRef | undefined
  remoteFromHostId(hostId: string, cwd?: string): RemoteSessionRef | null
}

export function registerRunsIpc(deps: RunsIpcDeps): void {
  // Local runs only — always fast, safe to poll. Remote runs come from the
  // separate `runs:remote-all` fan-out so the Runs tab can show BOTH in one view
  // without switching the session's daemon profile.
  handle('runs:all', () => listAllRuns())
  handle(
    'runs:running-count',
    () => listAllRuns().filter((r) => r.source !== 'session' && r.status === 'running').length,
  )
  // Fan out to every configured remote host in parallel, stamped with hostId so
  // the tab can merge them with local runs and badge/filter by host. Best-effort:
  // an unreachable host contributes an error entry, not a failed view.
  handle('runs:remote-all', () => {
    const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
    return collectRemoteRuns(hosts, async (h) => {
      const ref = deps.remoteFromHostId(h.id)
      if (!ref) return []
      return remoteRuns.all(ref)
    })
  })
  handle(
    'runs:log',
    (_e, source: 'cron' | 'agent' | 'bg' | 'session', runId: string, hostId?: string) => {
      // A run row carries its host; route the log fetch to that host. Fall back to
      // the focused session's remote (or local) when no hostId is supplied.
      const remote = hostId ? deps.remoteFromHostId(hostId) : deps.curRemote()
      if (remote) return remoteRuns.log(remote, runId).catch(() => '')
      if (source === 'cron') return readCronRunLog(runId)
      if (source === 'session') return readSessionRunLog(runId)
      if (source === 'bg') return readBgTaskLog(runId)
      // In-process agent run output lives in memory via listRuns(); fall back to the
      // on-disk log for a run that aged out of the in-memory working set (runs are
      // never deleted, so an archived run is still viewable).
      return listRuns().find((r) => r.id === runId)?.output || readAgentRunLog(runId)
    },
  )
  // Bounded log fetch for the live run pane: only the last `maxBytes` of the log
  // are read and shipped over IPC. The pane polls every 1.5s while a run streams
  // — full-file reads of multi-MB agent logs froze both processes. runs:log stays
  // the full-fidelity path (export buttons, "load full log").
  handle(
    'runs:log-tail',
    async (
      _e,
      source: 'cron' | 'agent' | 'bg' | 'session',
      runId: string,
      hostId?: string,
      maxBytes = 512 * 1024,
    ) => {
      const tail = (path: string) => {
        try {
          const { text, size } = readFileTail(path, maxBytes)
          return { text, size, truncated: size > maxBytes }
        } catch {
          return { text: '', size: 0, truncated: false }
        }
      }
      const remote = hostId ? deps.remoteFromHostId(hostId) : deps.curRemote()
      if (remote) {
        const text = await remoteRuns.log(remote, runId).catch(() => '')
        return { text: text.slice(-maxBytes), size: text.length, truncated: text.length > maxBytes }
      }
      if (source === 'cron') return tail(cronRunLogPath(runId))
      if (source === 'session') return tail(sessionRunLogPath(runId))
      if (source === 'bg') return tail(bgTaskLogPath(runId))
      const mem = listRuns().find((r) => r.id === runId)?.output
      if (mem != null && mem !== '')
        return { text: mem.slice(-maxBytes), size: mem.length, truncated: mem.length > maxBytes }
      return tail(agentRunLogPath(runId))
    },
  )
  // Artifacts a run produced — agent-request reports under the repo's
  // .TerMinal/agent-requests/ (#8). Local runs only; a remote run's artifacts live
  // on its host. The renderer opens a report via openExternal(file://…).
  handle('runs:artifacts', (_e, repoRoot: string) => listRepoArtifacts(repoRoot))
  // Cancel a running CRON run (#9). Local: SIGTERM the runner's own pid — its
  // cooperative handler kills the current attempt and stops retrying, recording the
  // run as canceled. Remote: route to the host's runs.cancel op.
  handle('runs:cancel-cron', async (_e, id: string, hostId?: string) => {
    if (hostId) {
      const remote = deps.remoteFromHostId(hostId)
      if (!remote) return { ok: false, error: `unknown host: ${hostId}` }
      return remoteRuns
        .cancel(remote, id)
        .then((ok) => (ok ? { ok: true } : { ok: false, error: 'host could not cancel the run' }))
        .catch((e) => ({ ok: false, error: String((e as Error).message || e) }))
    }
    const rec = getCronRun(id)
    if (!rec) return { ok: false, error: 'run not found' }
    if (rec.status !== 'running') return { ok: false, error: 'run is not running' }
    if (!rec.runnerPid)
      return { ok: false, error: 'no runner pid recorded (older run — cannot cancel)' }
    try {
      process.kill(rec.runnerPid, 'SIGTERM')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
