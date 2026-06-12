import { GitBranch } from 'lucide-react'
import { Card, Row, Badge, Empty } from '../../components/ui'
import type { Plugin, GitStatus } from '../../lib/types'

const plugin: Plugin<GitStatus> = {
  id: 'git',
  title: 'Git',
  icon: GitBranch,
  blurb: "The repo's branch, ahead/behind upstream, and uncommitted file count.",
  order: 7,
  intervalMs: 4000,
  realtime: true,
  defaultEnabled: true,
  poll: (gt) => gt.gitStatus(),
  render: (d) => {
    if (!d?.ok)
      return (
        <Card icon={GitBranch} title="Git">
          <Empty>Not a git repo</Empty>
        </Card>
      )
    return (
      <Card
        icon={GitBranch}
        title="Git"
        right={
          d.dirty > 0 ? (
            <Badge tone="yellow">{d.dirty} dirty</Badge>
          ) : (
            <Badge tone="green">clean</Badge>
          )
        }
      >
        <div className="mb-1 truncate text-[13px] font-semibold text-zinc-100">{d.branch}</div>
        <Row
          label="vs upstream"
          value={
            d.upstream ? (
              <span className="tabular-nums">
                <span className="text-[var(--gt-green)]">↑{d.ahead}</span>{' '}
                <span className="text-[var(--gt-red)]">↓{d.behind}</span>
              </span>
            ) : (
              <span className="text-zinc-600">none</span>
            )
          }
        />
      </Card>
    )
  },
}
export default plugin
