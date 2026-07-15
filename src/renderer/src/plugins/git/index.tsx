import { GitBranch } from 'lucide-react'
import { Card, Row, Badge, Empty } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
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
    // Clicking the card jumps to the Files tab's Changes view — the fastest path
    // from "there's a diff" to reviewing it.
    return (
      <button
        type="button"
        onClick={() => {
          navigateTo('files', { sidebar: 'changes' })
          // The Files tab's onNavigate listener only mounts after the active
          // tab changes; replay once so it receives the sidebar payload.
          setTimeout(() => navigateTo('files', { sidebar: 'changes' }), 50)
        }}
        title="Open Changes in the Files tab"
        className="block w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)] rounded-lg"
      >
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
      </button>
    )
  },
}
export default plugin
