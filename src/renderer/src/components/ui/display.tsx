import * as React from 'react'
import { cn } from '@/lib/utils'

// Brand display primitives (design-system.md §7) re-expressed on the semantic
// token system. These are the small `label: value` / headline / quiet-empty
// atoms the cockpit and panels compose; keeping them here means the styling
// stays in one place instead of drifting across ~80 call sites.

/** One headline number with a sub-label. */
function Big({
  value,
  sub,
  className,
}: {
  value: React.ReactNode
  sub?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline gap-1.5', className)}>
      <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">{value}</span>
      {sub && <span className="text-[10.5px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

/** Compact label:value pill for cramming many metrics into one row. */
function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      <span className="text-[12px] font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </span>
  )
}

/** A `label: value` row. */
function Row({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between py-0.5 text-[12px]', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground/90">{value}</span>
    </div>
  )
}

/** The quiet empty-state one-liner (design-system.md §6). */
function Empty({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('text-[12px] italic text-muted-foreground', className)}>{children}</div>
}

export { Big, Stat, Row, Empty }
