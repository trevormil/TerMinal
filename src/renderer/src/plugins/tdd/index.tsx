import { FlaskConical, TriangleAlert } from 'lucide-react'
import { Card, Big, Badge, Row, Empty } from '../../components/ui'
import type { Plugin, TddInfo } from '../../lib/types'

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
    return (
      <Card
        icon={FlaskConical}
        title="TDD / Review"
        right={
          d.stale ? (
            <Badge tone="warn">
              <TriangleAlert size={9} strokeWidth={2.5} />
              stale{d.commitsBehind ? ` ${d.commitsBehind}↓` : ''}
            </Badge>
          ) : (
            <Badge tone="ok">current</Badge>
          )
        }
      >
        <div className="mb-2">
          <Big value={d.overall ?? '—'} sub={`${d.repo} #${d.number}`} />
        </div>
        <Row label="verdict" value={<Badge tone={verdictTone(d.verdict)}>{d.verdict}</Badge>} />
        <Row label="tests" value={<Badge tone={testTone(d.testStatus)}>{d.testStatus}</Badge>} />
      </Card>
    )
  },
}
export default plugin
