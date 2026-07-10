import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Globe, PanelLeftClose, PanelLeftOpen, X, Plus, Trash2, BookOpen, ChevronDown } from 'lucide-react'
import type { KnowledgeScope, Tab, TabContext } from '../../lib/types'
import { appendKnowledgeItem, singleHttpUrl } from '../../lib/knowledge'
import chatgptLogo from '../../assets/ai-tools/chatgpt.png'
import claudeLogo from '../../assets/ai-tools/claude.png'
import geminiLogo from '../../assets/ai-tools/gemini.png'
import perplexityLogo from '../../assets/ai-tools/perplexity.png'
import copilotLogo from '../../assets/ai-tools/copilot.png'
import grokLogo from '../../assets/ai-tools/grok.png'
import mistralLogo from '../../assets/ai-tools/mistral.png'
import poeLogo from '../../assets/ai-tools/poe.png'
import huggingfaceLogo from '../../assets/ai-tools/huggingface.png'
import notebooklmLogo from '../../assets/ai-tools/notebooklm.png'
import deepseekLogo from '../../assets/ai-tools/deepseek.png'
import metaaiLogo from '../../assets/ai-tools/metaai.png'
import youLogo from '../../assets/ai-tools/you.png'
import t3chatLogo from '../../assets/ai-tools/t3chat.png'

// The Electron <webview> surface we drive. Created imperatively (below) so we
// don't fight React/TS over the custom element.
type Webview = HTMLElement & {
  src: string
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  canGoBack(): boolean
  canGoForward(): boolean
}

