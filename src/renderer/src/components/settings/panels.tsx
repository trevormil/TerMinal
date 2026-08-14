import { useState } from 'react'
import { LayoutGrid, Plus, Trash2 } from 'lucide-react'
import type { PinnedPanel } from '../../lib/types'
import { Section, type SettingsCtx, type SettingsSectionSpec } from './shared'

// Editor for the Panels tab's pinned web dashboards. Local rows while editing;
// persists the cleaned list (rows with a URL) on blur / add / remove. The tab
// itself appears once at least one panel has a URL.
function PanelsSection({
  panels,
  onSave,
}: {
  panels: PinnedPanel[]
  onSave: (p: PinnedPanel[]) => void
}) {
  const [rows, setRows] = useState<PinnedPanel[]>(() => panels)
  const persist = (next: PinnedPanel[]) =>
    onSave(
      next.filter((p) => p.url.trim()).map((p) => ({ label: p.label.trim(), url: p.url.trim() })),
    )
  const update = (i: number, patch: Partial<PinnedPanel>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i: number) =>
    setRows((rs) => {
      const next = rs.filter((_, j) => j !== i)
      persist(next)
      return next
    })
  const inputCls =
    'min-w-0 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
  return (
    <Section
      id="panels"
      icon={LayoutGrid}
      title="Panels"
      desc="Pin web dashboards (Grafana, a status page, a fleet dashboard, …) into the Panels tab, each embedded in a sandboxed frame. The tab appears once at least one panel has a URL."
    >
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="text-[11px] text-zinc-600">
            No panels yet — add one to show the Panels tab.
          </div>
        )}
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={p.label}
              onChange={(e) => update(i, { label: e.target.value })}
              onBlur={() => persist(rows)}
              placeholder="Label"
              className={`${inputCls} w-40 shrink-0`}
            />
            <input
              value={p.url}
              onChange={(e) => update(i, { url: e.target.value })}
              onBlur={() => persist(rows)}
              onKeyDown={(e) => e.key === 'Enter' && persist(rows)}
              placeholder="https://…"
              className={`${inputCls} flex-1 font-mono`}
            />
            <button
              onClick={() => remove(i)}
              title="Remove panel"
              className="flex shrink-0 items-center rounded p-1.5 text-zinc-500 hover:bg-white/10 hover:text-[var(--gt-red)]"
            >
              <Trash2 size={13} strokeWidth={2} />
            </button>
          </div>
        ))}
        <button
          onClick={() => setRows((rs) => [...rs, { label: '', url: '' }])}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
        >
          <Plus size={12} strokeWidth={2} />
          Add panel
        </button>
      </div>
    </Section>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  return (
    <PanelsSection
      panels={ctx.s.pinnedPanels}
      onSave={(pinnedPanels) => ctx.save({ pinnedPanels })}
    />
  )
}

const section: SettingsSectionSpec = {
  id: 'panels',
  title: 'Panels',
  icon: LayoutGrid,
  order: 8,
  Component,
}
export default section
