import { useCallback, useEffect, useState } from 'react'
import { GitCompare, RefreshCw, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiffView } from './MrDetail'
import type { WorkingDiff } from '../lib/types'

// Structural (difft) fetch for local working-tree changes (file at HEAD vs the
// working tree). Stable identity so DiffView's per-file effect doesn't re-run.
const fetchWorkingStructural = (path: string, cols: number) =>
  window.gt.getWorkingStructuralDiff(path, cols)

// The local "pre-PR" diff: everything from the merge-base with the default
// branch to the working tree (committed branch work + uncommitted + untracked).
// Reuses the MR DiffView (minus the "viewed" checkboxes); Structural mode runs
// difft locally (file at HEAD vs the working tree).
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
            title="Back"
            aria-label="Back"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </Button>
        )}
        <GitCompare size={14} strokeWidth={2} className="text-muted-foreground" />
        <span className="text-[12px] font-semibold text-foreground">Working changes</span>
        {res?.ok && (
          <span className="text-[11px] text-muted-foreground">
            {res.branch || 'HEAD'}
            {res.base && res.base !== res.branch ? ` vs ${res.base}` : ' · uncommitted'}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={load}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw size={12} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {res === null ? (
          <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
        ) : !res.ok ? (
          <div className="p-6 text-[12px] text-amber-400">
            {res.error || 'Could not read the working diff.'}
          </div>
        ) : empty ? (
          <div className="p-6 text-[12px] text-zinc-600">
            No changes
            {res.base && res.base !== res.branch ? ` since ${res.base}` : ' in the working tree'} —
            nothing to diff.
          </div>
        ) : (
          <DiffView
            diff={res.diff}
            scope="working"
            iid={0}
            showViewed={false}
            allowStructural
            fetchStructural={fetchWorkingStructural}
          />
        )}
      </div>
    </div>
  )
}
