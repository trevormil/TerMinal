import { useEffect, useState } from 'react'
import { Rows3 } from 'lucide-react'
import { DEFAULT_HIDDEN_TABS, loadHiddenTabs } from '../../lib/tabVisibility'
import { Section, type SettingsSectionSpec } from './shared'

// Tab visibility — let the user hide tabs they never use. Persists to
// localStorage and broadcasts a synthetic event so SessionView re-renders
// without a window reload.
function TabsVisibilityPanel() {
  const [hidden, setHidden] = useState<string[]>(() => loadHiddenTabs())
  // ALL_TABS is the source of truth for the tab list — import lazily to avoid
  // a circular import (tabs/registry → tabs/* → components/SettingsPanel).
  const [allTabs, setAllTabs] = useState<{ id: string; title: string; order: number }[]>([])
  useEffect(() => {
    void import('../../tabs/registry').then((m) => {
      setAllTabs(
        [...m.ALL_TABS]
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
          .map((t) => ({ id: t.id, title: t.title, order: t.order ?? 99 })),
      )
    })
  }, [])
  const toggle = (id: string) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      localStorage.setItem('gt.tabs.hidden', JSON.stringify(next))
      window.dispatchEvent(new Event('gt.tabs.hidden.changed'))
      return next
    })
  }
  if (allTabs.length === 0) return <div className="text-[11px] text-zinc-600">loading…</div>
  return (
    <div className="grid grid-cols-2 gap-1">
      <div className="col-span-2 mb-1 text-[10.5px] text-zinc-600">
        New installs hide {DEFAULT_HIDDEN_TABS.join(', ')} by default. Toggle them on here when
        needed.
      </div>
      {allTabs.map((t) => {
        const off = hidden.includes(t.id)
        return (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            className={`flex items-center justify-between rounded-md border px-2 py-1 text-[11px] ${
              off
                ? 'border-[var(--gt-border)] bg-black/20 text-zinc-500 line-through'
                : 'border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 text-zinc-100'
            }`}
          >
            <span className="truncate">{t.title}</span>
            <span className="text-[9.5px] text-zinc-600">{off ? 'Hidden' : 'Shown'}</span>
          </button>
        )
      })}
    </div>
  )
}

function Component() {
  return (
    <Section
      id="tabs"
      icon={Rows3}
      title="Tabs"
      desc="Hide tabs you don't use. They stay registered (so cross-tab nav still works); they just don't render in the tab bar."
    >
      <TabsVisibilityPanel />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'tabs',
  title: 'Tabs',
  icon: Rows3,
  order: 17,
  Component,
}
export default section
