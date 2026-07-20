import { useEffect, useState } from 'react'
import { Ticket as TicketIcon, ExternalLink } from 'lucide-react'
import { TicketsBrowser } from '../../components/TicketsBrowser'
import { useWebSurface, BrowserToolbar } from '../browser/webSurface'
import type { Tab, TabContext, TicketView } from '../../lib/types'

// The Tickets tab has one source per configured surface: the repo's real backlog
// (whatever `provider` says) plus any read-only web views from
// `.TerMinal/tickets.json`. A view embeds the platform's own UI rather than
// reimplementing it — Linear's board is already good, and a team board whose
// tickets don't match our frontmatter spec stays fully usable without pretending
// to be a provider. Views never write; writes go through the platform's own MCP.

const actionBtn =
  'inline-flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--gt-border)] px-2 text-[11px] leading-none text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-white'

// Same navigable <webview> surface + toolbar as the Browser and CI tabs, and the
// same `persist:browser` session — so a Linear/Jira login carries over instead of
// being asked for on every mount.
function TicketWebView({ url }: { url: string }) {
  const surface = useWebSurface({ initialUrl: url, partition: 'persist:browser' })
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <BrowserToolbar
        surface={surface}
        rightAccessory={
          <button
            onClick={() => window.gt.openExternal(surface.addr)}
            title="Open this page in the system browser"
            className={actionBtn}
          >
            <ExternalLink size={13} strokeWidth={2} />
            <span>Open</span>
          </button>
        }
      />
      <div ref={surface.hostRef} className="min-h-0 min-w-0 flex-1" />
    </div>
  )
}

function TicketsTab({ ctx }: { ctx: TabContext }) {
  const [views, setViews] = useState<TicketView[]>([])
  // 0 = the real backlog; 1..n = configured views.
  const [active, setActive] = useState(0)

  useEffect(() => {
    let live = true
    setActive(0)
    void window.gt.tickets
      .providerGet()
      .then((cfg) => {
        if (!live) return
        const vs = 'error' in cfg ? [] : cfg.views || []
        setViews(vs)
        // A view flagged `default` opens first; index+1 since 0 is the backlog.
        const di = vs.findIndex((v) => v.default)
        if (di >= 0) setActive(di + 1)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [ctx.repoRoot])

  const view = active > 0 ? views[active - 1] : null
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      {views.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-3 py-1.5 text-[11px]">
          {[{ label: 'Backlog', url: '' }, ...views].map((v, i) => (
            <button
              key={`${v.label}:${i}`}
              onClick={() => setActive(i)}
              className={`rounded px-1.5 py-0.5 ${
                i === active
                  ? 'bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)]'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      {view ? (
        // Keyed by url so switching views (or repos) remounts a clean surface.
        <TicketWebView key={view.url} url={view.url} />
      ) : (
        <TicketsBrowser ctx={ctx} />
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'tickets',
  title: 'Tickets',
  icon: TicketIcon,
  order: 1,
  appliesTo: (ctx) => ctx.hasBacklog || !!ctx.repoPath,
  Component: TicketsTab,
}
export default tab
