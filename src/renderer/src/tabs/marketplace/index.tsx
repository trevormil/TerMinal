import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Blocks,
  Bot,
  Brain,
  Clipboard,
  CircleCheck,
  ExternalLink,
  FileText,
  Gauge,
  GitBranch,
  LayoutGrid,
  PackageOpen,
  RefreshCw,
  ScanSearch,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { EnginePicker } from '../../components/EnginePicker'
import { openPromptInTerminal, withLaunchContext, type LaunchMode } from '../../lib/launch'
import type { Engine, MarketplaceItem, MarketplaceManifest, MarketplaceType, Tab, TabContext } from '../../lib/types'

const TYPE_META: Record<MarketplaceType, { label: string; icon: LucideIcon; tone: string; accent: string }> = {
  plugin: { label: 'Plugin', icon: Blocks, tone: 'text-cyan-300 border-cyan-400/25 bg-cyan-400/10', accent: '#22d3ee' },
  widget: {
    label: 'Widget',
    icon: LayoutGrid,
    tone: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10',
    accent: '#34d399',
  },
  skill: {
    label: 'Skill',
    icon: Sparkles,
    tone: 'text-violet-300 border-violet-400/25 bg-violet-400/10',
    accent: '#a78bfa',
  },
  agent: { label: 'Agent', icon: Bot, tone: 'text-amber-300 border-amber-400/25 bg-amber-400/10', accent: '#f59e0b' },
  snippet: {
    label: 'Snippet',
    icon: Clipboard,
    tone: 'text-sky-300 border-sky-400/25 bg-sky-400/10',
    accent: '#38bdf8',
  },
}

const FILTERS: ('all' | MarketplaceType)[] = ['all', 'plugin', 'widget', 'skill', 'agent', 'snippet']
const ICONS: Record<string, LucideIcon> = {
  Activity,
  Blocks,
  Bot,
  Brain,
  Clipboard,
  CircleCheck,
  FileText,
  Gauge,
  GitBranch,
  LayoutGrid,
  PackageOpen,
  RefreshCw,
  ScanSearch,
  Sparkles,
}

function rawUrl(manifest: MarketplaceManifest | null, item: MarketplaceItem, path = item.paths[0]): string {
  return manifest?.baseRawUrl ? `${manifest.baseRawUrl}/${path}` : ''
}

function sourceRoot(manifest: MarketplaceManifest): string {
  return manifest.sourcePath.replace(/\/\.marketplace$/, '').replace(/\/marketplace$/, '')
}

function installCwd(manifest: MarketplaceManifest, item: MarketplaceItem, ctx: TabContext): string {
  if (item.install.scope === 'app' && manifest.sourcePath.endsWith('/.marketplace')) return sourceRoot(manifest)
  return ctx.repoRoot || ctx.cwd || sourceRoot(manifest)
}

