// Read-only IPC for the Loops tab. The write side of the loop engine
// (create/step/restart/stop) is already registered in index.ts; this module only
// adds the history surface so a finished loop stays inspectable.
//
// Register from src/main/index.ts with:
//   registerLoopsHistoryIpc()

import { ipcMain } from 'electron'
import { readLoopHistory, readLoopTurnLog } from '../loops'

export function registerLoopsHistoryIpc(): void {
  ipcMain.handle('loops:history', (_e, id: string) => readLoopHistory(id))
  ipcMain.handle('loops:turn-log', (_e, id: string, file: string) => readLoopTurnLog(id, file))
}
