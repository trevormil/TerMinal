import { FlaskConical, TriangleAlert } from 'lucide-react'
import { Card, Big, Badge, Row, Empty } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
import type { Plugin, TddInfo } from '../../lib/types'

// Deep-link into the MRs tab (replay once — the receiver mounts after the tab
// switches; mirrors the git/mr-summary widgets).
const openPr = (iid: number) => {
  navigateTo('mrs', { iid })
  setTimeout(() => navigateTo('mrs', { iid }), 50)
}

const verdictTone = (v: string): 'ok' | 'warn' | 'bad' | 'mute' =>
  v === 'approve' ? 'ok' : v === 'request-changes' || v === 'blocked' ? 'bad' : 'mute'
const testTone = (s: string): 'ok' | 'warn' | 'bad' | 'mute' =>
  s === 'pass' ? 'ok' : s === 'fail' ? 'bad' : 'mute'

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
        <Card icon={FlaskConical} title="TDD / Review">
          <Empty>{d?.repo ? `No tracked review · ${d.repo}` : 'Not a tracked repo'}</Empty>
        </Card>
      )
    const card = (
      <Card
        icon={FlaskConical}
        title="TDD / Review"
        right={
          d.stale ? (
            <Badge tone="warn">
              <TriangleAlert size={9} strokeWidth={2.5} />
              Stale{d.commitsBehind ? ` ${d.commitsBehind}↓` : ''}
            </Badge>
          ) : (
            <Badge tone="ok">Current</Badge>
          )
        }
      >
        <div className="mb-2">
          <Big value={d.overall ?? '—'} sub={`${d.repo} #${d.number}`} />
        </div>
        <Row label="Verdict" value={<Badge tone={verdictTone(d.verdict)}>{d.verdict}</Badge>} />
        <Row label="Tests" value={<Badge tone={testTone(d.testStatus)}>{d.testStatus}</Badge>} />
      </Card>
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
