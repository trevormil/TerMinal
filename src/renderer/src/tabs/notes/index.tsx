import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ExternalLink,
  File,
  FileText,
  FolderGit2,
  Globe,
  Image,
  Link2,
  NotebookText,
  Plus,
  Search,
  Sparkles,
  Tags,
  Trash2,
  Video,
} from 'lucide-react'
import { langs } from '@uiw/codemirror-extensions-langs'
import { CodeEditor } from '../../components/CodeEditor'
import { Markdown } from '../../components/Markdown'
import type {
  KnowledgeBase,
  KnowledgeCategory,
  KnowledgeItem,
  KnowledgeItemKind,
  KnowledgeScope,
  Tab,
  TabContext,
} from '../../lib/types'

type ViewMode = 'knowledge' | 'scratch'
type PreviewMode = 'edit' | 'preview' | 'split'

const kindMeta: Record<KnowledgeItemKind, { label: string; Icon: typeof FileText; hint: string }> = {
  markdown: { label: 'Markdown', Icon: FileText, hint: 'Snippet, note, playbook, transcript excerpt' },
  link: { label: 'Link', Icon: Link2, hint: 'URL, dashboard, issue, doc, repo page' },
  image: { label: 'Image', Icon: Image, hint: 'Remote image URL or local image path' },
  video: { label: 'Video', Icon: Video, hint: 'YouTube/Vimeo/direct video URL or local path' },
  file: { label: 'File', Icon: File, hint: 'Local file path or remote document URL' },
}

const slug = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

