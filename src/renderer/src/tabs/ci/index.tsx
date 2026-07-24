import { useState } from 'react'
import { GitMerge, ExternalLink, Globe, ListTree } from 'lucide-react'
import type { Tab, TabContext } from '../../lib/types'
import { useWebSurface, BrowserToolbar } from '../browser/webSurface'
import { RunsView } from './runsView'

// CI tab — two views over the same repo:
//   • Webview (default): a full navigable <webview> seeded to the forge's
//     Actions/pipelines page (unchanged from the original tab).
//   • Runs: a native, structured view of runs → jobs → formatted logs backed
//     by window.gt.ci (list/jobs/log), all keyed on ctx.repoRoot.
// The choice persists in localStorage so it survives repo/tab switches.

type CiView = 'webview' | 'runs'
const VIEW_KEY = 'gt.ciView'

function loadView(): CiView {
  return localStorage.getItem(VIEW_KEY) === 'runs' ? 'runs' : 'webview'
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

const actionBtn =
  'inline-flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--gt-border)] px-2 text-[11px] leading-none text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-white'

// A segmented Webview | Runs toggle shared by both views.
function ViewToggle({ view, onChange }: { view: CiView; onChange: (v: CiView) => void }) {
  const seg = (v: CiView, Icon: typeof Globe, label: string) => (
    <button
      onClick={() => onChange(v)}
      className={`inline-flex h-[26px] items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
        view === v
          ? 'bg-[var(--gt-accent)]/25 text-[var(--gt-accent-light)]'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <Icon size={12} strokeWidth={2.25} />
      {label}
    </button>
  )
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--gt-border)] bg-black/20 p-0.5">
      {seg('webview', Globe, 'Webview')}
      {seg('runs', ListTree, 'Runs')}
    </div>
  )
}

// Full-browser CI: same navigable <webview> surface + toolbar as the Browser
// tab, seeded to the provider's Actions/pipelines page and sharing its
// `persist:browser` session so forge logins carry over. Keyed by URL upstream.
function WebviewView({
  url,
  view,
  onView,
}: {
  url: string
  view: CiView
  onView: (v: CiView) => void
}) {
  const surface = useWebSurface({ initialUrl: url, partition: 'persist:browser' })
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <BrowserToolbar
        surface={surface}
        leftAccessory={
          <div className="ml-1 mr-1 flex shrink-0 items-center gap-2">
            <GitMerge size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
            <ViewToggle view={view} onChange={onView} />
          </div>
        }
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

function CiTab({ ctx }: { ctx: TabContext }) {
  const [view, setView] = useState<CiView>(loadView)
  const url = ciUrlFor(ctx)

  const onView = (v: CiView) => {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  // Native Runs view: a slim header carries the toggle (the webview view hosts
  // its toggle inside the BrowserToolbar instead).
  if (view === 'runs' || !url) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-2 py-1.5">
          <GitMerge size={14} strokeWidth={2} className="ml-1 text-[var(--gt-accent-light)]" />
          <ViewToggle view={view === 'runs' || !url ? 'runs' : 'webview'} onChange={onView} />
          {!url && view === 'webview' && (
            <span className="text-[10.5px] text-zinc-600">
              No webview URL for this remote — showing native runs.
            </span>
          )}
          <div className="flex-1" />
        </div>
        <div className="min-h-0 flex-1">
          <RunsView ctx={ctx} />
        </div>
      </div>
    )
  }

  return <WebviewView key={url} url={url} view={view} onView={onView} />
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
