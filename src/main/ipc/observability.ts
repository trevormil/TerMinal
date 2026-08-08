// AI fleet observability IPCs (ticket 91 index.ts decomposition). Pull from
// the per-run AI ledger; every read degrades to an empty shape on a remote
// session — remote observability indexing is not wired yet, and an empty
// result must not read as "nothing was spent".

import { ipcMain } from 'electron'
import { agentROI, listAIRuns, type Range } from '../ai-runs'
import {
  observabilityFilterOptions,
  observabilityIndexStatus,
  queryObservabilityIndex,
  rebuildObservabilityIndex,
  type ObservabilityIndexQueryId,
  type ObservabilityQueryFilter,
} from '../observability-index'

export function registerObservabilityIpc(deps: { isRemote(): boolean }): void {
  ipcMain.handle('observability:byAgent', (_e, range: Range = 'week') =>
    deps.isRemote() ? [] : agentROI(range),
  )
  ipcMain.handle('observability:runs', (_e, limit: number = 100) =>
    deps.isRemote() ? [] : listAIRuns(limit),
  )
  ipcMain.handle('observability:index-status', () =>
    deps.isRemote()
      ? {
          ...observabilityIndexStatus(),
          ok: false,
          error: 'Remote observability indexing is not wired yet.',
        }
      : observabilityIndexStatus(),
  )
  ipcMain.handle('observability:index-rebuild', (_e, limit: number = 240) =>
    deps.isRemote()
      ? {
          ...observabilityIndexStatus(),
          ok: false,
          error: 'Remote observability indexing is not wired yet.',
          durationMs: 0,
          indexedSessions: 0,
        }
      : rebuildObservabilityIndex(limit),
  )
  ipcMain.handle(
    'observability:index-query',
    (_e, query: ObservabilityIndexQueryId, arg?: string, filter?: ObservabilityQueryFilter) =>
      deps.isRemote()
        ? {
            ...queryObservabilityIndex(query, arg, filter),
            rows: [],
            error: 'Remote observability indexing is not wired yet.',
          }
        : queryObservabilityIndex(query, arg, filter),
  )
  ipcMain.handle('observability:filter-options', () =>
    deps.isRemote() ? { repos: [], engines: [], models: [] } : observabilityFilterOptions(),
  )
}
