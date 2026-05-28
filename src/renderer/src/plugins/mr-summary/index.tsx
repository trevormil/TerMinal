import { GitPullRequest } from 'lucide-react'
import { Card, Big, Row, Badge, Empty } from '../../components/ui'
import type { Plugin, MrSummary } from '../../lib/types'

const plugin: Plugin<MrSummary> = {
  id: 'mr-summary',
  title: 'Open MRs',
  icon: GitPullRequest,
  blurb: "Open MR count for the repo + review breakdown (glab, cached 60s).",
  order: 8,
  intervalMs: 60_000,
  defaultEnabled: false,
  poll: (gt) => gt.mrSummary(),
  render: (d) => {
    if (!d) return null
    if (d.open === 0)
      return (
        <Card icon={GitPullRequest} title="Open MRs">
          <Empty>No open MRs</Empty>
        </Card>
      )
    return (
      <Card icon={GitPullRequest} title="Open MRs">
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
