import { useState } from 'react'
import { LayoutGrid, Plus, Trash2 } from 'lucide-react'
import type { PinnedPanel } from '../../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
            <Input
              value={p.label}
              onChange={(e) => update(i, { label: e.target.value })}
              onBlur={() => persist(rows)}
              placeholder="Label"
              className="w-40 shrink-0"
            />
            <Input
              value={p.url}
              onChange={(e) => update(i, { url: e.target.value })}
              onBlur={() => persist(rows)}
              onKeyDown={(e) => e.key === 'Enter' && persist(rows)}
              placeholder="https://…"
              className="flex-1 font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(i)}
              title="Remove panel"
              aria-label="Remove panel"
              className="text-zinc-500 hover:text-[var(--gt-red)]"
            >
              <Trash2 strokeWidth={2} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { label: '', url: '' }])}
        >
          <Plus strokeWidth={2} />
          Add panel
        </Button>
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
