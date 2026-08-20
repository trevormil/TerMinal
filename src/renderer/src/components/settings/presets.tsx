import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import type { PresetKind, PresetPrefs } from '../../lib/types'
import { Button } from '@/components/ui/button'
import { Section, type SettingsSectionSpec } from './shared'

function PresetVisibilityPanel() {
  const [data, setData] = useState<{
    prefs: PresetPrefs
    catalog: Record<PresetKind, { id: string; title: string; group?: string }[]>
  } | null>(null)
  const load = () => window.gt.presets.get().then(setData)
  useEffect(() => {
    void load()
  }, [])
  if (!data) return <div className="text-[11px] text-zinc-600">Loading presets...</div>
  const block = (kind: PresetKind, title: string) => {
    const hidden = data.prefs.hidden[kind]
    const byId = new Map(data.catalog[kind].map((p) => [p.id, p]))
    return (
      <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-zinc-200">{title}</span>
          <span className="text-[10.5px] tabular-nums text-zinc-600">{hidden.length} hidden</span>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={async () => {
              await window.gt.presets.restore(kind)
              await load()
            }}
            disabled={hidden.length === 0}
            className="text-zinc-400 hover:text-zinc-200"
          >
            Restore all
          </Button>
        </div>
        {hidden.length === 0 ? (
          <div className="text-[11px] text-zinc-600">All presets are visible.</div>
        ) : (
          <div className="space-y-1">
            {hidden.map((id) => {
              const preset = byId.get(id)
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-md bg-black/25 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-300">
                    {preset?.title || id}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-600">{id}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={async () => {
                      await window.gt.presets.restore(kind, id)
                      await load()
                    }}
                    className="text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/10"
                  >
                    Restore
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {block('snippets', 'Prompt snippets')}
      {block('agents', 'Agents')}
    </div>
  )
}

function Component() {
  return (
    <Section
      id="presets"
      icon={Eye}
      title="Presets"
      desc="App-provided snippets and agents update with TerMinal. Hide the ones you do not want; custom global/repo items remain user-owned."
    >
      <PresetVisibilityPanel />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'presets',
  title: 'Presets',
  icon: Eye,
  order: 19,
  Component,
}
export default section