const newId = (base: string) => `${slug(base)}-${Math.random().toString(36).slice(2, 8)}`
const now = () => Date.now()
const starterKb = (): KnowledgeBase => ({
  version: 1,
  categories: [
    {
      id: 'general',
      title: 'General',
      description: 'Links, snippets, media, and references that do not need their own category yet.',
      order: 0,
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  items: [],
})

const displayPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const sourceOf = (item: KnowledgeItem) => item.url?.trim() || item.path?.trim() || ''
const fileUrl = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`
const mediaSrc = (item: KnowledgeItem) => {
  const src = sourceOf(item)
  if (!src) return ''
  if (/^https?:\/\//i.test(src) || /^file:\/\//i.test(src)) return src
  if (src.startsWith('/')) return fileUrl(src)
  return src
}
const videoEmbed = (src: string) => {
  const yt = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vimeo = src.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return ''
}
const youtubeThumb = (src: string) => {
  const yt = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/)
  return yt ? `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` : ''
}
const visualFor = (item: KnowledgeItem) => {
  if (item.thumbnailUrl?.trim()) return item.thumbnailUrl.trim()
  if (item.kind === 'image') return mediaSrc(item)
  if (item.kind === 'video') return youtubeThumb(sourceOf(item))
  return ''
}

function emptyItem(categoryId: string, kind: KnowledgeItemKind): KnowledgeItem {
  const ts = now()
  return {
    id: newId(kind),
    categoryId,
    kind,
    title: kindMeta[kind].label,
    description: '',
    content: kind === 'markdown' ? '# New note\n\n' : '',
    url: '',
    path: '',
    thumbnailUrl: '',
    faviconUrl: '',
    siteName: '',
    tags: [],
    createdAt: ts,
    updatedAt: ts,
  }
}

function KnowledgeTab({ ctx }: { ctx: TabContext }) {
  const hasRepo = !!ctx.repoRoot
  const [scope, setScope] = useState<KnowledgeScope>('global')
  const [view, setView] = useState<ViewMode>('knowledge')
  const [kb, setKb] = useState<KnowledgeBase>(starterKb)
  const [activeCategoryId, setActiveCategoryId] = useState('general')
  const [activeItemId, setActiveItemId] = useState('')
  const [query, setQuery] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newKind, setNewKind] = useState<KnowledgeItemKind>('markdown')
  const [saved, setSaved] = useState(true)
  const [scratch, setScratch] = useState('')
  const [scratchSaved, setScratchSaved] = useState(true)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('split')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewErr, setPreviewErr] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestKb = useRef(kb)
  const latestScratch = useRef({ scope, scratch, scratchSaved })
  latestKb.current = kb
  latestScratch.current = { scope, scratch, scratchSaved }

  useEffect(() => {
    if (scope === 'repo' && !hasRepo) setScope('global')
  }, [hasRepo, scope])

  useEffect(() => {
    let alive = true
    window.gt.knowledge.read(scope).then((next) => {
      if (!alive) return
      const normalized = next.categories.length ? next : starterKb()
      setKb(normalized)
      setActiveCategoryId((cur) => normalized.categories.some((c) => c.id === cur) ? cur : normalized.categories[0]?.id || 'general')
      setActiveItemId((cur) => normalized.items.some((i) => i.id === cur) ? cur : normalized.items[0]?.id || '')
      setSaved(true)
    })
    window.gt.notes.read(scope).then((text) => {
      if (!alive) return
      setScratch(text)
      setScratchSaved(true)
    })
    return () => {
      alive = false
    }
  }, [scope, ctx.repoRoot])

  useEffect(
    () => () => {
      if (!saved) window.gt.knowledge.write(scope, latestKb.current)
      if (!latestScratch.current.scratchSaved) {
        window.gt.notes.write(latestScratch.current.scope, latestScratch.current.scratch)
      }
    },
    [],
  )

  const persist = (next: KnowledgeBase, immediate = false) => {
    setKb(next)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const write = () => window.gt.knowledge.write(scope, next).then((ok) => ok && setSaved(true))
    if (immediate) write()
    else saveTimer.current = setTimeout(write, 550)
  }

  const saveScratch = (next: string) => {
    setScratch(next)
    setScratchSaved(false)
    if (scratchTimer.current) clearTimeout(scratchTimer.current)
    scratchTimer.current = setTimeout(() => {
      window.gt.notes.write(scope, next).then((ok) => ok && setScratchSaved(true))
    }, 550)
  }

  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const item of kb.items) out.set(item.categoryId, (out.get(item.categoryId) || 0) + 1)
    return out
  }, [kb.items])

  const activeCategory = kb.categories.find((c) => c.id === activeCategoryId) || kb.categories[0]
  const activeItem = kb.items.find((i) => i.id === activeItemId) || null
  const filteredItems = kb.items.filter((item) => {
    if (activeCategoryId && item.categoryId !== activeCategoryId) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [item.title, item.description || '', item.content || '', item.url || '', item.path || '', item.tags.join(' ')]
      .some((value) => value.toLowerCase().includes(q))
  })

  const addCategory = () => {
    const title = newCategory.trim()
    if (!title) return
    const ts = now()
    const category: KnowledgeCategory = {
      id: newId(title),
      title,
      description: '',
      order: kb.categories.length,
      createdAt: ts,
      updatedAt: ts,
    }
    persist({ ...kb, categories: [...kb.categories, category] }, true)
    setActiveCategoryId(category.id)
    setNewCategory('')
  }

  const deleteCategory = (id: string) => {
    if (kb.categories.length <= 1 || counts.get(id)) return
    const nextCategories = kb.categories.filter((c) => c.id !== id)
    persist({ ...kb, categories: nextCategories }, true)
    setActiveCategoryId(nextCategories[0]?.id || 'general')
  }

  const addItem = () => {
    const item = emptyItem(activeCategory?.id || 'general', newKind)
    persist({ ...kb, items: [item, ...kb.items] }, true)
    setActiveItemId(item.id)
  }

  const updateItem = (patch: Partial<KnowledgeItem>, immediate = false) => {
    if (!activeItem) return
    const nextItem = { ...activeItem, ...patch, updatedAt: now() }
    persist({ ...kb, items: kb.items.map((item) => item.id === nextItem.id ? nextItem : item) }, immediate)
  }

  const deleteItem = (id: string) => {
    const nextItems = kb.items.filter((item) => item.id !== id)
    persist({ ...kb, items: nextItems }, true)
    setActiveItemId(nextItems[0]?.id || '')
  }

  const enrichItem = async (item: KnowledgeItem) => {
    const target = item.url?.trim()
    if (!target) return
    setPreviewBusy(true)
    setPreviewErr('')
    const preview = await window.gt.knowledge.preview(target)
    setPreviewBusy(false)
    if (!preview.ok) {
      setPreviewErr(preview.error || 'Preview unavailable')
      return
    }
    updateItem({
      url: preview.url,
      title: item.title && item.title !== kindMeta[item.kind].label ? item.title : preview.title || item.title,
      description: item.description || preview.description || '',
      thumbnailUrl: item.thumbnailUrl || preview.thumbnailUrl || '',
      faviconUrl: item.faviconUrl || preview.faviconUrl || '',
      siteName: item.siteName || preview.siteName || '',
    }, true)
  }

  const scopeButton = (next: KnowledgeScope, label: string, Icon: typeof Globe, disabled = false) => (
    <button
      disabled={disabled}
      onClick={() => setScope(next)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold disabled:opacity-35 ${
        scope === next ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      <Icon size={13} strokeWidth={2} />
      {label}
    </button>
  )

  const modeButton = (next: PreviewMode, label: string) => (
    <button
      onClick={() => setPreviewMode(next)}
      className={`rounded-md px-2 py-1 text-[10.5px] font-medium ${
        previewMode === next ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )

  const itemPreview = (item: KnowledgeItem) => {
    const src = mediaSrc(item)
    if (item.kind === 'markdown') {
      return <Markdown>{item.content || ''}</Markdown>
    }
    if (item.kind === 'image') {
      return src ? (
        <img src={src} alt={item.title} className="max-h-[56vh] max-w-full rounded-lg border border-[var(--gt-border)] object-contain" />
      ) : <EmptyPreview text="Add an image URL or local path." />
    }
    if (item.kind === 'video') {
      const embed = src ? videoEmbed(src) : ''
      if (embed) {
        return <iframe title={item.title} src={embed} className="aspect-video w-full rounded-lg border border-[var(--gt-border)]" allowFullScreen />
      }
      return src ? (
        <video src={src} controls className="max-h-[56vh] w-full rounded-lg border border-[var(--gt-border)]" />
      ) : <EmptyPreview text="Add a YouTube, Vimeo, direct video URL, or local path." />
    }
    const target = sourceOf(item)
    return target ? (
      <div className="overflow-hidden rounded-xl border border-[var(--gt-border)] bg-black/20">
        {visualFor(item) && (
          <div className="aspect-[16/7] border-b border-[var(--gt-border)] bg-black/30">
            <img src={visualFor(item)} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="p-4">
        <div className="mb-2 flex items-center gap-2">
          {item.faviconUrl ? <img src={item.faviconUrl} alt="" className="h-4 w-4 rounded-sm" /> : null}
          <span className="truncate text-[11px] text-zinc-600">{item.siteName || (item.kind === 'link' ? 'Link target' : 'File target')}</span>
        </div>
        <div className="mb-1 text-[14px] font-semibold text-zinc-100">{item.title}</div>
        {item.description && <div className="mb-3 text-[12px] leading-relaxed text-zinc-500">{item.description}</div>}
        <div className="mb-3 break-all font-mono text-[11px] text-zinc-600">{displayPath(target)}</div>
        <button
          onClick={() => item.kind === 'file' && item.path ? window.gt.openInEditor(item.path) : window.gt.openInBrowser(target)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-3 text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/60"
        >
          <ExternalLink size={13} strokeWidth={2} />
          Open
        </button>
        </div>
      </div>
    ) : <EmptyPreview text="Add a URL or path." />
  }

  const editorPane = (item: KnowledgeItem) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 gap-2 border-b border-[var(--gt-border)] p-3 lg:grid-cols-[minmax(0,1fr)_150px_160px]">
        <input
          value={item.title}
          onChange={(e) => updateItem({ title: e.target.value })}
          onBlur={() => updateItem({}, true)}
          className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2.5 py-1.5 text-[13px] font-semibold text-zinc-100 outline-none focus:border-[var(--gt-accent)]/60"
        />
        <select
          value={item.kind}
          onChange={(e) => updateItem({ kind: e.target.value as KnowledgeItemKind }, true)}
          className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 text-[12px] text-zinc-200 outline-none"
        >
          {(Object.keys(kindMeta) as KnowledgeItemKind[]).map((kind) => (
            <option key={kind} value={kind} className="bg-[var(--gt-panel)]">
              {kindMeta[kind].label}
            </option>
          ))}
        </select>
        <select
          value={item.categoryId}
          onChange={(e) => updateItem({ categoryId: e.target.value }, true)}
          className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 text-[12px] text-zinc-200 outline-none"
        >
          {kb.categories.map((category) => (
            <option key={category.id} value={category.id} className="bg-[var(--gt-panel)]">
              {category.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid shrink-0 gap-2 border-b border-[var(--gt-border)] p-3 lg:grid-cols-[minmax(0,1fr)_240px]">
        <input
          value={item.description || ''}
          onChange={(e) => updateItem({ description: e.target.value })}
          placeholder="Short description"
          className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
        />
        <div className="flex items-center gap-1 rounded-md border border-[var(--gt-border)] bg-black/25 px-2">
          <Tags size={12} strokeWidth={2} className="text-zinc-600" />
          <input
            value={item.tags.join(', ')}
            onChange={(e) => updateItem({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
            placeholder="tags"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700"
          />
        </div>
      </div>
      {item.kind !== 'markdown' && (
        <div className="shrink-0 border-b border-[var(--gt-border)] p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={item.url || ''}
            onChange={(e) => updateItem({ url: e.target.value })}
            onBlur={() => item.url && enrichItem(item)}
            placeholder="https://..."
            className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 py-1.5 font-mono text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
          />
          <input
            value={item.path || ''}
            onChange={(e) => updateItem({ path: e.target.value })}
            placeholder="/local/path.ext"
            className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 py-1.5 font-mono text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
          />
          <button
            onClick={() => enrichItem(item)}
            disabled={!item.url || previewBusy}
            className="inline-flex h-[33px] items-center justify-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-3 text-[11.5px] text-zinc-300 hover:border-[var(--gt-accent)]/60 disabled:opacity-40"
          >
            <Sparkles size={12} strokeWidth={2} className={previewBusy ? 'animate-pulse' : ''} />
            Preview
          </button>
        </div>
        <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
          <input
            value={item.thumbnailUrl || ''}
            onChange={(e) => updateItem({ thumbnailUrl: e.target.value })}
            placeholder="thumbnail URL"
            className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
          />
          <input
            value={item.siteName || ''}
            onChange={(e) => updateItem({ siteName: e.target.value })}
            placeholder="site name"
            className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5 text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
          />
          <input
            value={item.faviconUrl || ''}
            onChange={(e) => updateItem({ faviconUrl: e.target.value })}
            placeholder="favicon URL"
            className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
          />
        </div>
        {previewErr && <div className="mt-1 text-[10.5px] text-amber-400">{previewErr}</div>}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {item.kind === 'markdown' ? (
          previewMode === 'edit' ? (
            <CodeEditor value={item.content || ''} onChange={(value) => updateItem({ content: value })} extensions={[langs.markdown()]} wrap />
          ) : previewMode === 'preview' ? (
            <div className="h-full overflow-y-auto p-5">{itemPreview(item)}</div>
          ) : (
            <div className="flex h-full min-h-0">
              <div className="min-h-0 w-1/2 border-r border-[var(--gt-border)]">
                <CodeEditor value={item.content || ''} onChange={(value) => updateItem({ content: value })} extensions={[langs.markdown()]} wrap />
              </div>
              <div className="min-h-0 w-1/2 overflow-y-auto p-5">{itemPreview(item)}</div>
            </div>
          )
        ) : (
          <div className="h-full overflow-y-auto p-5">{itemPreview(item)}</div>
        )}
      </div>
    </div>
  )

  const scratchBody = previewMode === 'edit' ? (
    <CodeEditor value={scratch} onChange={saveScratch} extensions={[langs.markdown()]} wrap />
  ) : previewMode === 'preview' ? (
    <div className="h-full overflow-y-auto p-5"><Markdown>{scratch}</Markdown></div>
  ) : (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 w-1/2 border-r border-[var(--gt-border)]">
        <CodeEditor value={scratch} onChange={saveScratch} extensions={[langs.markdown()]} wrap />
      </div>
      <div className="min-h-0 w-1/2 overflow-y-auto p-5"><Markdown>{scratch}</Markdown></div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <div className="flex items-center gap-2">
          <BookOpen size={15} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Knowledge Base</div>
            <div className="text-[10.5px] text-zinc-600">{kb.items.length} items · {kb.categories.length} categories</div>
          </div>
        </div>
        <div className="ml-2 flex rounded-lg border border-[var(--gt-border)] p-0.5">
          <button
            onClick={() => setView('knowledge')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold ${view === 'knowledge' ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <BookOpen size={13} strokeWidth={2} />
            Items
          </button>
          <button
            onClick={() => setView('scratch')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold ${view === 'scratch' ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <NotebookText size={13} strokeWidth={2} />
            Scratch
          </button>
        </div>
        <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
          {scopeButton('global', 'Global', Globe)}
          {scopeButton('repo', 'Repo', FolderGit2, !hasRepo)}
        </div>
        <div className="min-w-[180px] max-w-[360px] flex-1">
          <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-2">
            <Search size={13} strokeWidth={2} className="text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search knowledge..."
              className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700"
            />
          </div>
        </div>
        <span className={`text-[10.5px] ${view === 'scratch' ? (scratchSaved ? 'text-zinc-600' : 'text-amber-400') : (saved ? 'text-zinc-600' : 'text-amber-400')}`}>
          {view === 'scratch' ? (scratchSaved ? 'saved' : 'saving...') : (saved ? 'saved' : 'saving...')}
        </span>
        <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
          {modeButton('edit', 'Edit')}
          {modeButton('split', 'Split')}
          {modeButton('preview', 'Preview')}
        </div>
      </header>

      {view === 'scratch' ? (
        <div className="min-h-0 flex-1">{scratchBody}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30">
            <div className="border-b border-[var(--gt-border)] p-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">Categories</div>
              <div className="flex gap-1">
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCategory()
                  }}
                  placeholder="new category"
                  className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
                />
                <button onClick={addCategory} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100">
                  <Plus size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {kb.categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                  className={`group mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left ${
                    activeCategoryId === category.id
                      ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/12 text-zinc-100'
                      : 'border-transparent text-zinc-400 hover:border-[var(--gt-border)] hover:bg-white/5 hover:text-zinc-200'
                  }`}
                >
                  <BookOpen size={13} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{category.title}</span>
                    <span className="text-[10px] text-zinc-600">{counts.get(category.id) || 0} items</span>
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteCategory(category.id)
                    }}
                    className={`rounded p-1 text-zinc-700 ${counts.get(category.id) || kb.categories.length <= 1 ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 hover:bg-white/5 hover:text-[var(--gt-red)]'}`}
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex w-80 shrink-0 flex-col border-r border-[var(--gt-border)]">
            <div className="border-b border-[var(--gt-border)] p-2">
              <div className="mb-2 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-zinc-100">{activeCategory?.title || 'Category'}</div>
                  <div className="truncate text-[10.5px] text-zinc-600">{activeCategory?.description || 'Typed references and media.'}</div>
                </div>
              </div>
              <div className="flex gap-1">
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as KnowledgeItemKind)}
                  className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none"
                >
                  {(Object.keys(kindMeta) as KnowledgeItemKind[]).map((kind) => (
                    <option key={kind} value={kind} className="bg-[var(--gt-panel)]">
                      {kindMeta[kind].label}
                    </option>
                  ))}
                </select>
                <button onClick={addItem} className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60">
                  <Plus size={12} strokeWidth={2.5} />
                  Add
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filteredItems.length === 0 ? (
                <div className="p-4 text-[12px] text-zinc-600">No matching knowledge items.</div>
              ) : (
                filteredItems.map((item) => {
                  const meta = kindMeta[item.kind]
                  const Icon = meta.Icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveItemId(item.id)}
                      className={`mb-1.5 w-full overflow-hidden rounded-lg border text-left ${
                        activeItemId === item.id
                          ? 'border-[var(--gt-accent)]/55 bg-[var(--gt-accent)]/12'
                          : 'border-[var(--gt-border)] bg-black/15 hover:border-[var(--gt-accent)]/35 hover:bg-white/5'
                      }`}
                    >
                      {visualFor(item) && (
                        <div className="aspect-[16/6] bg-black/30">
                          <img src={visualFor(item)} alt="" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <span className="flex items-start gap-2 p-2">
                        <Icon size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {item.faviconUrl ? <img src={item.faviconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" /> : null}
                            <span className="block truncate text-[12px] font-semibold text-zinc-200">{item.title}</span>
                          </span>
                          <span className="line-clamp-2 text-[10.5px] leading-snug text-zinc-600">
                          {item.description || sourceOf(item) || meta.hint}
                          </span>
                        </span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <main className="min-w-0 flex-1">
            {activeItem ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
                  <span className="truncate text-[11px] text-zinc-500">{kindMeta[activeItem.kind].label}</span>
                  <span className="text-zinc-700">/</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{activeItem.title}</span>
                  <button
                    onClick={() => deleteItem(activeItem.id)}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 text-[10.5px] text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                  >
                    <Trash2 size={11} strokeWidth={2} />
                    Delete
                  </button>
                </div>
                <div className="min-h-0 flex-1">{editorPane(activeItem)}</div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-md">
                  <BookOpen size={28} strokeWidth={1.8} className="mx-auto mb-3 text-[var(--gt-accent-light)]" />
                  <div className="text-sm font-semibold text-zinc-200">Build a local knowledge base</div>
                  <div className="mt-1 text-[12px] leading-relaxed text-zinc-600">
                    Add markdown snippets, links, images, videos, or files. Categories are dynamic and scoped to this repo or globally.
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

function EmptyPreview({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-center text-[12px] text-zinc-600">
      {text}
    </div>
  )
}

const tab: Tab = {
  id: 'notes',
  title: 'Knowledge Base',
  icon: BookOpen,
  order: 7,
  appliesTo: () => true,
  Component: KnowledgeTab,
}
export default tab
