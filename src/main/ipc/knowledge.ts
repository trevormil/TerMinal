// Notes + knowledge-base IPC (ticket 0122 index.ts decomposition). Both are
// repo-bound or global, and both resolve their repo through the active
// workspace daemon — the single dependency.

import { handle } from '../typed-ipc'
import { type NotesScope } from '../notes'
import {
  fetchKnowledgePreview,
  readKnowledge,
  writeKnowledge,
  type KnowledgeScope,
  type KnowledgeBase,
} from '../knowledge'
import {
  knowledgeRagAddDocument,
  knowledgeRagAddUrl,
  knowledgeRagReindex,
  knowledgeRagSearch,
  knowledgeRagStatus,
} from '../knowledge-rag'
import { type WorkspaceDaemon } from '../workspace-daemon'

export function registerKnowledgeIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  // ---- notes (repo-bound + global, persisted) ----
  handle('notes:read', (_e, scope: NotesScope) => {
    return deps.activeDaemon().notesRead(scope)
  })
  handle('notes:write', (_e, scope: NotesScope, content: string) =>
    deps.activeDaemon().notesWrite(scope, content),
  )
  handle('knowledge:read', (_e, scope: KnowledgeScope) => {
    return readKnowledge(scope, deps.activeDaemon().repoRoot())
  })
  handle('knowledge:write', (_e, scope: KnowledgeScope, kb: KnowledgeBase) => {
    return writeKnowledge(scope, deps.activeDaemon().repoRoot(), kb)
  })
  handle('knowledge:preview', (_e, url: string) => fetchKnowledgePreview(url))
  handle('knowledge:rag-status', (_e, scope: Extract<KnowledgeScope, string>, item: any) =>
    knowledgeRagStatus({ scope, repoRoot: deps.activeDaemon().repoRoot(), item }),
  )
  handle(
    'knowledge:rag-reindex',
    (_e, scope: Extract<KnowledgeScope, string>, item: any, fullRebuild?: boolean) =>
      knowledgeRagReindex({ scope, repoRoot: deps.activeDaemon().repoRoot(), item }, !!fullRebuild),
  )
  handle(
    'knowledge:rag-add-document',
    (_e, scope: Extract<KnowledgeScope, string>, item: any, content: string, filepath?: string) =>
      knowledgeRagAddDocument({
        scope,
        repoRoot: deps.activeDaemon().repoRoot(),
        item,
        content,
        filepath,
      }),
  )
  handle(
    'knowledge:rag-add-url',
    (_e, scope: Extract<KnowledgeScope, string>, item: any, url: string, title?: string) =>
      knowledgeRagAddUrl({ scope, repoRoot: deps.activeDaemon().repoRoot(), item, url, title }),
  )
  handle(
    'knowledge:rag-search',
    (_e, scope: Extract<KnowledgeScope, string>, item: any, query: string) =>
      knowledgeRagSearch({ scope, repoRoot: deps.activeDaemon().repoRoot(), item, query }),
  )
}
