import * as React from 'react'
import { cn } from '@/lib/utils'

// Proportion bar with the cockpit's dynamic-colour scale: teal (healthy) below
// 65%, amber 65–85%, red above. The colour is a runtime value, so it goes on an
// inline style rather than a Tailwind class; the track is the same translucent
// fill the cockpit already uses. Lives in exactly one place so the scale never
// drifts between widgets.

const defaultColor = (pct: number): string =>
  pct > 85 ? 'var(--gt-red)' : pct > 65 ? 'var(--gt-yellow)' : 'var(--gt-accent-2)'

function Gauge({
  pct,
  color,
  className,
}: {
  pct: number
  color?: string
  className?: string
}) {
  const value = Math.min(100, Math.max(0, pct))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-black/40', className)}>
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{ width: `${value}%`, background: color ?? defaultColor(value) }}
      />
    </div>
  )
}

export { Gauge }
