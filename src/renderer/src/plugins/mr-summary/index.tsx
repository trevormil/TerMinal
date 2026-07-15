import { GitPullRequest } from 'lucide-react'
import { Card, Big, Row, Badge, Empty } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
import type { Plugin, MrSummary } from '../../lib/types'

// Deep-link into the MRs tab. The receiver's onNavigate listener only mounts
// after the active tab switches, so replay once (mirrors the git widget).
const openMrs = (payload?: Record<string, unknown>) => {
  navigateTo('mrs', payload)
  setTimeout(() => navigateTo('mrs', payload), 50)
}

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
      <button
        type="button"
        onClick={() => openMrs()}
        title="Open the MRs tab"
        className="block w-full text-left rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
      >
        <Card icon={GitPullRequest} title={title}>
          <div className="mb-2">
            <Big value={d.open} sub="open" />
          </div>
          <Row label="approved" value={<Badge tone="green">{d.approve}</Badge>} />
          <Row label="changes" value={<Badge tone="red">{d.changes}</Badge>} />
          <Row label="needs review" value={<Badge tone="yellow">{d.needsReview}</Badge>} />
        </Card>
      </button>
    )
  },
}
export default plugin
