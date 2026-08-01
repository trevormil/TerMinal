import { ipcMain } from 'electron'
import { listAllRuns } from '../cron-runs'
import { scoreAgentRuns, scoreAllAgents } from '../agent-scorecard'
import type { AgentScorecard, ScorecardRun } from '../agent-scorecard'
import { listDisabledDetail, setDisabled } from '../agents-disabled'
import type { DisabledEntry } from '../agents-disabled'
import { compactPersistentAgentMemory } from '../persistent-agents'
import type { CompactionResult } from '../persistent-agents'

// Read-mostly agent observability IPC: reliability scorecards computed from the
// run stores already on disk, plus the disabled-agent roster and its one-click
// re-enable. Kept out of index.ts so the surface stays reviewable.

/** Runs feeding a scorecard — a generous window so per-agent slices still fill. */
const RUN_POOL = 1500

const pool = (): ScorecardRun[] => listAllRuns(RUN_POOL) as ScorecardRun[]

export function registerAgentInsightsIpc(): void {
  // One agent's scorecard (last SCORECARD_WINDOW runs).
  ipcMain.handle('agents:scorecard', (_e, agentId: string): AgentScorecard | null => {
    if (!agentId) return null
    const runs = pool().filter((r) => r.agentId === agentId)
    if (!runs.length) return null
    return { ...scoreAgentRuns(runs), agentId }
  })

  // Every agent that has run, busiest first — powers the roster's reliability column.
  ipcMain.handle('agents:scorecards', (): AgentScorecard[] => scoreAllAgents(pool()))

  // Disabled roster with WHY/WHEN, and the re-enable.
  ipcMain.handle('agents:disabled-detail', (): DisabledEntry[] => listDisabledDetail())
  ipcMain.handle(
    'agents:set-disabled',
    (_e, id: string, disabled: boolean, reason?: string): DisabledEntry[] => {
      setDisabled(id, disabled, reason)
      return listDisabledDetail()
    },
  )

  // Manual compaction — the same pass a launch triggers automatically.
  ipcMain.handle('persistent-agents:compact', (_e, id: string): Promise<CompactionResult> =>
    compactPersistentAgentMemory(id),
  )
}
