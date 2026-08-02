import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GitCompare,
  Pencil,
  Trash2,
} from 'lucide-react'
import { statusBadge, statusColor, type StatusMap } from '../../../shared/git-status'
import { fileIcon } from '../lib/fileIcons'
import type { FileEntry } from '../lib/types'

/**
 * The workspace file tree, shared by the Files tab and the Terminal tab's
 * Files column. Every optional action is an affordance: a surface that doesn't
 * pass `onRename` simply doesn't render the rename button, so the two callers
 * share one row layout instead of two that drift.
 */
export type FileTreeActions = {
  onOpen: (p: string) => void
  onSelectDir?: (p: string) => void
  onRename?: (p: string) => void
  onDelete?: (p: string) => void
  /** Drop `from` into directory `toDir` ('' = root). Enables tree-internal DnD. */
  onMove?: (from: string, toDir: string) => void
  /** Diff this file against the active open file. */
  onCompare?: (p: string) => void
  /** Absolute path for a repo-relative one — what an external drop pastes. */
  absFor: (p: string) => string
}

/**
 * The drag payload for tree-internal moves. It carries the repo-RELATIVE path,
 * which is also why the terminal drop handler reads it: an in-app drag knows
 * the workspace, so it can insert the short path an agent prompt wants, while
 * `text/plain` stays absolute for drops into other applications.
 */
export const DND_REL = 'application/x-terminal-rel'

const rowButton =
  'flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200'

export function TreeNode({
  entry,
  depth,
  active,
  selectedDir,
  version,
  statuses,
  act,
}: {
  entry: FileEntry
  depth: number
  active: string | null
  selectedDir: string
  version: number
  statuses: StatusMap
  act: FileTreeActions
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [dropHover, setDropHover] = useState(false)
  // refetch children when the tree version bumps (after a create/rename/delete)
  useEffect(() => {
    if (open) void window.gt.files.list(entry.path).then(setChildren)
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const click = async () => {
    if (!entry.dir) return act.onOpen(entry.path)
    act.onSelectDir?.(entry.path)
    if (!open && children === null) setChildren(await window.gt.files.list(entry.path))
    setOpen((o) => !o)
  }
  const sel = entry.dir ? selectedDir === entry.path : active === entry.path
  const { Icon, cls } = fileIcon(entry.name, entry.dir, open)
  const droppable = entry.dir && !!act.onMove
  return (
    <>
      <div
        onClick={click}
        style={{ paddingLeft: depth * 12 + 8 }}
        title={entry.ignored ? `${entry.name} · git-ignored` : entry.name}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_REL, entry.path)
          // text/plain carries the absolute path, so dropping on another app
          // pastes something usable outside this workspace (the Orca steal).
          e.dataTransfer.setData('text/plain', act.absFor(entry.path))
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onDragOver={
          droppable
            ? (e) => {
                if (!e.dataTransfer.types.includes(DND_REL)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                setDropHover(true)
              }
            : undefined
        }
        onDragLeave={droppable ? () => setDropHover(false) : undefined}
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                setDropHover(false)
                const from = e.dataTransfer.getData(DND_REL)
                if (from) act.onMove?.(from, entry.path)
              }
            : undefined
        }
        className={`group flex cursor-pointer items-center gap-1 py-[3px] pr-1.5 text-[12px] hover:bg-white/5 ${
          sel ? 'bg-[var(--gt-accent)]/10 text-zinc-100' : 'text-zinc-300'
        } ${entry.ignored ? 'opacity-45' : ''} ${
          dropHover
            ? 'bg-[var(--gt-accent)]/20 outline outline-1 -outline-offset-1 outline-[var(--gt-accent)]/50'
            : ''
        }`}
      >
        <span className="flex w-3 shrink-0 items-center justify-center text-zinc-600">
          {entry.dir ? (
            open ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )
          ) : null}
        </span>
        <Icon size={14} strokeWidth={2} className={`shrink-0 ${cls}`} />
        <span
          className={`min-w-0 flex-1 truncate ${statuses[entry.path] ? statusColor(statuses[entry.path]) : ''}`}
        >
          {entry.name}
        </span>
        {statuses[entry.path] && (
          <span
            title={statuses[entry.path]}
            className={`shrink-0 font-mono text-[10px] font-bold ${statusColor(statuses[entry.path])}`}
          >
            {statusBadge(statuses[entry.path])}
          </span>
        )}
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {!entry.dir && act.onCompare && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                act.onCompare?.(entry.path)
              }}
              title="Compare with active file"
              className={rowButton}
            >
              <GitCompare size={11} strokeWidth={2} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              void navigator.clipboard.writeText(entry.path)
            }}
            title="Copy relative path"
            className={rowButton}
          >
            <Copy size={11} strokeWidth={2} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              void window.gt.files.reveal(entry.path)
            }}
            title="Reveal in Finder"
            className={rowButton}
          >
            <ExternalLink size={11} strokeWidth={2} />
          </button>
          {act.onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                act.onRename?.(entry.path)
              }}
              title="Rename"
              className={rowButton}
            >
              <Pencil size={11} strokeWidth={2} />
            </button>
          )}
          {act.onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                act.onDelete?.(entry.path)
              }}
              title="Delete"
              className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-[var(--gt-red)]"
            >
              <Trash2 size={11} strokeWidth={2} />
            </button>
          )}
        </span>
      </div>
      {entry.dir &&
        open &&
        children?.map((c) => (
          <TreeNode
            key={c.path}
            entry={c}
            depth={depth + 1}
            active={active}
            selectedDir={selectedDir}
            version={version}
            statuses={statuses}
            act={act}
          />
        ))}
    </>
  )
}

/**
 * Scrollable tree body. `roots === null` means "still listing"; an empty array
 * renders nothing at all — no padding, no placeholder box — so a workspace with
 * nothing to show collapses to bare background instead of a phantom band.
 */
export function FileTree({
  roots,
  active = null,
  selectedDir = '',
  version = 0,
  statuses = {},
  act,
  className = '',
}: {
  roots: FileEntry[] | null
  active?: string | null
  selectedDir?: string
  version?: number
  statuses?: StatusMap
  act: FileTreeActions
  className?: string
}) {
  const hasRows = !!roots?.length
  return (
    <div
      key={version}
      className={`min-h-0 flex-1 overflow-y-auto ${hasRows ? 'py-1' : ''} ${className}`}
      onDragOver={
        act.onMove
          ? (e) => {
              // Falling through a folder row lands the drop at the root.
              if (!e.dataTransfer.types.includes(DND_REL)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          : undefined
      }
      onDrop={
        act.onMove
          ? (e) => {
              const from = e.dataTransfer.getData(DND_REL)
              if (from) act.onMove?.(from, '')
            }
          : undefined
      }
    >
      {roots === null ? (
        <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
      ) : (
        roots.map((e) => (
          <TreeNode
            key={e.path}
            entry={e}
            depth={0}
            active={active}
            selectedDir={selectedDir}
            version={version}
            statuses={statuses}
            act={act}
          />
        ))
      )}
    </div>
  )
}
