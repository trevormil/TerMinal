import { Bot } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Row, Empty } from '../../components/ui/display'
import { CopyButton } from '../../components/ui'
import type { Plugin, TranscriptStats } from '../../lib/types'

const plugin: Plugin<TranscriptStats> = {
  id: 'model',
  title: 'Model',
  icon: Bot,
  blurb: 'Which model the active session is running, plus turn count.',
  order: 6,
  intervalMs: 4000,
  realtime: true,
  defaultEnabled: false,
  engines: ['claude'],
  poll: (gt) => gt.transcript(),
  render: (d) => {
    if (!d?.ok)
      return (
        <TitledCard icon={Bot} title="Model">
          <Empty>No active Claude session</Empty>
        </TitledCard>
      )
    return (
      <TitledCard icon={Bot} title="Model">
        <div className="mb-1 truncate text-[13px] font-semibold text-foreground" title={d.model}>
          {d.model}
        </div>
        <Row label="Turns" value={d.turns} />
        <Row
          label="Session"
          value={
            <CopyButton value={d.sessionId} title="Copy session id">
              {d.sessionId.slice(0, 8) || '—'}
            </CopyButton>
          }
        />
        {d.gitBranch && <Row label="Branch" value={d.gitBranch} />}
      </TitledCard>
    )
  },
}
export default plugin
