import { ipcMain } from 'electron'
import {
  actOnBriefingItem,
  getBriefing,
  latestBriefing,
  listBriefingDates,
  type BriefingVerdict,
} from '../briefings'

// Briefings IPC, kept in its own module rather than inlined into index.ts.
// index.ts is ~4000 lines of handlers; every new surface added there makes the
// file harder to own and guarantees a merge conflict for anyone touching an
// unrelated handler. Register with one line in index.ts:
//
//   registerBriefingsIpc()

export function registerBriefingsIpc(): void {
  ipcMain.handle('briefings:latest', () => latestBriefing())
  ipcMain.handle('briefings:get', (_e, date: string) => getBriefing(date))
  ipcMain.handle('briefings:dates', (_e, limit?: number) => listBriefingDates(limit))
  ipcMain.handle('briefings:act', (_e, date: string, itemId: string, verdict: BriefingVerdict) =>
    actOnBriefingItem(date, itemId, verdict),
  )
}
