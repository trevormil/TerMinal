import { GitBranch } from 'lucide-react'
import { Badge, Card, Empty } from '../../components/ui'
import type { GitStatus, Plugin } from '../../lib/types'

const plugin: Plugin<GitStatus> = {
  id: 'repo-branch',
  title: 'Repo Branch',
  icon: GitBranch,
  blurb: 'Current branch, dirty count, and upstream drift.',
  order: 20,
  intervalMs: 5000,
  defaultEnabled: false,
  poll: (gt) => gt.gitStatus(),
  render: (d) => {
    if (!d?.ok)
      return (
        <Card icon={GitBranch} title="Repo Branch">
          <Empty>Not a git repo</Empty>
        </Card>
      )
    const clean = d.dirty === 0
    return (
      <Card icon={GitBranch} title="Repo Branch" right={<Badge tone={clean ? 'green' : 'yellow'}>{clean ? 'clean' : `${d.dirty} dirty`}</Badge>}>
        <div className="truncate font-mono text-[13px] font-semibold text-zinc-200">{d.branch}</div>
        <div className="mt-1 flex gap-2 text-[11px] text-zinc-500">
          <span>up {d.ahead}</span>
          <span>down {d.behind}</span>
        </div>
      </Card>
    )
  },
}

export default plugin
