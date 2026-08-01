// IPC for transcript search.
//
// Register from src/main/index.ts with:
//   registerSessionSearchIpc({ cwd: () => cur().cwd })

import { ipcMain } from 'electron'
import { findSessionFile, listSessions } from '../data'
import { searchTranscripts, type SearchOptions, type SessionRef } from '../session-search'

/** Every known session paired with its transcript file. Sessions whose file we
 *  can't locate are dropped — there is nothing to search. */
function sessionRefs(): SessionRef[] {
  const out: SessionRef[] = []
  for (const s of listSessions()) {
    const file = findSessionFile(s.id)
    if (!file) continue
    out.push({
      id: s.id,
      engine: s.engine,
      cwd: s.cwd,
      mtime: s.mtime,
      file,
      firstUserText: s.firstUserText,
      gitBranch: s.gitBranch,
    })
  }
  return out
}

export function registerSessionSearchIpc(deps: { cwd: () => string }): void {
  ipcMain.handle(
    'sessions:search',
    (_e, query: string, opts?: SearchOptions & { thisRepoOnly?: boolean }) => {
      const o: SearchOptions = { ...opts }
      if (opts?.thisRepoOnly) o.cwd = deps.cwd()
      // Bounded by default: an unqualified search should be fast, not thorough.
      return searchTranscripts(query, sessionRefs(), {
        maxSessions: 60,
        maxHits: 20,
        ...o,
      })
    },
  )
}
