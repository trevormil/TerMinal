import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  X,
  ChevronUp,
  ChevronDown,
  Copy,
  Link as LinkIcon,
  ExternalLink,
  Code2,
} from 'lucide-react'

// The Electron <webview> surface we drive imperatively (created below) so we
// don't fight React/TS over the custom element. Shared by the Browser and CI
// tabs — both embed a real navigable page, only their surrounding chrome
// differs.
export type Webview = HTMLElement & {
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
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  openDevTools(): void
}

type FoundInPageEvent = Event & { result?: { activeMatchOrdinal: number; matches: number } }
// Keyboard/mouse events that happen INSIDE the guest page never bubble to the
// host window — the <webview> is effectively a separate renderer process, not
// an iframe. Electron surfaces them as these two DOM events on the <webview>
// element itself instead.
type BeforeInputEvent = Event & {
  input: { type: string; key: string; meta: boolean; control: boolean; shift: boolean }
}
export type ContextMenuParams = {
  x: number
  y: number
  linkURL?: string
  selectionText?: string
  editFlags?: { canCopy?: boolean }
}
type WebviewContextMenuEvent = Event & { params: ContextMenuParams }

// Turn arbitrary address-bar input into a URL: pass through http(s), promote a
// bare domain to https, otherwise Google-search it.
export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (!s.includes(' ') && /\.[^\s.]{2,}$/.test(s)) return `https://${s}`
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`
}

export type WebSurface = {
  hostRef: React.RefObject<HTMLDivElement | null>
  wvRef: React.MutableRefObject<Webview | null>
  addr: string
  setAddr: (v: string) => void
  pageTitle: string
  loading: boolean
  canBack: boolean
  canFwd: boolean
  go: () => void
  back: () => void
  forward: () => void
  reloadOrStop: () => void
  loadUrl: (url: string) => void
  addrInputRef: React.RefObject<HTMLInputElement | null>
  focusAddr: () => void
  findOpen: boolean
  findQuery: string
  setFindQuery: (v: string) => void
  findMatch: { active: number; total: number } | null
  openFind: () => void
  closeFind: () => void
  findNext: () => void
  findPrev: () => void
  contextMenu: { x: number; y: number; params: ContextMenuParams } | null
  closeContextMenu: () => void
}

// Owns the imperative <webview> lifecycle + navigation state (back/forward,
// loading, address, title). Mount `hostRef` on a sized container and render a
// toolbar off the returned state. Created once on mount; navigate via loadUrl.
export function useWebSurface(opts: { initialUrl: string; partition: string }): WebSurface {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<Webview | null>(null)
  const [addr, setAddr] = useState(opts.initialUrl)
  const [pageTitle, setPageTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const addrInputRef = useRef<HTMLInputElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findMatch, setFindMatch] = useState<{ active: number; total: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    params: ContextMenuParams
  } | null>(null)
  // openFind/focusAddr are assigned fresh each render but never change
  // behavior (they only call stable setters/refs), so the effect below can
  // safely close over whichever render's copy was current when it mounted —
  // same reasoning as the other webview listeners in this effect.
  const openFindRef = useRef<() => void>(() => {})
  const focusAddrRef = useRef<() => void>(() => {})

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const wv = document.createElement('webview') as Webview
    wv.setAttribute('partition', opts.partition) // persist logins/cookies
    // Do NOT set allowpopups: it's a presence-keyed boolean attribute, so even
    // 'false' ENABLES popups. Omitting it keeps the secure default (popups
    // denied). Popups are instead contained in-frame by the main-process
    // did-attach-webview handler (src/main/index.ts).
    wv.setAttribute('src', opts.initialUrl)
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
    const onTitle = (e: Event & { title?: string }) =>
      setPageTitle(e.title || wv.getTitle?.() || '')
    const onFound = (e: Event) => {
      const r = (e as FoundInPageEvent).result
      if (r) setFindMatch({ active: r.activeMatchOrdinal, total: r.matches })
    }
    // Keyboard shortcuts pressed while focus is INSIDE the page (the common
    // case once you're actually browsing) never reach a host `window`
    // keydown listener — before-input-event is Electron's hook for
    // intercepting them before the guest page sees them.
    const onBeforeInput = (e: Event) => {
      const input = (e as BeforeInputEvent).input
      if (input.type !== 'keyDown') return
      const mod = input.meta || input.control
      const key = input.key.toLowerCase()
      if (mod && key === 'f') {
        e.preventDefault()
        openFindRef.current()
      } else if (mod && key === 'l') {
        e.preventDefault()
        focusAddrRef.current()
      }
    }
    // Same story for right-click: the guest page's own context menu never
    // reaches a host onContextMenu handler, so build ours from this event.
    // params.x/y are relative to the webview's own content area, not the
    // window — offset by the webview's on-screen position (it's `fixed`-
    // positioned in the DOM, so window coordinates are what we need).
    const onContextMenu = (e: Event) => {
      const params = (e as WebviewContextMenuEvent).params
      const rect = wv.getBoundingClientRect()
      setContextMenu({ x: rect.left + params.x, y: rect.top + params.y, params })
    }
    // pop-ups / target=_blank containment lives in the main process
    // (did-attach-webview → guest.setWindowOpenHandler): the DOM <webview> emits
    // no 'new-window' event on Electron 41, so a renderer listener never fired.
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onTitle as EventListener)
    wv.addEventListener('found-in-page', onFound)
    wv.addEventListener('before-input-event', onBeforeInput)
    wv.addEventListener('context-menu', onContextMenu)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onTitle as EventListener)
      wv.removeEventListener('found-in-page', onFound)
      wv.removeEventListener('before-input-event', onBeforeInput)
      wv.removeEventListener('context-menu', onContextMenu)
      wv.remove()
      wvRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Search-as-you-type, mirroring a normal browser's find bar.
  useEffect(() => {
    if (!findOpen) return
    if (!findQuery) {
      wvRef.current?.stopFindInPage('clearSelection')
      setFindMatch(null)
      return
    }
    wvRef.current?.findInPage(findQuery)
  }, [findQuery, findOpen])

  const loadUrl = (url: string) => {
    setAddr(url)
    wvRef.current?.loadURL(url).catch(() => {})
  }
  const go = () => {
    const u = normalizeUrl(addr)
    if (!u) return
    loadUrl(u)
  }
  const back = () => wvRef.current?.goBack()
  const forward = () => wvRef.current?.goForward()
  const reloadOrStop = () => (loading ? wvRef.current?.stop() : wvRef.current?.reload())
  const focusAddr = () => {
    addrInputRef.current?.focus()
    addrInputRef.current?.select()
  }
  const openFind = () => setFindOpen(true)
  // Keep the refs current every render — the mount-only webview effect above
  // calls through them so before-input-event always reaches the latest
  // versions instead of whatever closure existed at mount time.
  openFindRef.current = openFind
  focusAddrRef.current = focusAddr
  const closeContextMenu = () => setContextMenu(null)
  const closeFind = () => {
    setFindOpen(false)
    setFindMatch(null)
    wvRef.current?.stopFindInPage('clearSelection')
  }
  const runFind = (forward: boolean) => {
    if (!findQuery) return
    wvRef.current?.findInPage(findQuery, { forward, findNext: true })
  }
  const findNext = () => runFind(true)
  const findPrev = () => runFind(false)

  return {
    hostRef,
    wvRef,
    addr,
    setAddr,
    pageTitle,
    loading,
    canBack,
    canFwd,
    go,
    back,
    forward,
    reloadOrStop,
    loadUrl,
    addrInputRef,
    focusAddr,
    findOpen,
    findQuery,
    setFindQuery,
    findMatch,
    openFind,
    closeFind,
    findNext,
    findPrev,
    contextMenu,
    closeContextMenu,
  }
}

const iconBtn =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent'

// The shared navigation row: back / forward / reload-stop / editable address.
// `leftAccessory` / `rightAccessory` host per-tab chrome (branding on the left,
// Save-KB / open-external actions on the right).
export function BrowserToolbar({
  surface,
  leftAccessory,
  rightAccessory,
}: {
  surface: WebSurface
  leftAccessory?: ReactNode
  rightAccessory?: ReactNode
}) {
  const { addr, setAddr, loading, canBack, canFwd, go, back, forward, reloadOrStop, addrInputRef } =
    surface
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1.5">
      {leftAccessory}
      <button onClick={back} disabled={!canBack} className={iconBtn} title="Back">
        <ArrowLeft size={15} strokeWidth={2} />
      </button>
      <button onClick={forward} disabled={!canFwd} className={iconBtn} title="Forward">
        <ArrowRight size={15} strokeWidth={2} />
      </button>
      <button onClick={reloadOrStop} className={iconBtn} title={loading ? 'Stop' : 'Reload'}>
        {loading ? <X size={14} strokeWidth={2} /> : <RotateCw size={14} strokeWidth={2} />}
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
        className="flex flex-1 items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1 focus-within:border-[var(--gt-accent)]/60"
      >
        <Globe
          size={13}
          strokeWidth={2}
          className={`shrink-0 ${loading ? 'text-[var(--gt-accent-2)]' : 'text-zinc-600'}`}
        />
        <input
          ref={addrInputRef}
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder="Search or enter URL"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none"
        />
      </form>
      {rightAccessory}
    </div>
  )
}

// Cmd+F find-in-page bar — floats over the page like a normal browser's.
export function FindBar({ surface }: { surface: WebSurface }) {
  const { findQuery, setFindQuery, findMatch, closeFind, findNext, findPrev } = surface
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-1.5 shadow-lg">
      <input
        ref={inputRef}
        value={findQuery}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.shiftKey ? findPrev() : findNext()
          if (e.key === 'Escape') closeFind()
        }}
        placeholder="Find in page"
        spellCheck={false}
        className="w-40 bg-transparent text-[12px] text-zinc-200 outline-none"
      />
      {findMatch && (
        <span className="shrink-0 text-[10.5px] tabular-nums text-zinc-500">
          {findMatch.total ? `${findMatch.active}/${findMatch.total}` : '0/0'}
        </span>
      )}
      <button onClick={findPrev} className={iconBtn} title="Previous match (Shift+Enter)">
        <ChevronUp size={13} strokeWidth={2} />
      </button>
      <button onClick={findNext} className={iconBtn} title="Next match (Enter)">
        <ChevronDown size={13} strokeWidth={2} />
      </button>
      <button onClick={closeFind} className={iconBtn} title="Close (Esc)">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

const menuItem =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent'

// Right-click menu for the embedded page — the guest's own native context menu
// never surfaces (see the `context-menu` webview event above), so this is the
// only one a user gets: Back/Forward/Reload, copy selection/link, open
// externally, and a devtools escape hatch for anything that looks broken.
export function WebviewContextMenu({ surface }: { surface: WebSurface }) {
  const { contextMenu, closeContextMenu, back, canBack, forward, canFwd, reloadOrStop, wvRef } =
    surface
  useEffect(() => {
    if (!contextMenu) return
    const close = () => closeContextMenu()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu, closeContextMenu])
  if (!contextMenu) return null
  const { params } = contextMenu
  return (
    <div
      className="fixed z-[70] min-w-44 overflow-hidden rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] py-1 text-[12px] text-zinc-200 shadow-2xl"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        disabled={!canBack}
        onClick={() => {
          back()
          closeContextMenu()
        }}
        className={menuItem}
      >
        <ArrowLeft size={13} strokeWidth={2} />
        Back
      </button>
      <button
        disabled={!canFwd}
        onClick={() => {
          forward()
          closeContextMenu()
        }}
        className={menuItem}
      >
        <ArrowRight size={13} strokeWidth={2} />
        Forward
      </button>
      <button
        onClick={() => {
          reloadOrStop()
          closeContextMenu()
        }}
        className={menuItem}
      >
        <RotateCw size={13} strokeWidth={2} />
        Reload
      </button>
      {params.selectionText && (
        <button
          onClick={() => {
            window.gt.clipboardWrite(params.selectionText || '')
            closeContextMenu()
          }}
          className={menuItem}
        >
          <Copy size={13} strokeWidth={2} />
          Copy
        </button>
      )}
      {params.linkURL && (
        <button
          onClick={() => {
            window.gt.clipboardWrite(params.linkURL || '')
            closeContextMenu()
          }}
          className={menuItem}
        >
          <LinkIcon size={13} strokeWidth={2} />
          Copy link
        </button>
      )}
      <button
        onClick={() => {
          window.gt.openExternal(params.linkURL || wvRef.current?.getURL() || '')
          closeContextMenu()
        }}
        className={menuItem}
      >
        <ExternalLink size={13} strokeWidth={2} />
        Open {params.linkURL ? 'link' : 'page'} in system browser
      </button>
      <button
        onClick={() => {
          wvRef.current?.openDevTools()
          closeContextMenu()
        }}
        className={menuItem}
      >
        <Code2 size={13} strokeWidth={2} />
        Inspect element
      </button>
    </div>
  )
}