function launcherPrompt(manifest: MarketplaceManifest, item: MarketplaceItem): string {
  const url = rawUrl(manifest, item)
  const meta = [
    `Marketplace item: ${item.title}`,
    `Type: ${item.type}`,
    `Added by: ${item.addedBy}`,
    `Source: ${url || item.paths.join(', ')}`,
    `Install target: ${item.install.copyTo}`,
    item.install.merge ? `Merge rule: ${item.install.merge}` : '',
    `Tags: ${item.tags.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n')
  const request = `Install or recreate this TerMinal Marketplace ${item.type}. Preserve existing user customizations, follow the destination file conventions, verify the changed JSON/TypeScript/Markdown if applicable, and summarize exactly what changed.\n\n${meta}`
  if (item.type === 'snippet') return `/new-snippet ${request}`
  if (item.type === 'agent') return `/new-agent ${request}`
  if (item.type === 'widget') return `/terminal-widget ${request}`
  if (item.type === 'skill') return `Create or install this TerMinal skill from the marketplace.\n\n${request}`
  return `Install this TerMinal app plugin from the marketplace.\n\n${request}`
}

function itemAccent(item: MarketplaceItem): string {
  return item.accent || TYPE_META[item.type].accent
}

function itemIcon(item: MarketplaceItem): LucideIcon {
  return (item.icon && ICONS[item.icon]) || TYPE_META[item.type].icon
}

function MarketplaceIcon({ item, size = 'md' }: { item: MarketplaceItem; size?: 'sm' | 'md' }) {
  const Icon = itemIcon(item)
  const accent = itemAccent(item)
  const box = size === 'sm' ? 'h-9 w-9 rounded-lg' : 'h-12 w-12 rounded-xl'
  const iconSize = size === 'sm' ? 17 : 22
  return (
    <div
      className={`flex shrink-0 items-center justify-center border ${box}`}
      style={{ borderColor: `${accent}66`, background: `${accent}18`, color: accent }}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </div>
  )
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

function EngineChips({ item }: { item: MarketplaceItem }) {
  if (!item.engine?.length) return null
  return (
    <>
      {item.engine.map((e) => (
        <span key={e} className="rounded bg-black/25 px-1.5 py-px font-mono text-[10px] text-zinc-500">
          {e}
        </span>
      ))}
    </>
  )
}

function FeaturedItem({ item, onLaunch }: { item: MarketplaceItem; onLaunch: (item: MarketplaceItem) => void }) {
  return (
    <button
      onClick={() => onLaunch(item)}
      className="group grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-white/[0.025] p-2 text-left hover:border-[var(--gt-accent)]/45 hover:bg-white/[0.04]"
    >
      <MarketplaceIcon item={item} size="sm" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-zinc-100">{item.title}</span>
          <span className="shrink-0 rounded-full bg-[var(--gt-accent)]/15 px-1.5 py-px text-[9.5px] text-[var(--gt-accent-light)]">
            Featured
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-zinc-600">
          <span className="truncate">{item.addedBy}</span>
          <span>·</span>
          <span>{TYPE_META[item.type].label}</span>
          <span className="text-zinc-500 group-hover:text-zinc-300">Install</span>
        </div>
      </div>
    </button>
  )
}

function MarketplaceRow({ item, onLaunch }: { item: MarketplaceItem; onLaunch: (item: MarketplaceItem) => void }) {
  const scope = item.install.scope || 'repo'
  return (
    <article className="grid grid-cols-[52px_minmax(0,1fr)_112px] items-start gap-3 border-b border-[var(--gt-border)] px-4 py-3 last:border-b-0 hover:bg-white/[0.025]">
      <MarketplaceIcon item={item} />

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h3 className="truncate text-[13px] font-semibold text-zinc-100">{item.title}</h3>
          {item.featured && (
            <span className="rounded-full border border-[var(--gt-accent)]/25 bg-[var(--gt-accent)]/10 px-1.5 py-px text-[9.5px] text-[var(--gt-accent-light)]">
              Featured
            </span>
          )}
          <TypePill type={item.type} />
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-600">
          <span>
            Added by <span className="text-zinc-300">{item.addedBy}</span>
          </span>
          <span>·</span>
          <span>v{item.version}</span>
          <span>·</span>
          <span className="rounded bg-black/25 px-1.5 py-px text-zinc-500">{scope}</span>
          <EngineChips item={item} />
        </div>
        <p className="mt-1 truncate text-[12px] text-zinc-400">{item.description}</p>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-[10.5px] text-zinc-600">
          <code className="max-w-[420px] truncate rounded bg-black/20 px-1.5 py-0.5 text-zinc-500">
            {item.install.copyTo}
          </code>
          {item.install.merge && <span className="text-zinc-500">{item.install.merge}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <span key={t} className="rounded border border-[var(--gt-border)] px-1.5 py-px text-[10px] text-zinc-500">
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <button
          onClick={() => onLaunch(item)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 hover:border-[var(--gt-accent)]/80"
        >
          <SquareTerminal size={12} strokeWidth={2} />
          Install
        </button>
        <span className="max-w-[108px] truncate text-right font-mono text-[9.5px] text-zinc-700">{item.id}</span>
      </div>
    </article>
  )
}

function MarketplaceTab({ ctx }: { ctx: TabContext }) {
  const [manifest, setManifest] = useState<MarketplaceManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MarketplaceType>('all')
  const [picking, setPicking] = useState<MarketplaceItem | null>(null)
  const [flash, setFlash] = useState('')

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
      return [item.title, item.description, item.id, item.addedBy, item.install.copyTo, item.icon || '', ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [manifest, filter, query])
  const featured = useMemo(() => (manifest?.items || []).filter((item) => item.featured).slice(0, 3), [manifest])

  const launchItem = async (
    item: MarketplaceItem,
    engine: Engine,
    persona: string,
    pipeline: string,
    model?: string,
    launchMode?: LaunchMode,
  ) => {
    if (!manifest) return
    const cwd = installCwd(manifest, item, ctx)
    const prompt = withLaunchContext(launcherPrompt(manifest, item), { persona, pipeline, model })
    setPicking(null)
    if (launchMode !== 'process') {
      openPromptInTerminal({
        engine,
        cwd,
        name: `Marketplace · ${item.title}`,
        prompt,
      })
      setFlash(`opened ${engine} instance`)
      window.setTimeout(() => setFlash(''), 3500)
      return
    }
    const r = await window.gt.bg.spawn({ repoRoot: cwd, prompt, engine, model })
    if ('error' in r) {
      setFlash(r.error)
      window.setTimeout(() => setFlash(''), 6000)
      return
    }
    setFlash(`${engine} process started · see Runs`)
    window.setTimeout(() => setFlash(''), 4000)
  }

  return (
    <div className="relative flex h-full flex-col bg-[var(--gt-bg)]">
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
              Git-backed extensions, agents, skills, snippets, and widgets. Pick an item, choose Claude, Codex, or
              Cursor, then install through a terminal instance or background process.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {flash && (
              <span className="inline-flex items-center rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 text-[11px] text-zinc-400">
                {flash}
              </span>
            )}
            <button
              onClick={() => window.gt.openExternal('https://github.com/trevormil/TerMinal/tree/main/.marketplace')}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50"
            >
              Browse more
              <ExternalLink size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
        {!query.trim() && filter === 'all' && featured.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {featured.map((item) => (
              <FeaturedItem key={item.id} item={item} onLaunch={setPicking} />
            ))}
          </div>
        )}
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
            <p>No marketplace items are shipped yet.</p>
            <p className="max-w-sm text-[11px] leading-snug text-zinc-700">
              The schema and in-app browser are ready; the catalog will stay empty until third-party integrations are
              worth publishing.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">No matches.</div>
        ) : (
          <div className="mx-auto max-w-6xl border-x border-[var(--gt-border)] bg-black/[0.06]">
            <div className="flex items-center justify-between border-b border-[var(--gt-border)] px-4 py-2 text-[10.5px] text-zinc-600">
              <span>
                Showing <span className="text-zinc-400">{items.length}</span> of{' '}
                <span className="text-zinc-400">{manifest.items.length}</span>
              </span>
              <span>Source: Git main branch</span>
            </div>
            {items.map((item) => (
              <MarketplaceRow key={item.id} item={item} onLaunch={setPicking} />
            ))}
          </div>
        )}
      </main>
      {picking && (
        <EnginePicker
          title={`Install · ${picking.title}`}
          showPersona={false}
          showPipeline={false}
          hint={
            <>
              Opens the selected Marketplace item with its install prompt prefilled. Terminal mode lets you iterate;
              Process runs it in a background worktree.
            </>
          }
          onClose={() => setPicking(null)}
          onPick={(engine, persona, pipeline, model, launchMode) =>
            launchItem(picking, engine, persona, pipeline, model, launchMode)
          }
        />
      )}
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
