import { useCallback, useEffect, useState } from 'react'
import { GitCompare, RefreshCw, ChevronLeft } from 'lucide-react'
import { DiffView } from './MrDetail'
import type { WorkingDiff } from '../lib/types'

// The local "pre-PR" diff: everything from the merge-base with the default
// branch to the working tree (committed branch work + uncommitted + untracked).
// Reuses the MR DiffView, minus the "viewed" checkboxes and Structural mode.
// Shared by the PRs tab (working-diff button) and the Files tab (Changes pane).
export function WorkingDiffView({ onBack }: { onBack?: () => void }) {
  const [res, setRes] = useState<WorkingDiff | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    window.gt.getWorkingDiff().then((r) => {
      setRes(r)
      setLoading(false)
    })
  }, [])
  useEffect(load, [load])

  const empty = res?.ok && !res.diff.trim()

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
        {onBack && (
          <button onClick={onBack} className="flex items-center text-zinc-500 hover:text-zinc-200" title="Back">
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
        )}
        <GitCompare size={14} strokeWidth={2} className="text-zinc-400" />
        <span className="text-[12px] font-semibold text-zinc-200">Working changes</span>
        {res?.ok && (
          <span className="text-[11px] text-zinc-600">
            {res.branch || 'HEAD'}
            {res.base && res.base !== res.branch ? ` vs ${res.base}` : ' · uncommitted'}
          </span>
        )}
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          title="Refresh"
        >
          <RefreshCw size={12} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {res === null ? (
          <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
        ) : !res.ok ? (
          <div className="p-6 text-[12px] text-amber-400">{res.error || 'Could not read the working diff.'}</div>
        ) : empty ? (
          <div className="p-6 text-[12px] text-zinc-600">
            No changes{res.base && res.base !== res.branch ? ` since ${res.base}` : ' in the working tree'} — nothing to
            diff.
          </div>
        ) : (
          <DiffView diff={res.diff} scope="working" iid={0} showViewed={false} allowStructural={false} />
        )}
      </div>
    </div>
  )
}
