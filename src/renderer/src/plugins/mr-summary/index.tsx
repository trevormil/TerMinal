import { GitPullRequest } from 'lucide-react'
import { Card, Big, Row, Badge, Empty } from '../../components/ui'
import type { Plugin, MrSummary } from '../../lib/types'

const plugin: Plugin<MrSummary> = {
  id: 'mr-summary',
  title: 'Open PRs / MRs',
  icon: GitPullRequest,
  blurb: 'Open PR/MR count for the repo + review breakdown (gh/glab, cached 60s).',
  order: 8,
  intervalMs: 60_000,
  defaultEnabled: false,
  poll: (gt) => gt.mrSummary(),
  render: (d) => {
    if (!d) return null
    const title = `Open ${d.label}s`
    if (!d.ok)
      return (
        <Card icon={GitPullRequest} title={title}>
          <Empty>{d.error || `${d.label} summary unavailable`}</Empty>
        </Card>
      )
    if (d.open === 0)
      return (
        <Card icon={GitPullRequest} title={title}>
          <Empty>No open {d.label}s</Empty>
        </Card>
      )
    return (
      <Card icon={GitPullRequest} title={title}>
        <div className="mb-2">
          <Big value={d.open} sub="open" />
        </div>
        <Row label="approved" value={<Badge tone="green">{d.approve}</Badge>} />
        <Row label="changes" value={<Badge tone="red">{d.changes}</Badge>} />
        <Row label="needs review" value={<Badge tone="yellow">{d.needsReview}</Badge>} />
      </Card>
    )
  },
}
export default plugin
