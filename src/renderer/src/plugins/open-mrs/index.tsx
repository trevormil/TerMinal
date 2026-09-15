import { GitPullRequest } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Empty } from '../../components/ui/display'
import { navigateTo } from '../../lib/nav'
import type { Plugin, MrListResult } from '../../lib/types'
import { openMrsView } from './model'

const plugin: Plugin<MrListResult> = {
  id: 'open-mrs',
  title: 'Open PRs / MRs',
  icon: GitPullRequest,
  blurb:
    'Open PR/MR count from the latest 100 forge items; click to browse. Optional, off by default.',
  order: 7.1,
  intervalMs: 60_000,
  defaultEnabled: false,
  poll: async (gt) => {
    try {
      const ctx = await gt.tabContext()
      if (!ctx.repoRoot) return { mrs: [], error: 'Not a git repo' }
      if (!ctx.repoHost || !['github', 'gitlab'].includes(ctx.forgeKind))
        return { mrs: [], error: 'No supported forge remote. Connect a GitHub or GitLab remote.' }
      return await gt.listMrs()
    } catch {
      return {
        mrs: [],
        error: 'Could not load PRs / MRs. Check forge connection and authentication.',
      }
    }
  },
  render: (data) => {
    const view = data ? openMrsView(data) : null
    if (!view || 'error' in view)
      return (
        <TitledCard icon={GitPullRequest} title="Open PRs / MRs">
          <Empty>{view && 'error' in view ? view.error : 'Loading PRs / MRs…'}</Empty>
        </TitledCard>
      )
    return (
      <button
        type="button"
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
        title="Open the PRs / MRs tab"
        onClick={() => {
          navigateTo('mrs')
          setTimeout(() => navigateTo('mrs'), 50)
        }}
      >
        <TitledCard icon={GitPullRequest} title="Open PRs / MRs">
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {view.limited ? 'At least ' : ''}
            {view.count} open
          </div>
          {view.limited ? (
            <Empty>Among the latest 100 PRs / MRs</Empty>
          ) : view.count === 0 ? (
            <Empty>No open PRs / MRs</Empty>
          ) : null}
        </TitledCard>
      </button>
    )
  },
}
export default plugin
