import { useEffect, useRef } from 'react'
import { GitMerge, RotateCw, ExternalLink } from 'lucide-react'
import type { Tab, TabContext } from '../../lib/types'

// The same imperative Electron <webview> surface the Browser tab drives — we
// don't reinvent a CI UX, we just embed the provider's own Actions/pipelines
// page. Created imperatively so we don't fight React/TS over the custom element.
type Webview = HTMLElement & {
  src: string
  reload(): void
  loadURL(url: string): Promise<void>
}

// Build the repo's CI page URL from the git remote: GitHub → Actions, GitLab →
// pipelines. Returns null for hosts we don't have a URL shape for.
function ciUrlFor(ctx: TabContext): string | null {
  const host = ctx.repoHost?.trim()
  const path = ctx.repoPath?.trim().replace(/\.git$/i, '')
  if (!host || !path) return null
  if (/gitlab/i.test(host)) return `https://${host}/${path}/-/pipelines`
  if (/github/i.test(host)) return `https://${host}/${path}/actions`
  return null
}

const iconBtn =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200'

function CiTab({ ctx }: { ctx: TabContext }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<Webview | null>(null)
  const url = ciUrlFor(ctx)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !url) return
    const wv = document.createElement('webview') as Webview
    wv.setAttribute('partition', 'persist:browser') // share the Browser tab's session (forge logins)
    wv.setAttribute('allowpopups', 'false')
    wv.setAttribute('src', url)
    wv.style.width = '100%'
    wv.style.height = '100%'
    // keep target=_blank / pop-ups in-pane instead of spawning OS windows
    const onNewWindow = (e: Event & { url?: string }) => {
      if (e.url) wv.loadURL(e.url).catch(() => {})
    }
    wv.addEventListener('new-window', onNewWindow as EventListener)
    host.appendChild(wv)
    wvRef.current = wv
    return () => {
      wv.removeEventListener('new-window', onNewWindow as EventListener)
      wv.remove()
      wvRef.current = null
    }
  }, [url])

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)] p-8 text-center text-[12px] text-zinc-500">
        CI opens the repository's Actions / pipelines page, but this repo's remote
        {ctx.repoHost ? ` (${ctx.repoHost})` : ''} isn't a GitHub or GitLab host.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5">
        <GitMerge size={13} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
        <span className="truncate font-mono text-[11px] text-zinc-500">{url}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => wvRef.current?.reload()} title="Reload" className={iconBtn}>
            <RotateCw size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => window.gt.openExternal(url)}
            title="Open in system browser"
            className={iconBtn}
          >
            <ExternalLink size={13} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
    </div>
  )
}

const tab: Tab = {
  id: 'ci',
  title: 'CI',
  icon: GitMerge,
  order: 3.55, // after Agents (3) → Runs (3.45) → Schedules (3.5) cluster
  appliesTo: (ctx) => !!ctx.repoRoot,
  Component: ({ ctx }) => <CiTab ctx={ctx} />,
}

export default tab
