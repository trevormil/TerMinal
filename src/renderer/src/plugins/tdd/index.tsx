import { FlaskConical, TriangleAlert } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Big, Row, Empty } from '../../components/ui/display'
import { Badge } from '../../components/ui/badge'
import { navigateTo } from '../../lib/nav'
import type { Plugin, TddInfo } from '../../lib/types'

// Deep-link into the MRs tab (replay once — the receiver mounts after the tab
// switches; mirrors the git/mr-summary widgets).
const openPr = (iid: number) => {
  navigateTo('mrs', { iid })
  setTimeout(() => navigateTo('mrs', { iid }), 50)
}

const verdictTone = (v: string): 'success' | 'destructive' | 'secondary' =>
  v === 'approve'
    ? 'success'
    : v === 'request-changes' || v === 'blocked'
      ? 'destructive'
      : 'secondary'
const testTone = (s: string): 'success' | 'destructive' | 'secondary' =>
  s === 'pass' ? 'success' : s === 'fail' ? 'destructive' : 'secondary'

const plugin: Plugin<TddInfo> = {
  id: 'tdd',
  title: 'TDD / Review',
  icon: FlaskConical,
  blurb: 'Latest code-review score + test status from the autopilot harness, with a stale flag.',
  order: 4,
  intervalMs: 2000,
  defaultEnabled: true,
  poll: (gt) => gt.harnessTdd(),
  render: (d) => {
    if (!d?.ok)
      return (
        <TitledCard icon={FlaskConical} title="TDD / Review">
          <Empty>{d?.repo ? `No tracked review · ${d.repo}` : 'Not a tracked repo'}</Empty>
        </TitledCard>
      )
    const card = (
      <TitledCard
        icon={FlaskConical}
        title="TDD / Review"
        right={
          d.stale ? (
            <Badge variant="warning">
              <TriangleAlert size={9} strokeWidth={2.5} />
              Stale{d.commitsBehind ? ` ${d.commitsBehind}↓` : ''}
            </Badge>
          ) : (
            <Badge variant="success">Current</Badge>
          )
        }
      >
        <div className="mb-2">
          <Big value={d.overall ?? '—'} sub={`${d.repo} #${d.number}`} />
        </div>
        <Row label="Verdict" value={<Badge variant={verdictTone(d.verdict)}>{d.verdict}</Badge>} />
        <Row label="Tests" value={<Badge variant={testTone(d.testStatus)}>{d.testStatus}</Badge>} />
      </TitledCard>
    )
    // Deep-link to the PR when we have its number; otherwise leave it inert.
    if (!d.number) return card
    return (
      <button
        type="button"
        onClick={() => openPr(d.number)}
        title={`Open PR #${d.number}`}
        className="block w-full text-left rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
      >
        {card}
      </button>
    )
  },
}
export default plugin
