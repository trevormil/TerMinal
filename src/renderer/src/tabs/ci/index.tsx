import { GitMerge, ExternalLink } from 'lucide-react'
import type { Tab, TabContext } from '../../lib/types'
import { useWebSurface, BrowserToolbar } from '../browser/webSurface'

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

// Full-browser CI: same navigable <webview> surface + toolbar (back/forward/
// reload/address) as the Browser tab, seeded to the provider's Actions/
// pipelines page and sharing its `persist:browser` session so forge logins
// carry over. Keyed by URL upstream, so a repo switch remounts cleanly.
function CiTab({ url }: { url: string }) {
  const surface = useWebSurface({ initialUrl: url, partition: 'persist:browser' })
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <BrowserToolbar
        surface={surface}
        leftAccessory={
          <GitMerge
            size={14}
            strokeWidth={2}
            className="ml-1 mr-0.5 shrink-0 text-[var(--gt-accent-light)]"
          />
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

const tab: Tab = {
  id: 'ci',
  title: 'CI',
  icon: GitMerge,
  order: 3.55, // after Agents (3) → Runs (3.45) → Schedules (3.5) cluster
  appliesTo: (ctx) => !!ctx.repoRoot,
  Component: ({ ctx }) => {
    const url = ciUrlFor(ctx)
    if (!url) {
      return (
        <div className="flex h-full items-center justify-center bg-[var(--gt-bg)] p-8 text-center text-[12px] text-zinc-500">
          CI opens the repository's Actions / pipelines page, but this repo's remote
          {ctx.repoHost ? ` (${ctx.repoHost})` : ''} isn't a GitHub or GitLab host.
        </div>
      )
    }
    return <CiTab key={url} url={url} />
  },
}

export default tab
