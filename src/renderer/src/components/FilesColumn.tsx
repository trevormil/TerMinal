import { useEffect, useState } from 'react'
import { PanelLeftClose, RotateCw } from 'lucide-react'
import { FileTree, type FileTreeActions } from './FileTree'
import { FileModal } from './FileModal'
import type { FileEntry, TabContext } from '../lib/types'

/**
 * The Terminal tab's file column: browse the workspace, open a file in a modal
 * editor, or drag a row onto the terminal to hand its path to the agent — all
 * without leaving the tab.
 *
 * Read-only on purpose. Create/rename/delete/compare stay in the Files tab; the
 * shared tree renders only the affordances a surface actually passes, so this
 * one shows copy-path and reveal and nothing else.
 */
export function FilesColumn({ ctx, onCollapse }: { ctx: TabContext; onCollapse: () => void }) {
  const [roots, setRoots] = useState<FileEntry[] | null>(null)
  const [version, setVersion] = useState(0)
  const [selectedDir, setSelectedDir] = useState('')
  const [openPath, setOpenPath] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRoots(null)
    window.gt.files
      .list('')
      .then((r) => alive && setRoots(r))
      .catch(() => alive && setRoots([]))
    return () => {
      alive = false
    }
  }, [ctx.repoRoot, version])

  const act: FileTreeActions = {
    onOpen: setOpenPath,
    onSelectDir: setSelectedDir,
    absFor: (p) => {
      const root = ctx.repoRoot || ctx.cwd || ''
      return root ? `${root}/${p}` : p
    },
  }

  return (
    <aside className="flex min-w-0 flex-col overflow-hidden border-r border-[var(--gt-border)] bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
          Files
        </span>
        <button
          onClick={() => setVersion((v) => v + 1)}
          title="Refresh"
          className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <RotateCw size={11} strokeWidth={2} />
        </button>
        <button
          onClick={onCollapse}
          title="Hide files"
          className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <PanelLeftClose size={12} strokeWidth={2} />
        </button>
      </div>
      <FileTree
        roots={roots}
        active={openPath}
        selectedDir={selectedDir}
        version={version}
        act={act}
      />
      {openPath && <FileModal path={openPath} onClose={() => setOpenPath(null)} />}
    </aside>
  )
}
