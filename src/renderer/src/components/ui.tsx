import { useState, type ReactNode } from 'react'
import { Check, type LucideIcon } from 'lucide-react'

// Shared widget primitives. Plugins compose these so cards look consistent.

/** Inline click-to-copy affordance: renders `children` as a button that copies
 *  `value` to the clipboard and briefly flashes a check. Stops propagation so it
 *  works inside a clickable card. */
export function CopyButton({
  value,
  title = 'Copy',
  className = '',
  children,
}: {
  value: string
  title?: string
  className?: string
  children: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={copied ? 'Copied' : title}
      onClick={(e) => {
        e.stopPropagation()
        if (!value) return
        window.gt.clipboardWrite(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className={`inline-flex items-center gap-0.5 hover:text-zinc-200 ${copied ? 'text-[var(--gt-green)]' : ''} ${className}`}
    >
      {children}
      {copied && <Check size={10} strokeWidth={2.5} className="shrink-0" />}
    </button>
  )
}

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

/**
 * Force-mode pill — louder than a normal Badge. Marks agents and runs that
 * carry the TERMINAL_FORCE_MAIN bypass so the operator sees the elevated
 * authority at a glance.
 */
export function ForceChip({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const cls =
    size === 'md'
      ? 'inline-flex items-center gap-1 rounded-md bg-[var(--gt-red)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_0_10px_color-mix(in_srgb,var(--gt-red)_55%,transparent)]'
      : 'inline-flex items-center gap-1 rounded-md bg-[var(--gt-red)] px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_0_6px_color-mix(in_srgb,var(--gt-red)_50%,transparent)]'
  return (
    <span className={cls} title="FORCE — this agent runs with main-push authority (TERMINAL_FORCE_MAIN=1)">
      ⚠ Force
    </span>
  )
}
