import type { LinearMeta } from '../lib/types'

// Linear-native chips: render Linear's OWN schema (state names, 0-4 priority,
// assignee, labels) instead of coercing everything into TerMinal's md-ticket
// vocabulary. Colors come from Linear itself (state/label hex) where the API
// provides them, tinted at 20% over our surfaces so they sit in the theme.

const chipBase =
  'inline-flex max-w-[160px] items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[10px] font-medium'

/** Exact workflow-state name with Linear's state color as the dot. */
export function LinearStateChip({ meta }: { meta: LinearMeta }) {
  return (
    <span
      className={`${chipBase} border-[var(--gt-border)] bg-black/20 text-zinc-300`}
      title={`Linear state · ${meta.stateName}${meta.stateType ? ` (${meta.stateType})` : ''}`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: meta.stateColor || 'var(--gt-text-faint)' }}
      />
      {meta.stateName}
    </span>
  )
}

// Linear's fixed priority scale. 0 = none (render nothing in lists).
const PRIORITY_TONE: Record<number, string> = {
  1: 'border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 text-[var(--gt-red)]',
  2: 'border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 text-[var(--gt-yellow)]',
  3: 'border-[var(--gt-border)] bg-black/20 text-zinc-300',
  4: 'border-[var(--gt-border)] bg-black/20 text-zinc-500',
}

export function LinearPriorityChip({ meta, showNone }: { meta: LinearMeta; showNone?: boolean }) {
  if (meta.priority === 0 && !showNone) return null
  const tone = PRIORITY_TONE[meta.priority] || 'border-[var(--gt-border)] bg-black/20 text-zinc-500'
  return (
    <span className={`${chipBase} ${tone}`} title={`Linear priority · ${meta.priorityLabel}`}>
      {meta.priorityLabel}
    </span>
  )
}

/** Initials avatar, Linear-style. */
export function LinearAssignee({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  return (
    <span
      title={`Assignee · ${name}`}
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--gt-border)] bg-[var(--gt-accent)]/10 text-[8.5px] font-bold text-[var(--gt-accent-light)]"
    >
      {initials || '?'}
    </span>
  )
}

export function LinearLabelChips({
  labels,
  max = 3,
}: {
  labels: LinearMeta['labels']
  max?: number
}) {
  if (!labels.length) return null
  const shown = labels.slice(0, max)
  const extra = labels.length - shown.length
  return (
    <>
      {shown.map((l) => (
        <span
          key={l.name}
          className={`${chipBase} border-[var(--gt-border)] bg-black/20 text-zinc-400`}
          title={`Label · ${l.name}`}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: l.color || 'var(--gt-text-faint)' }}
          />
          {l.name}
        </span>
      ))}
      {extra > 0 && <span className="text-[10px] text-zinc-600">+{extra}</span>}
    </>
  )
}
