// Persistent-agent IPCs (ticket 91 index.ts decomposition). Pure pass-through
// to persistent-agents.ts / agents.ts; the only session context is which repo
// the active tab is in, injected via deps so this module stays free of the
// pty/session state living in index.ts.

import { ipcMain } from 'electron'
import { runPersistentAgent, runPersistentAgentDesignerSpawn, type Engine } from '../agents'
import {
  getPersistentAgent,
  createPersistentAgentFile,
  listPersistentAgentArtifacts,
  listPersistentAgents,
  listPersistentAgentFiles,
  persistentAgentLaunchPrompt,
  readPersistentAgentArtifact,
  readPersistentAgentFile,
  removePersistentAgent,
  removePersistentAgentFile,
  savePersistentAgent,
  updatePersistentAgentFile,
  writePersistentAgentFile,
} from '../persistent-agents'

export function registerPersistentAgentsIpc(deps: { activeRepoRoot(): string }): void {
  ipcMain.handle('persistent-agents:list', () => listPersistentAgents())
  ipcMain.handle('persistent-agents:get', (_e, id: string) => getPersistentAgent(id))
  ipcMain.handle('persistent-agents:save', (_e, input: unknown) =>
    savePersistentAgent(input as never),
  )
  ipcMain.handle('persistent-agents:remove', (_e, id: string) => removePersistentAgent(id))
  ipcMain.handle('persistent-agents:update-file', (_e, id: string, file: string, body: string) =>
    updatePersistentAgentFile(id, file as never, body),
  )
  ipcMain.handle(
    'persistent-agents:launch-prompt',
    (_e, id: string, task: string, repoRoot?: string, engine?: Engine, model?: string) =>
      persistentAgentLaunchPrompt(id, task, {
        repoRoot: repoRoot || deps.activeRepoRoot(),
        engine,
        model,
      }),
  )
  ipcMain.handle(
    'persistent-agents:run',
    (_e, id: string, task: string, engine?: Engine, model?: string) =>
      runPersistentAgent(deps.activeRepoRoot(), id, task, engine, model),
  )
  ipcMain.handle('persistent-agents:design', (_e, text: string, engine: Engine, model?: string) =>
    runPersistentAgentDesignerSpawn(deps.activeRepoRoot(), text, engine, model),
  )
  ipcMain.handle('persistent-agents:files-list', (_e, id: string, rel: string) =>
    listPersistentAgentFiles(id, rel || ''),
  )
  ipcMain.handle('persistent-agents:files-read', (_e, id: string, rel: string) =>
    readPersistentAgentFile(id, rel),
  )
  ipcMain.handle('persistent-agents:files-write', (_e, id: string, rel: string, content: string) =>
    writePersistentAgentFile(id, rel, content),
  )
  ipcMain.handle('persistent-agents:files-create', (_e, id: string, rel: string, dir: boolean) =>
    createPersistentAgentFile(id, rel, dir),
  )
  ipcMain.handle('persistent-agents:files-delete', (_e, id: string, rel: string) =>
    removePersistentAgentFile(id, rel),
  )
  ipcMain.handle('persistent-agents:artifacts-list', (_e, id: string) =>
    listPersistentAgentArtifacts(id),
  )
  ipcMain.handle('persistent-agents:artifacts-read', (_e, id: string, rel: string) =>
    readPersistentAgentArtifact(id, rel),
  )
}
