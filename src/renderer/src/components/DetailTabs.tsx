import { detailTabCountSuffix } from '../lib/detailTabs'

// The horizontal detail-tab strip. Extracted from the Agents tab when Tickets
// needed the same treatment — one place to change so the two never drift into
// two slightly-different versions of the same control.

export type DetailTabSpec<Id extends string = string> = {
  id: Id
  label: string
  /** Quiet `· N` suffix. Zero renders nothing — see detailTabCountSuffix. */
  count?: number
}

export function DetailTabs<Id extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly DetailTabSpec<Id>[]
  active: Id
  onSelect: (id: Id) => void
}) {
  return (
    <div
      role="tablist"
      className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/20 px-4 py-1.5"
    >
      {tabs.map((t) => {
        const suffix = detailTabCountSuffix(t.count)
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => onSelect(t.id)}
            className={`inline-flex items-center rounded-md px-3 py-1 text-[12px] font-medium ${
              active === t.id
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {t.label}
            {suffix && <span className="ml-1 text-zinc-600">{suffix}</span>}
          </button>
        )
      })}
    </div>
  )
}
