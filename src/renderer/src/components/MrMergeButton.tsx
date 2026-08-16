import { useState } from 'react'
import { GitMerge, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    try {
      const r = await window.gt.mergeMr(iid)
      if (r.ok) onMerged?.()
      else setErr(r.error || 'Merge failed')
    } catch (e2) {
      setErr((e2 as Error).message || 'Merge failed')
    } finally {
      // In `finally` so a rejection cannot pin the button to "merging…".
      setStage('idle')
    }
  }

  if (err)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--gt-yellow)]" title={err}>
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
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 size={12} strokeWidth={2.5} className="animate-spin" />
        merging…
      </span>
    )

  if (stage === 'confirm')
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[11px] text-muted-foreground">
          merge {sym}
          {iid}?
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={doMerge}
          title="Confirm merge"
          aria-label="Confirm merge"
          className="size-6 border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)] hover:bg-[var(--gt-green)]/20 hover:text-[var(--gt-green)]"
        >
          <Check size={12} strokeWidth={2.5} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            stop(e)
            setStage('idle')
          }}
          title="Cancel"
          aria-label="Cancel"
          className="size-6 border border-border text-muted-foreground hover:text-foreground"
        >
          <X size={12} strokeWidth={2.5} />
        </Button>
      </span>
    )

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={(e) => {
        stop(e)
        setStage('confirm')
      }}
      title={`Merge ${sym}${iid}`}
      className="border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)] hover:bg-[var(--gt-green)]/20 hover:text-[var(--gt-green)]"
    >
      <GitMerge size={12} strokeWidth={2} />
      Merge
    </Button>
  )
}
