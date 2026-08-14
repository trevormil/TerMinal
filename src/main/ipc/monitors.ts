// Monitoring + CI IPC (ticket 0122 index.ts decomposition). The Monitoring tab
// edits monitors.json directly through these handlers, so the write path
// validates rather than trusting the renderer, and every save re-syncs the
// launchd daemon that executes the file.

import { handle } from '../typed-ipc'
import {
  listMonitorsWithStatus,
  writeMonitors,
  validateMonitors,
  runMonitorProbe,
} from '../monitors'
import { syncMonitorDaemon } from '../launchd'
import { listCiRuns, listCiJobs, fetchCiLog } from '../ci'

export function registerMonitorsIpc(): void {
  // Monitoring: read-only list for the tab; writes go through monitors.json (the
  // tab edits it directly via these handlers), and a check triggers the daemon.
  handle('monitors:list', () => listMonitorsWithStatus())
  handle('monitors:save', (_e, list: unknown) => {
    // monitors.json is executed by bin/terminal-monitor on a launchd timer, so
    // the write path validates rather than trusting the renderer's JSON.
    if (!Array.isArray(list))
      return { ok: false, saved: 0, rejected: 0, error: 'expected an array' }
    const { monitors, rejected } = validateMonitors(list)
    if (rejected) console.error(`[gt] monitors:save dropped ${rejected} invalid monitor(s)`)
    try {
      writeMonitors(monitors)
      syncMonitorDaemon()
    } catch (e) {
      // Was `return true` unconditionally — a failed write reported success and
      // the user's edit silently vanished on the next read.
      return { ok: false, saved: 0, rejected, error: (e as Error).message }
    }
    return { ok: true, saved: monitors.length, rejected }
  })
  // Native CI: forge-agnostic run/job/log views for the repo (gh run / glab api).
  // repoRoot comes from the tab's context. The webview view is the default; this
  // backs the "Runs" toggle.
  handle('ci:list', (_e, repoRoot: string, limit?: number) => listCiRuns(repoRoot, limit ?? 40))
  handle('ci:jobs', (_e, repoRoot: string, runId: string) => listCiJobs(repoRoot, runId))
  handle('ci:log', (_e, repoRoot: string, jobId: string) => fetchCiLog(repoRoot, jobId))
  // Async execFile, NOT execFileSync: this ran a 40-second-timeout probe inside an
  // IPC handler, so one "Run check" click on a hung endpoint froze the entire main
  // process — every window, every session, every timer — for up to 40s. The worst
  // remaining blocker in the app.
  handle('monitors:run', async (_e, id: string) => {
    await runMonitorProbe(id) // never rejects; failures surface via the state file
    return listMonitorsWithStatus()
  })
}
