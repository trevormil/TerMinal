import { useState } from 'react'
import { GitMerge, Check, X, Loader2 } from 'lucide-react'

// Human-initiated MR/PR merge (the user clicks; the app shells out to gh/glab).
// A confirm step gates the irreversible-ish action; errors from the forge CLI
// (pipeline must pass, conflicts, approvals required) surface inline.
export function MrMergeButton({
  iid,
  sym = '!',
  onMerged,
}: {
  iid: number
  sym?: string
  onMerged?: () => void
}) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'merging'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  const doMerge = async (e: React.MouseEvent) => {
    stop(e)
    setStage('merging')
    setErr(null)
    const r = await window.gt.mergeMr(iid)
    setStage('idle')
    if (r.ok) onMerged?.()
    else setErr(r.error || 'Merge failed')
  }

  if (err)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400" title={err}>
        <X size={12} strokeWidth={2.5} />
        Merge failed
        <button
          onClick={(e) => {
            stop(e)
            setErr(null)
          }}
          className="ml-1 underline hover:text-amber-300"
        >
          Retry
        </button>
      </span>
    )

  if (stage === 'merging')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
        <Loader2 size={12} strokeWidth={2.5} className="animate-spin" />
        merging…
      </span>
    )

  if (stage === 'confirm')
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[11px] text-zinc-400">
          merge {sym}
          {iid}?
        </span>
        <button
          onClick={doMerge}
          title="Confirm merge"
          className="inline-flex items-center rounded-md border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/15 p-1 text-[var(--gt-green)] hover:bg-[var(--gt-green)]/25"
        >
          <Check size={12} strokeWidth={2.5} />
        </button>
        <button
          onClick={(e) => {
            stop(e)
            setStage('idle')
          }}
          title="Cancel"
          className="inline-flex items-center rounded-md border border-[var(--gt-border)] p-1 text-zinc-400 hover:text-zinc-200"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </span>
    )

  return (
    <button
      onClick={(e) => {
        stop(e)
        setStage('confirm')
      }}
      title={`Merge ${sym}${iid}`}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 px-2 py-1 text-[11px] text-[var(--gt-green)] hover:bg-[var(--gt-green)]/20"
    >
      <GitMerge size={12} strokeWidth={2} />
      Merge
    </button>
  )
}
