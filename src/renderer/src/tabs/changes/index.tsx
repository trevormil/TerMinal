import { useCallback, useEffect, useState } from 'react'
import { GitCompare, RefreshCw } from 'lucide-react'
import { DiffView } from '../../components/MrDetail'
import type { Tab, TabContext, LocalDiffMode } from '../../lib/types'

// Review local (pre-PR) changes with the same Unified / Split / Structural viewer
// used for forge MRs — fed by local git instead of a forge PR. Ticket #15.
const MODES: { id: LocalDiffMode; label: string; hint: string }[] = [
  {
    id: 'branch',
    label: 'Branch vs main',
    hint: 'Committed changes on this branch that a PR would contain',
  },
  { id: 'working', label: 'Uncommitted', hint: 'Working-tree changes not yet committed (vs HEAD)' },
]

function ChangesTab({ ctx }: { ctx: TabContext }) {
  const [mode, setMode] = useState<LocalDiffMode>('branch')
  const [diff, setDiff] = useState<string | null>(null)
  // Bumped by the refresh button — the working tree changes out from under us.
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    setDiff(null)
    window.gt.getLocalDiff(mode).then((d) => {
      if (live) setDiff(d)
    })
    return () => {
      live = false
    }
  }, [mode, nonce, ctx.repoRoot])

  // Per-file structural fetch bound to the current mode; DiffView calls it with
  // the selected path + pane width. Re-created on mode/refresh so it re-runs.
  const fetchStructural = useCallback(
    (path: string, width: number) => window.gt.getLocalStructuralDiff(mode, path, undefined, width),
    [mode, nonce],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5">
        <GitCompare size={14} className="shrink-0 text-zinc-500" />
        <div className="flex items-center gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              title={m.hint}
              className={`rounded px-2 py-0.5 text-[11px] ${
                mode === m.id ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="truncate text-[11px] text-zinc-600" title={ctx.repoRoot}>
          {ctx.repoPath || ctx.repoRoot}
        </span>
        <button
          onClick={() => setNonce((n) => n + 1)}
          title="Refresh"
          className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {diff === null ? (
          <div className="p-6 text-[12px] text-zinc-600">Loading local changes…</div>
        ) : diff.trim() === '' ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-zinc-600">
            {mode === 'branch'
              ? 'No committed changes on this branch vs main.'
              : 'No uncommitted changes in the working tree.'}
          </div>
        ) : (
          <DiffView diff={diff} scope={`local.${ctx.repoRoot}.${mode}`} fetchStructural={fetchStructural} />
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'changes',
  title: 'Changes',
  icon: GitCompare,
  order: 2.5, // right after MRs (2)
  appliesTo: (ctx) => !!ctx.repoRoot && !ctx.remote,
  Component: ChangesTab,
}
export default tab
