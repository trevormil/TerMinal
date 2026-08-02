// Files IPC (ticket 91 index.ts decomposition) — the Cursor-like editor
// surface plus workspace search and Finder reveal. Every handler delegates to
// the active workspace daemon (local fs or SSH), which is the one piece of
// session state, injected via deps.

import { ipcMain, shell } from 'electron'
import { resolveWithin } from '../path-guard'
import { type WorkspaceDaemon } from '../workspace-daemon'
import { type WorkspaceSearchKind } from '../workspace-search'

export function registerFilesIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  // ---- files (Cursor-like editor; scoped to repo root / cwd) ----
  ipcMain.handle('files:list', (_e, rel: string) => {
    return deps.activeDaemon().filesList(rel || '')
  })
  ipcMain.handle('files:read', (_e, rel: string) => {
    return deps.activeDaemon().filesRead(rel)
  })
  ipcMain.handle('files:readBinary', (_e, rel: string) => {
    return deps.activeDaemon().filesReadBinary(rel)
  })
  ipcMain.handle('files:write', (_e, rel: string, content: string) => {
    return deps.activeDaemon().filesWrite(rel, content)
  })
  type FilesSearchOptions = {
    regex?: boolean
    caseSensitive?: boolean
    wholeWord?: boolean
    include?: string
    exclude?: string
  }
  ipcMain.handle('files:search', (_e, q: string, opts?: FilesSearchOptions) => {
    return deps.activeDaemon().filesSearch(q, opts)
  })
  ipcMain.handle('files:format', (_e, rel: string, content: string) => {
    return deps.activeDaemon().filesFormat(rel, content)
  })
  ipcMain.handle(
    'files:replace',
    (
      _e,
      q: string,
      replacement: string,
      targets: { file: string; line: number }[],
      opts?: FilesSearchOptions,
    ) => {
      return deps.activeDaemon().filesReplace(q, replacement, targets, opts)
    },
  )
  ipcMain.handle('workspace:search', (_e, q: string, kinds?: WorkspaceSearchKind[]) => {
    return deps.activeDaemon().search(q, kinds)
  })
  ipcMain.handle('files:create', (_e, rel: string, dir: boolean) => {
    return deps.activeDaemon().filesCreate(rel, dir)
  })
  ipcMain.handle('files:rename', (_e, from: string, to: string) => {
    return deps.activeDaemon().filesRename(from, to)
  })
  ipcMain.handle('files:delete', (_e, rel: string) => {
    return deps.activeDaemon().filesDelete(rel)
  })

  ipcMain.handle('files:reveal', (_e, rel: string) => {
    // Resolve against the workspace root and refuse anything that escapes it —
    // the renderer must not be able to reveal arbitrary filesystem paths. This
    // has to be resolveWithin and not a startsWith prefix test: with root
    // /tmp/repo, `../repo-private/x` normalises to /tmp/repo-private/x, which
    // shares the prefix but is a different directory.
    const abs = resolveWithin(deps.activeDaemon().filesRoot(), rel)
    if (!abs) return false
    shell.showItemInFolder(abs)
    return true
  })
}
