import { useState } from 'react'
import { Layers, Check, X, Loader2 } from 'lucide-react'
import type { PrStack } from '../lib/types'

/**
 * "Merge the whole stack up to here" (ticket #0095).
 *
 * Routed through `gh stack merge`, NOT a loop of per-PR merges: the dedicated
 * async stack merge cascades every layer up to and including this one as one
 * operation, and per-PR merges have different semantics and cannot cascade.
 *
 * Same human gate as every other merge in the app — an agent never reaches this
 * button. The CLAUDE.md §8 merge bar applies to every layer this cascades
 * through, but it is applied by the human, not by this button: each layer's
 * readiness is shown in the stack map above so the whole cascade can be read at
 * a glance before confirming.
 */
export function StackMergeButton({
  stack,
  iid,
  repoRoot,
  sym = '#',
  onMerged,
}: {
  stack: PrStack
  iid: number
  repoRoot: string
  sym?: string
  onMerged?: () => void
}) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'merging'>('idle')
  const [err, setErr] = useState<string | null>(null)

  const position = stack.layers.find((l) => l.iid === iid)?.position ?? 0
  // Merging up to and including this layer merges everything beneath it too.
  const cascading = stack.layers.filter((l) => l.position <= position)

  // Nothing to cascade — the single-PR button already covers this case.
  if (cascading.length <= 1) return null

  if (err)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400" title={err}>
        <X size={12} strokeWidth={2.5} />
        Stack merge failed
        <button onClick={() => setErr(null)} className="ml-1 underline hover:text-amber-300">
          Retry
        </button>
      </span>
    )

  if (stage === 'merging')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
        <Loader2 size={12} strokeWidth={2.5} className="animate-spin" />
        merging stack…
      </span>
    )

  if (stage === 'confirm')
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] text-zinc-400">
          merge {cascading.length} layers ({cascading.map((l) => `${sym}${l.iid}`).join(' → ')})
          into {stack.baseRef}?
        </span>
        <button
          onClick={async () => {
            setStage('merging')
            setErr(null)
            try {
              const r = await window.gt.stacks.merge(repoRoot, iid)
              if (r.ok) onMerged?.()
              else setErr(r.error || 'Stack merge failed')
            } catch (e) {
              setErr((e as Error).message || 'Stack merge failed')
            } finally {
              // In `finally`: a rejected merge (unregistered handler, or a real
              // `gh stack merge` transport failure) otherwise pinned the button
              // to an animated "merging stack…" forever, with Retry unreachable.
              setStage('idle')
            }
          }}
          title="Confirm stack merge"
          className="inline-flex items-center rounded-md border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/15 p-1 text-[var(--gt-green)] hover:bg-[var(--gt-green)]/20"
        >
          <Check size={12} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => setStage('idle')}
          title="Cancel"
          className="inline-flex items-center rounded-md border border-[var(--gt-border)] p-1 text-zinc-400 hover:text-zinc-200"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </span>
    )

  return (
    <button
      onClick={() => setStage('confirm')}
      title={`Merge layers 1–${position} of this stack into ${stack.baseRef} in one cascading operation`}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
    >
      <Layers size={12} strokeWidth={2} />
      Merge stack
      <span className="text-zinc-500">· {cascading.length}</span>
    </button>
  )
}
