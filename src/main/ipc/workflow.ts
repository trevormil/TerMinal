// My-workflow IPC (ticket 0122 index.ts decomposition) — reads and writes of
// the user's own local Claude/Codex configuration files. Not repo-scoped, so
// the module has no deps.

import { handle } from '../typed-ipc'
import { listWorkflowFiles, readWorkflowFile, writeWorkflowFile } from '../workflow-files'

export function registerWorkflowIpc(): void {
  // ---- my workflow (local Claude/Codex configuration) ----
  handle('workflow:list', (_e, rel: string) => listWorkflowFiles(rel || ''))
  handle('workflow:read', (_e, rel: string) => readWorkflowFile(rel))
  handle('workflow:write', (_e, rel: string, content: string) => writeWorkflowFile(rel, content))
}
