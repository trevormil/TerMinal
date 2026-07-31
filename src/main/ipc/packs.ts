import { ipcMain } from 'electron'
import { disablePack, enablePack, packStatus } from '../packs'
import { hidePreset, restorePreset } from '../presets'

// Daily automation packs IPC. Kept out of index.ts for the same reason as
// briefings — index.ts is ~4000 lines of inline handlers. Register with one
// line in index.ts:
//
//   registerPacksIpc()

export function registerPacksIpc(): void {
  ipcMain.handle('packs:status', (_e, repoRoot: string) => packStatus(repoRoot))
  ipcMain.handle('packs:enable', (_e, repoRoot: string, repoLabel: string, packId: string) =>
    enablePack(repoRoot, repoLabel, packId),
  )
  ipcMain.handle('packs:disable', (_e, repoRoot: string, packId: string) =>
    disablePack(repoRoot, packId),
  )
  ipcMain.handle('packs:hide', (_e, packId: string) => {
    hidePreset('packs', packId)
    return true
  })
  ipcMain.handle('packs:restore', (_e, packId?: string) => {
    restorePreset('packs', packId)
    return true
  })
}
