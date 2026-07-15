import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  BarChart3,
  Boxes,
  FileText,
  Gauge,
  Globe,
  Server,
  Table2,
  type LucideIcon,
} from 'lucide-react'
import type { CustomTab, Tab, TabContext } from '../lib/types'

// tabs.json `icon` is a string name; map the curated set to Lucide components.
// Unknown / omitted → LayoutDashboard. Kept small on purpose (§2).
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  chart: BarChart3,
  boxes: Boxes,
  doc: FileText,
  gauge: Gauge,
  globe: Globe,
  server: Server,
  table: Table2,
}
const iconFor = (name?: string): LucideIcon =>
  (name && ICONS[name.toLowerCase()]) || LayoutDashboard

const IFRAME = 'h-full w-full border-0 bg-white'

function UrlTab({ url }: { url: string }) {
  return (
    <iframe
      src={url}
      title={url}
      className={IFRAME}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  )
}

function CommandTab({
  command,
  cwd,
  intervalMs,
}: {
  command: string
  cwd: string
  intervalMs?: number
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const run = async () => {
      const res = await window.gt.runTabView(command, cwd)
      if (!alive) return
      if (res.ok) {
        setHtml(res.html)
        setError(null)
      } else {
        setError(res.html || `command exited ${res.code}`)
      }
    }
    run()
    if (intervalMs && intervalMs > 0) {
      const t = setInterval(run, intervalMs)
      return () => {
        alive = false
        clearInterval(t)
      }
    }
    return () => {
      alive = false
    }
  }, [command, cwd, intervalMs])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)] p-6">
        <pre className="max-w-full overflow-auto whitespace-pre-wrap text-xs text-[var(--gt-red)]">
          {error}
        </pre>
      </div>
    )
  }
  if (html === null) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)] text-xs text-zinc-500">
        Loading…
      </div>
    )
  }
  return (
    <iframe
      srcDoc={html}
      title={command}
      className={IFRAME}
      sandbox="allow-scripts allow-popups allow-forms"
    />
  )
}

export function CustomTabView({ tab, ctx }: { tab: CustomTab; ctx: TabContext }) {
  if (tab.url) return <UrlTab url={tab.url} />
  if (tab.command)
    return <CommandTab command={tab.command} cwd={ctx.cwd} intervalMs={tab.intervalMs} />
  return (
    <div className="flex h-full items-center justify-center text-xs text-zinc-500">
      Empty custom tab (no url or command)
    </div>
  )
}

function toTab(ct: CustomTab): Tab {
  return {
    id: ct.id,
    title: ct.title,
    icon: iconFor(ct.icon),
    order: 50, // after the built-ins, before Help/Reports
    appliesTo: () => true, // already repo-scoped by being loaded from this cwd
    Component: ({ ctx }) => <CustomTabView tab={ct} ctx={ctx} />,
  }
}

// Load a session's tabs.json (global + per-repo for its cwd) as Tab objects.
export function useCustomTabs(cwd: string): Tab[] {
  const [tabs, setTabs] = useState<CustomTab[]>([])
  useEffect(() => {
    let alive = true
    window.gt
      .listCustomTabs(cwd)
      .then((t) => alive && setTabs(t))
      .catch(() => alive && setTabs([]))
    return () => {
      alive = false
    }
  }, [cwd])
  return useMemo(() => tabs.map(toTab), [tabs])
}
