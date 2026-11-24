import { CircleDot } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Empty } from '../../components/ui/display'
import { navigateTo } from '../../lib/nav'
import type { Plugin, CiListResult } from '../../lib/types'
import { latestCiRun } from './model'

const plugin: Plugin<CiListResult> = {
  id: 'ci-status',
  title: 'CI / pipeline status',
  icon: CircleDot,
  blurb: 'Latest repo workflow or pipeline run. Optional, off by default.',
  order: 7.2,
  intervalMs: 60_000,
  defaultEnabled: false,
  poll: async (gt) => {
    try {
      const ctx = await gt.tabContext()
      if (!ctx.repoRoot) return { runs: [], error: 'Not a git repo' }
      if (!ctx.repoHost || !['github', 'gitlab'].includes(ctx.forgeKind))
        return { runs: [], error: 'No supported forge remote. Connect a GitHub or GitLab remote.' }
      return await gt.ci.list(ctx.repoRoot, 20)
    } catch {
      return { runs: [], error: 'Could not load CI. Check forge connection and authentication.' }
    }
  },
  render: (data) => {
    const run = data && !data.error ? latestCiRun(data.runs) : null
    if (!run)
      return (
        <TitledCard icon={CircleDot} title="CI / pipeline status">
          <Empty>
            {!data
              ? 'Loading CI…'
              : data.error || 'No workflow or pipeline runs found for this repo.'}
          </Empty>
        </TitledCard>
      )
    return (
      <button
        type="button"
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
        title="Open latest CI run"
        onClick={() => {
          if (/^https?:\/\//i.test(run.webUrl)) void window.gt.openExternal(run.webUrl)
          else {
            navigateTo('ci')
            setTimeout(() => navigateTo('ci'), 50)
          }
        }}
      >
        <TitledCard icon={CircleDot} title="CI / pipeline status">
          <div
            className={`text-sm font-semibold ${run.status === 'failed' ? 'text-destructive' : run.status === 'success' ? 'text-[var(--gt-green)]' : 'text-foreground'}`}
          >
            {run.status.replaceAll('_', ' ')}
          </div>
          <Empty>
            Latest run · {run.name || 'Pipeline'} · {run.branch} · {run.shortSha}
          </Empty>
        </TitledCard>
      </button>
    )
  },
}
export default plugin
