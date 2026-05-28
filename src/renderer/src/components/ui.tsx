import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// Shared widget primitives. Plugins compose these so cards look consistent.

export function Card({
  icon: Icon,
  title,
  right,
  children,
}: {
  icon: LucideIcon
  title: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-2 transition-colors hover:border-[var(--gt-border)]/80">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={12} strokeWidth={2.25} className="shrink-0 text-zinc-500" />
        <span className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Gauge({ pct, color }: { pct: number; color?: string }) {
  const c = color ?? (pct > 85 ? '#ff5c7c' : pct > 65 ? '#ffb35c' : 'var(--gt-accent-2)')
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/40">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: c }}
      />
    </div>
  )
}

export function Big({ value, sub }: { value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-lg font-bold tabular-nums tracking-tight text-zinc-50">{value}</span>
      {sub && <span className="text-[10.5px] text-zinc-500">{sub}</span>}
    </div>
  )
}

/** Compact label:value pill for cramming many metrics into one row. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[12px] font-semibold tabular-nums text-zinc-100">{value}</span>
      <span className="text-[9.5px] uppercase tracking-wide text-zinc-600">{label}</span>
    </span>
  )
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[12px]">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium tabular-nums text-zinc-200">{value}</span>
    </div>
  )
}

export type BadgeTone =
  | 'ok'
  | 'warn'
  | 'bad'
  | 'mute'
  | 'red'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'accent'

const BADGE_MAP: Record<BadgeTone, string> = {
  ok: 'bg-[var(--gt-green)]/12 text-[var(--gt-green)] border-[var(--gt-green)]/25',
  green: 'bg-[var(--gt-green)]/12 text-[var(--gt-green)] border-[var(--gt-green)]/25',
  warn: 'bg-[var(--gt-yellow)]/12 text-[var(--gt-yellow)] border-[var(--gt-yellow)]/25',
  yellow: 'bg-[var(--gt-yellow)]/12 text-[var(--gt-yellow)] border-[var(--gt-yellow)]/25',
  bad: 'bg-[var(--gt-red)]/12 text-[var(--gt-red)] border-[var(--gt-red)]/25',
  red: 'bg-[var(--gt-red)]/12 text-[var(--gt-red)] border-[var(--gt-red)]/25',
  blue: 'bg-[var(--gt-blue)]/12 text-[var(--gt-blue)] border-[var(--gt-blue)]/25',
  accent: 'bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)] border-[var(--gt-accent)]/30',
  mute: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25',
}

export const badgeClasses = (tone: BadgeTone) => BADGE_MAP[tone]

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BADGE_MAP[tone]}`}
    >
      {children}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-[12px] italic text-zinc-600">{children}</div>
}