const HOME = 'https://www.google.com'
const SIDEBAR_KEY = 'gt.browser.aiToolsExpanded'
const CUSTOM_KEY = 'gt.browser.customBookmarks'
const HIDDEN_PRESETS_KEY = 'gt.browser.hiddenPresetBookmarks'
const AI_TOOLS = [
  { id: 'skills', title: 'Skills', url: 'https://skills.sh/' },
  { id: 'integrations', title: 'Integrations', url: 'https://integrations.sh/' },
  { id: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com/', logo: chatgptLogo },
  { id: 'claude', title: 'Claude', url: 'https://claude.ai/new', logo: claudeLogo },
  { id: 'gemini', title: 'Gemini', url: 'https://gemini.google.com/app', logo: geminiLogo },
  { id: 'perplexity', title: 'Perplexity', url: 'https://www.perplexity.ai/', logo: perplexityLogo },
  { id: 'copilot', title: 'Copilot', url: 'https://copilot.microsoft.com/', logo: copilotLogo },
  { id: 'grok', title: 'Grok', url: 'https://grok.com/', logo: grokLogo },
  { id: 'mistral', title: 'Le Chat', url: 'https://chat.mistral.ai/chat', logo: mistralLogo },
  { id: 'poe', title: 'Poe', url: 'https://poe.com/', logo: poeLogo },
  { id: 'huggingface', title: 'Hugging Face', url: 'https://huggingface.co/chat/', logo: huggingfaceLogo },
  { id: 'notebooklm', title: 'NotebookLM', url: 'https://notebooklm.google.com/', logo: notebooklmLogo },
  { id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com/', logo: deepseekLogo },
  { id: 'metaai', title: 'Meta AI', url: 'https://www.meta.ai/', logo: metaaiLogo },
  { id: 'you', title: 'You.com', url: 'https://you.com/', logo: youLogo },
  { id: 't3chat', title: 'T3 Chat', url: 'https://t3.chat/', logo: t3chatLogo },
] as const

type BrowserBookmark = {
  id: string
  title: string
  url: string
  logo?: string
  source: 'repo' | 'preset' | 'custom'
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  // a bare domain (has a dot, no spaces) → https://; otherwise search it
  if (!s.includes(' ') && /\.[^\s.]{2,}$/.test(s)) return `https://${s}`
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`
}

function repoBookmarkFor(ctx: TabContext): BrowserBookmark | null {
  const host = ctx.repoHost?.trim()
  const path = ctx.repoPath?.trim().replace(/\.git$/i, '')
  if (!host || !path) return null
  return {
    id: `repo-${host}-${path}`,
    title: path.split('/').pop() || 'Repository',
    url: `https://${host}/${path}`,
    source: 'repo',
  }
}

function BrowserTab({ ctx }: { ctx: TabContext }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<Webview | null>(null)
  const repoBookmark = repoBookmarkFor(ctx)
  const homeUrl = repoBookmark?.url || HOME
  const autoHomeRef = useRef(homeUrl)
  const [addr, setAddr] = useState(homeUrl)
  const [pageTitle, setPageTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [browserName, setBrowserName] = useState('Brave Browser')
  const [customBookmarks, setCustomBookmarks] = useState<BrowserBookmark[]>(() =>
    loadJson<BrowserBookmark[]>(CUSTOM_KEY, []),
  )
  const [hiddenPresets, setHiddenPresets] = useState<string[]>(() =>
    loadJson<string[]>(HIDDEN_PRESETS_KEY, []),
  )
  const [adding, setAdding] = useState(false)
  const [kbMenuOpen, setKbMenuOpen] = useState(false)
  const [kbSaving, setKbSaving] = useState(false)
  const [kbToast, setKbToast] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [toolsExpanded, setToolsExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    window.gt.settings.get().then((s) => setBrowserName(s.apps?.browser || 'Brave Browser'))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, toolsExpanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [toolsExpanded])
  useEffect(() => {
    if (!kbMenuOpen) return
    const close = () => setKbMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [kbMenuOpen])
  useEffect(() => saveJson(CUSTOM_KEY, customBookmarks), [customBookmarks])
  useEffect(() => saveJson(HIDDEN_PRESETS_KEY, hiddenPresets), [hiddenPresets])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const wv = document.createElement('webview') as Webview
    wv.setAttribute('partition', 'persist:browser') // persist logins/cookies
    wv.setAttribute('allowpopups', 'false')
    wv.setAttribute('src', homeUrl)
    wv.style.width = '100%'
    wv.style.height = '100%'
    host.appendChild(wv)
    wvRef.current = wv

    const sync = () => {
      try {
        setCanBack(wv.canGoBack())
        setCanFwd(wv.canGoForward())
        const u = wv.getURL()
        if (u && !u.startsWith('about:')) setAddr(u)
        setPageTitle(wv.getTitle?.() || '')
      } catch {
        /* webview not ready */
      }
    }
    const onStart = () => setLoading(true)
    const onStop = () => {
      setLoading(false)
      sync()
    }
    const onNav = () => sync()
    const onTitle = (e: Event & { title?: string }) => setPageTitle(e.title || wv.getTitle?.() || '')
    // pop-ups / target=_blank → keep them in this webview instead of new windows
    const onNewWindow = (e: Event & { url?: string }) => {
      if (e.url) wv.loadURL(e.url).catch(() => {})
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onTitle as EventListener)
    wv.addEventListener('new-window', onNewWindow as EventListener)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onTitle as EventListener)
      wv.removeEventListener('new-window', onNewWindow as EventListener)
      wv.remove()
      wvRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (homeUrl === autoHomeRef.current) return
    const shouldFollow = !addr || addr === autoHomeRef.current || addr === HOME
    autoHomeRef.current = homeUrl
    if (!shouldFollow) return
    setAddr(homeUrl)
    wvRef.current?.loadURL(homeUrl).catch(() => {})
  }, [addr, homeUrl])

  const go = () => {
    const u = normalizeUrl(addr)
    if (!u) return
    setAddr(u)
    wvRef.current?.loadURL(u).catch(() => {})
  }
  const loadTool = (url: string) => {
    setAddr(url)
    wvRef.current?.loadURL(url).catch(() => {})
  }
  const presetBookmarks: BrowserBookmark[] = AI_TOOLS
    .filter((tool) => !hiddenPresets.includes(tool.id))
    .map((tool) => ({ ...tool, source: 'preset' as const }))
  const bookmarks = [...(repoBookmark ? [repoBookmark] : []), ...presetBookmarks, ...customBookmarks]
  const addBookmark = () => {
    const url = normalizeUrl(newUrl || addr)
    if (!url) return
    const title =
      newTitle.trim() ||
      (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, '')
        } catch {
          return 'Bookmark'
        }
      })()
    const bookmark: BrowserBookmark = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      url,
      source: 'custom',
    }
    setCustomBookmarks((prev) => [bookmark, ...prev])
    setNewTitle('')
    setNewUrl('')
    setAdding(false)
  }
  const deleteBookmark = (bookmark: BrowserBookmark) => {
    if (bookmark.source === 'repo') return
    if (bookmark.source === 'preset') {
      setHiddenPresets((prev) => (prev.includes(bookmark.id) ? prev : [...prev, bookmark.id]))
      return
    }
    setCustomBookmarks((prev) => prev.filter((b) => b.id !== bookmark.id))
  }
  const resetPresets = () => setHiddenPresets([])
  const flashKb = (message: string) => {
    setKbToast(message)
    window.setTimeout(() => setKbToast((cur) => (cur === message ? '' : cur)), 2200)
  }
  const saveCurrentPageToKb = async (scope: KnowledgeScope) => {
    const current = wvRef.current?.getURL() || addr
    const url = singleHttpUrl(current)
    if (!url) {
      flashKb('Current page is not a saveable http(s) URL')
      return
    }
    setKbMenuOpen(false)
    setKbSaving(true)
    try {
      const preview = await window.gt.knowledge.preview(url).catch(() => null)
      const kb = await window.gt.knowledge.read(scope)
      const host = new URL(url).hostname.replace(/^www\./, '')
      const title = preview?.ok && preview.title ? preview.title : pageTitle || host
      const next = appendKnowledgeItem(
        kb,
        {
          kind: 'link',
          title,
          description: preview?.ok ? preview.description || '' : '',
          content: '',
          url: preview?.ok ? preview.url : url,
          path: '',
          thumbnailUrl: preview?.ok ? preview.thumbnailUrl || '' : '',
          faviconUrl: preview?.ok ? preview.faviconUrl || '' : '',
          siteName: preview?.ok ? preview.siteName || host : host,
          tags: ['browser'],
        },
        { id: 'browser', title: 'Browser', description: 'Pages saved from TerMinal Browser.' },
      )
      const ok = await window.gt.knowledge.write(scope, next)
      flashKb(ok ? `Saved page to ${scope} KB` : `Could not save ${scope} KB`)
    } catch {
      flashKb(`Could not save ${scope} KB`)
    } finally {
      setKbSaving(false)
    }
  }
  const currentHost = (() => {
    try {
      return new URL(addr).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()

  const iconBtn =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent'
  const toolbarAction =
    'inline-flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--gt-border)] px-2 text-[11px] leading-none text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-white disabled:opacity-50'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1.5">
        <button onClick={() => wvRef.current?.goBack()} disabled={!canBack} className={iconBtn} title="Back">
          <ArrowLeft size={15} strokeWidth={2} />
        </button>
        <button onClick={() => wvRef.current?.goForward()} disabled={!canFwd} className={iconBtn} title="Forward">
          <ArrowRight size={15} strokeWidth={2} />
        </button>
        <button
          onClick={() => (loading ? wvRef.current?.stop() : wvRef.current?.reload())}
          className={iconBtn}
          title={loading ? 'Stop' : 'Reload'}
        >
          {loading ? <X size={14} strokeWidth={2} /> : <RotateCw size={14} strokeWidth={2} />}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go()
          }}
          className="flex flex-1 items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1 focus-within:border-[var(--gt-accent)]/60"
        >
          <Globe size={13} strokeWidth={2} className={`shrink-0 ${loading ? 'text-[var(--gt-accent-2)]' : 'text-zinc-600'}`} />
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Search or enter URL"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none"
          />
        </form>
        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setKbMenuOpen((v) => !v)}
            disabled={kbSaving}
            title="Save this page to Knowledge Base"
            className={toolbarAction}
          >
            <BookOpen size={12} strokeWidth={2} />
            <span>{kbSaving ? 'Saving' : 'Save KB'}</span>
            <ChevronDown size={11} strokeWidth={2} />
          </button>
          {kbMenuOpen && (
            <div className="absolute right-0 top-9 z-30 min-w-40 overflow-hidden rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] py-1 text-[11.5px] text-zinc-200 shadow-2xl">
              <button
                onClick={() => saveCurrentPageToKb('global')}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
              >
                <BookOpen size={12} strokeWidth={2} />
                Global KB
              </button>
              <button
                onClick={() => saveCurrentPageToKb('repo')}
                disabled={!ctx.repoRoot || !!ctx.remote}
                title={ctx.remote ? 'Repo Knowledge Base save is local-only for now.' : !ctx.repoRoot ? 'No repo selected.' : 'Save to this repo Knowledge Base'}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
              >
                <BookOpen size={12} strokeWidth={2} />
                Repo KB
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => window.gt.openInBrowser(addr)}
          title={`Open this page in ${browserName} (your wallet + extensions)`}
          className={toolbarAction}
        >
          <span className="text-[var(--gt-accent-2)]">◆</span>
          <span>Open in {browserName.replace(/ Browser$/, '')}</span>
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`flex shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/40 transition-[width] duration-150 ${
            toolsExpanded ? 'w-52' : 'w-12'
          }`}
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-2">
            <button
              onClick={() => setToolsExpanded((v) => !v)}
              title={toolsExpanded ? 'Collapse AI tools' : 'Expand AI tools'}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            >
              {toolsExpanded ? (
                <PanelLeftClose size={14} strokeWidth={2} />
              ) : (
                <PanelLeftOpen size={14} strokeWidth={2} />
              )}
            </button>
            {toolsExpanded && (
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-zinc-200">Bookmarks</div>
                <div className="text-[9.5px] text-zinc-600">{bookmarks.length} saved</div>
              </div>
            )}
            {toolsExpanded && (
              <button
                onClick={() => {
                  setAdding((v) => !v)
                  setNewUrl(addr)
                }}
                title="Add bookmark"
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <Plus size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {toolsExpanded && adding && (
              <div className="mb-2 space-y-1 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                />
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addBookmark()
                    if (e.key === 'Escape') setAdding(false)
                  }}
                  placeholder="URL or search"
                  className="w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                />
                <div className="flex items-center gap-1">
                  <button
                    onClick={addBookmark}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-[var(--gt-accent)] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                  >
                    <Plus size={11} strokeWidth={2.5} />
                    Save
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {toolsExpanded && hiddenPresets.length > 0 && (
              <button
                onClick={resetPresets}
                className="mb-2 w-full rounded-md border border-[var(--gt-border)] px-2 py-1 text-[10.5px] text-zinc-500 hover:border-[var(--gt-accent)]/60 hover:text-zinc-300"
              >
                Restore {hiddenPresets.length} preset{hiddenPresets.length === 1 ? '' : 's'}
              </button>
            )}
            {bookmarks.map((tool) => {
              const toolHost = new URL(tool.url).hostname.replace(/^www\./, '')
              const active = currentHost === toolHost || currentHost.endsWith(`.${toolHost}`)
              return (
                <button
                  key={tool.id}
                  onClick={() => loadTool(tool.url)}
                  title={tool.title}
                  className={`group mb-1 flex h-9 w-full items-center gap-2 rounded-md transition-colors ${
                    toolsExpanded ? 'px-2 text-left' : 'justify-center px-0'
                  } ${
                    active
                      ? 'bg-[var(--gt-accent)]/18 text-zinc-100'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                  }`}
                >
                  {tool.logo ? (
                    <img
                      src={tool.logo}
                      alt=""
                      draggable={false}
                      className="h-5 w-5 shrink-0 rounded-[5px] object-contain"
                    />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-[var(--gt-border)] bg-black/30 text-zinc-500">
                      <Globe size={12} strokeWidth={2} />
                    </span>
                  )}
                  {toolsExpanded && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{tool.title}</span>
                      {tool.source !== 'preset' && <span className="shrink-0 text-[9px] uppercase text-zinc-700">{tool.source}</span>}
                      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gt-accent-2)]" />}
                      {tool.source !== 'repo' && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteBookmark(tool)
                          }}
                          title={tool.source === 'preset' ? 'Hide preset' : 'Delete bookmark'}
                          className="hidden rounded p-1 text-zinc-600 hover:bg-white/10 hover:text-[var(--gt-red)] group-hover:inline-flex"
                        >
                          <Trash2 size={11} strokeWidth={2} />
                        </span>
                      )}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </aside>
        <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
      </div>
      {kbToast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)]/95 px-3 py-1.5 text-[11.5px] text-zinc-300 shadow-2xl backdrop-blur">
          {kbToast}
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'browser',
  title: 'Browser',
  icon: Globe,
  order: 3.7, // after the agent/schedule cluster
  appliesTo: () => true,
  Component: BrowserTab,
}
export default tab
