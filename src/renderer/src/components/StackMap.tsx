import { GitBranch, Layers } from 'lucide-react'
import { Badge } from './ui'
import { MergeReadyBadge } from './MergeReadyBadge'
import { stateTone } from '../lib/badges'
import { listMergeGate } from '../lib/mrRisk'
import type { Mr, PrStack } from '../lib/types'

/**
 * GitHub's stack map, mirrored (ticket #0095).
 *
 * Users will have seen github.com's version at the top of a stacked PR, so this
 * copies that mental model rather than inventing another: layers rendered
 * TOP-DOWN (highest position first) with the base branch anchoring the bottom,
 * a continuous connector spine down the left, the PR you are looking at
 * highlighted, and every other layer one click away.
 *
 * Each open layer also carries its merge-readiness badge, because "Merge stack"
 * cascades through all of them and the human confirming it needs to see the
 * whole cascade's state, not just this PR's. The badges come from list data, so
 * they can only ever read amber at best — findings are loaded per-PR, and the
 * current layer's authoritative badge is in the header, so it is not repeated
 * here.
 */
export function StackMap({
  stack,
  currentIid,
  mrByIid,
  sym = '#',
  onOpen,
}: {
  stack: PrStack
  currentIid?: number
  mrByIid: Map<number, Mr>
  sym?: string
  onOpen?: (iid: number) => void
}) {
  // Top of the stack first — the layer furthest from the base branch.
  const layers = [...stack.layers].sort((a, b) => b.position - a.position)
  // GitHub reports the true size; we may only have fetched some of it.
  const missing = Math.max(0, stack.size - stack.layers.length)

  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <Layers size={12} strokeWidth={2.2} className="text-[var(--gt-accent-light)]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
          Stack
        </span>
        <span className="text-[10.5px] tabular-nums text-zinc-600">
          {stack.size} {stack.size === 1 ? 'PR' : 'PRs'}
        </span>
        {missing > 0 && (
          <span
            title="Some layers are not in the fetched set (closed, or outside the open-PR page)."
            className="text-[10px] text-amber-400"
          >
            · {missing} not shown
          </span>
        )}
      </div>

      <div className="relative">
        {/* The spine. Inset so it threads through the layer dots. */}
        <div className="absolute bottom-3 left-[9px] top-3 w-px bg-[var(--gt-border)]" />
        {layers.map((layer) => {
          const mr = mrByIid.get(layer.iid)
          const current = layer.iid === currentIid
          return (
            <button
              key={layer.iid}
              onClick={() => onOpen?.(layer.iid)}
              disabled={current || !onOpen}
              className={`relative flex w-full items-center gap-2 rounded-md px-1 py-1 text-left ${
                current
                  ? 'bg-[var(--gt-accent)]/15'
                  : onOpen
                    ? 'cursor-pointer hover:bg-white/5'
                    : ''
              }`}
            >
              <span
                className={`z-10 h-2 w-2 shrink-0 rounded-full ring-2 ring-[var(--gt-bg)] ${
                  current ? 'bg-[var(--gt-accent)]' : 'bg-zinc-600'
                }`}
              />
              <span className="w-10 shrink-0 text-[10px] tabular-nums text-zinc-600">
                {layer.position}/{stack.size}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                {sym}
                {layer.iid}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[11.5px] ${
                  current ? 'font-semibold text-zinc-100' : 'text-zinc-400'
                }`}
              >
                {mr?.title || 'Not in the current list'}
              </span>
              {mr && !current && mr.state === 'opened' && !mr.draft && (
                <MergeReadyBadge gate={listMergeGate(mr)} />
              )}
              {mr && <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>}
              {current && (
                <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--gt-accent-light)]">
                  here
                </span>
              )}
            </button>
          )
        })}

        {/* The base branch anchors the bottom, exactly as on github.com. */}
        <div className="relative flex items-center gap-2 px-1 py-1">
          <span className="z-10 h-2 w-2 shrink-0 rounded-full bg-[var(--gt-border)] ring-2 ring-[var(--gt-bg)]" />
          <span className="w-10 shrink-0" />
          <GitBranch size={11} strokeWidth={2} className="shrink-0 text-zinc-600" />
          <span className="truncate font-mono text-[11px] text-zinc-600">{stack.baseRef}</span>
        </div>
      </div>
    </div>
  )
}
