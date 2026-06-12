import { useEffect, useRef, useState } from 'react'
import { ExternalLink, MonitorDot, Play, RefreshCw, Server, Square } from 'lucide-react'
import type { AgentViewUpstreamStatus, Tab } from '../../lib/types'

type Webview = HTMLElement & {
  src: string
  reload(): void
  loadURL(url: string): Promise<void>
}

function AgentViewTab() {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<Webview | null>(null)
  const [status, setStatus] = useState<AgentViewUpstreamStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingPage, setLoadingPage] = useState(false)

  const refresh = async () => {
    const next = await window.gt.agentview.upstreamStatus()
    setStatus(next)
    return next
  }

  useEffect(() => {
    refresh().catch(() => {})
    const id = window.setInterval(() => refresh().catch(() => {}), 2500)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !status?.running || wvRef.current) return
    const wv = document.createElement('webview') as Webview
    wv.setAttribute('partition', 'persist:agentview-upstream')
    wv.setAttribute('allowpopups', 'false')
    wv.setAttribute('src', status.url)
    wv.style.width = '100%'
    wv.style.height = '100%'
    const start = () => setLoadingPage(true)
    const stop = () => setLoadingPage(false)
    wv.addEventListener('did-start-loading', start)
    wv.addEventListener('did-stop-loading', stop)
    host.appendChild(wv)
    wvRef.current = wv
    return () => {
      wv.removeEventListener('did-start-loading', start)
      wv.removeEventListener('did-stop-loading', stop)
      wv.remove()
      wvRef.current = null
    }
  }, [status?.running, status?.url])

  const start = async () => {
    setBusy(true)
    try {
      setStatus(await window.gt.agentview.upstreamStart())
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      setStatus(await window.gt.agentview.upstreamStop())
    } finally {
      setBusy(false)
    }
  }

  const iconBtn =
    'inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[11px] font-semibold text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100 disabled:opacity-50'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
        <MonitorDot size={15} strokeWidth={2.25} className="text-[var(--gt-accent-light)]" />
        <span className="text-[12px] font-semibold text-zinc-100">AgentView</span>
        <span className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          upstream
        </span>
        {status && (
          <span className={`text-[11px] ${status.running ? 'text-[var(--gt-green)]' : 'text-[var(--gt-yellow)]'}`}>
            {status.running ? 'live' : status.starting || busy ? 'starting' : 'offline'}
          </span>
        )}
        <span className="min-w-0 truncate text-[10.5px] text-zinc-600">{status?.repoRoot || 'checking checkout...'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={refresh} disabled={busy} className={iconBtn}>
            <RefreshCw size={12} strokeWidth={2.2} className={busy || loadingPage ? 'animate-spin' : ''} />
            Refresh
          </button>
          {status?.running ? (
            <>
              <button onClick={() => wvRef.current?.reload()} className={iconBtn}>Reload View</button>
              <button onClick={() => window.gt.openExternal(status.url)} className={iconBtn}>
                <ExternalLink size={12} strokeWidth={2.2} />
                Open
              </button>
              <button onClick={stop} disabled={busy} className={iconBtn}>
                <Square size={11} strokeWidth={2.2} />
                Stop
              </button>
            </>
          ) : (
            <button onClick={start} disabled={busy || status?.starting || !status?.repoRoot} className={iconBtn}>
              <Play size={12} strokeWidth={2.2} className={busy ? 'animate-pulse' : ''} />
              Start Server
            </button>
          )}
        </div>
      </div>

      {status?.running ? (
        <div ref={hostRef} className="min-h-0 flex-1" />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5">
            <div className="mb-3 flex items-center gap-2">
              <Server size={16} strokeWidth={2.2} className="text-zinc-500" />
              <h2 className="text-[14px] font-semibold text-zinc-100">Start upstream AgentView</h2>
            </div>
            <p className="mb-4 text-[12px] leading-5 text-zinc-500">
              This starts the real upstream AgentView API on <span className="font-mono text-zinc-400">{status?.apiUrl || '127.0.0.1:4317'}</span> and renderer on{' '}
              <span className="font-mono text-zinc-400">{status?.url || '127.0.0.1:5173'}</span>, then embeds it in this tab.
            </p>
            {status?.error && <div className="mb-3 rounded-md border border-[var(--gt-red)]/30 bg-[var(--gt-red)]/10 p-2 text-[11.5px] text-[var(--gt-red)]">{status.error}</div>}
            <button onClick={start} disabled={busy || status?.starting || !status?.repoRoot} className="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white disabled:opacity-50">
              <Play size={13} strokeWidth={2.2} className={busy ? 'animate-pulse' : ''} />
              {busy || status?.starting ? 'Starting...' : 'Start Server'}
            </button>
            {status?.log && (
              <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--gt-border)] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-500">
                {status.log}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'agentview',
  title: 'AgentView',
  icon: MonitorDot,
  order: 7.1,
  appliesTo: () => true,
  Component: AgentViewTab,
}

export default tab
