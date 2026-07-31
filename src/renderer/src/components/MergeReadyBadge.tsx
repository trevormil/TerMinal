import { Check, ShieldQuestion, TriangleAlert } from 'lucide-react'
import { badgeClasses, type BadgeTone } from './ui'
import { mergeReadyChip, type MergeGate, type MergeReadyState } from '../lib/mergeGate'

// The CLAUDE.md §8 merge bar, shown rather than enforced.
//
// The bar itself is unchanged and still applies — the human applies it. This
// badge exists so they can apply it at a glance instead of opening every PR,
// and so the MRs list has something to filter on. It never blocks a merge.
//
// Because it is the signal a human acts on, it must not overstate. `unverified`
// gets its own amber state rather than being rounded up to green: a badge that
// claims "merge-ready" when the findings simply failed to load is worse than no
// badge at all.

const TONE: Record<MergeReadyState, BadgeTone> = {
  ready: 'green',
  unverified: 'warn',
  'not-ready': 'red',
}

const ICON = {
  ready: Check,
  unverified: ShieldQuestion,
  'not-ready': TriangleAlert,
} as const

export function MergeReadyBadge({ gate }: { gate: MergeGate }) {
  const chip = mergeReadyChip(gate)
  const Icon = ICON[chip.state]
  return (
    <span
      title={chip.title}
      // Same pill as <Badge>, minus the uppercase: these labels carry a reason
      // ("Not ready · 2 findings ≥ medium") and shout in caps.
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${badgeClasses(
        TONE[chip.state],
      )}`}
    >
      <Icon size={10} strokeWidth={2.5} />
      {chip.label}
    </span>
  )
}
