import { useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  Bot,
  Clipboard,
  ExternalLink,
  FileJson,
  Globe2,
  LayoutGrid,
  PackageOpen,
  Search,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { MarketplaceItem, MarketplaceManifest, MarketplaceType, Tab, TabContext } from '../../lib/types'

const TYPE_META: Record<MarketplaceType, { label: string; icon: LucideIcon; tone: string }> = {
  plugin: { label: 'Plugin', icon: Blocks, tone: 'text-cyan-300 border-cyan-400/25 bg-cyan-400/10' },
  widget: { label: 'Widget', icon: LayoutGrid, tone: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10' },
  skill: { label: 'Skill', icon: Sparkles, tone: 'text-violet-300 border-violet-400/25 bg-violet-400/10' },
  agent: { label: 'Agent', icon: Bot, tone: 'text-amber-300 border-amber-400/25 bg-amber-400/10' },
  snippet: { label: 'Snippet', icon: Clipboard, tone: 'text-sky-300 border-sky-400/25 bg-sky-400/10' },
}

const FILTERS: ('all' | MarketplaceType)[] = ['all', 'plugin', 'widget', 'skill', 'agent', 'snippet']

function rawUrl(manifest: MarketplaceManifest | null, item: MarketplaceItem, path = item.paths[0]): string {
  return manifest?.baseRawUrl ? `${manifest.baseRawUrl}/${path}` : ''
}

function TypePill({ type }: { type: MarketplaceType }) {
  const meta = TYPE_META[type]
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] ${meta.tone}`}>
      <Icon size={11} strokeWidth={2} />
      {meta.label}
    </span>
  )
}

function CopyButton({ text, label = 'Copy path' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        await window.gt.clipboardWrite(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50"
    >
      <Clipboard size={12} strokeWidth={2} />
      {copied ? 'Copied' : label}
    </button>
  )
}

function MarketplaceRow({ manifest, item }: { manifest: MarketplaceManifest; item: MarketplaceItem }) {
  const url = rawUrl(manifest, item)
  return (
    <article className="grid grid-cols-[132px_minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--gt-border)] px-4 py-3 last:border-b-0">
      <div className="space-y-2">
        <TypePill type={item.type} />
        <div className="text-[10.5px] text-zinc-600">v{item.version}</div>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-[13px] font-semibold text-zinc-100">{item.title}</h3>
          <span className="rounded-full border border-[var(--gt-border)] px-1.5 py-px text-[10px] text-zinc-500">
            {item.install.scope || 'repo'}
          </span>
          {item.engine?.map((e) => (
            <span key={e} className="rounded-full bg-black/25 px-1.5 py-px font-mono text-[10px] text-zinc-500">
              {e}
            </span>
          ))}
        </div>
        <p className="mt-1 max-w-3xl text-[12px] leading-snug text-zinc-400">{item.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-zinc-600">
          <span>
            Added by <span className="text-zinc-400">{item.addedBy}</span>
          </span>
          <span>{'->'}</span>
          <code className="rounded bg-black/20 px-1.5 py-0.5 text-zinc-500">{item.install.copyTo}</code>
          {item.install.merge && <span className="text-zinc-500">{item.install.merge}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.tags.map((t) => (
            <span key={t} className="rounded border border-[var(--gt-border)] px-1.5 py-px text-[10px] text-zinc-500">
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <button
          disabled={!url}
          onClick={() => url && window.gt.openExternal(url)}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50 disabled:opacity-40"
        >
          Raw
          <ExternalLink size={12} strokeWidth={2} />
        </button>
        <CopyButton text={item.install.copyTo} />
      </div>
    </article>
  )
}

function MarketplaceTab(_props: { ctx: TabContext }) {
  const [manifest, setManifest] = useState<MarketplaceManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MarketplaceType>('all')

  useEffect(() => {
    let alive = true
    setLoading(true)
    window.gt.marketplace
      .list()
      .then((m) => {
        if (alive) setManifest(m)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const counts = useMemo(() => {
    const out: Record<'all' | MarketplaceType, number> = {
      all: manifest?.items.length || 0,
      plugin: 0,
      widget: 0,
      skill: 0,
      agent: 0,
      snippet: 0,
    }
    for (const item of manifest?.items || []) out[item.type] += 1
    return out
  }, [manifest])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (manifest?.items || []).filter((item) => {
      if (filter !== 'all' && item.type !== filter) return false
      if (!q) return true
      return [item.title, item.description, item.id, item.addedBy, item.install.copyTo, ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [manifest, filter, query])

  return (
    <div className="flex h-full flex-col bg-[var(--gt-bg)]">
      <header className="shrink-0 border-b border-[var(--gt-border)] px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PackageOpen size={16} strokeWidth={2} className="text-[var(--gt-accent-2)]" />
              <h1 className="text-[13px] font-semibold text-zinc-100">Marketplace</h1>
              {manifest && (
                <span className="rounded-full border border-[var(--gt-border)] px-1.5 py-px text-[10px] text-zinc-500">
                  {manifest.items.length} items
                </span>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-[12px] leading-snug text-zinc-500">
              Git-backed presets for plugins, command widgets, skills, agents, and snippets. Entries are plain files
              from <code className="font-mono text-zinc-400">.marketplace/</code>; installed copies remain user-owned.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {manifest?.sourcePath && (
              <CopyButton text={manifest.sourcePath} label="Copy source" />
            )}
            {manifest?.baseRawUrl && (
              <button
                onClick={() => window.gt.openExternal(`${manifest.baseRawUrl}/manifest.json`)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50"
              >
                Manifest
                <FileJson size={12} strokeWidth={2} />
              </button>
            )}
            <button
              onClick={() => window.gt.openExternal('https://github.com/trevormil/TerMinal/tree/main/.marketplace')}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50"
            >
              Browse more
              <Globe2 size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} strokeWidth={2} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search marketplace"
            className="h-8 w-full rounded-md border border-[var(--gt-border)] bg-black/20 pl-7 pr-2 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-2 py-1 text-[11px] ${
                filter === f
                  ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'border-[var(--gt-border)] text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {f === 'all' ? 'All' : TYPE_META[f].label} {counts[f] ? counts[f] : ''}
            </button>
          ))}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
            Loading marketplace...
          </div>
        ) : !manifest?.items.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12px] text-zinc-600">
            <Wrench size={28} strokeWidth={1.5} className="text-zinc-700" />
            <p>No marketplace manifest found in the app bundle or source checkout.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">No matches.</div>
        ) : (
          <div className="mx-auto max-w-6xl border-x border-[var(--gt-border)]">
            {items.map((item) => (
              <MarketplaceRow key={item.id} manifest={manifest} item={item} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

const tab: Tab = {
  id: 'marketplace',
  title: 'Marketplace',
  icon: PackageOpen,
  order: 8.5,
  appliesTo: () => true,
  Component: MarketplaceTab,
}
export default tab
