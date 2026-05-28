import { Brain } from 'lucide-react'
import { Card, Gauge, Big, Empty } from '../../components/ui'
import { fmtTokens } from '../../lib/format'
import type { Plugin, TranscriptStats } from '../../lib/types'

const plugin: Plugin<TranscriptStats> = {
  id: 'context',
  title: 'Context Window',
  icon: Brain,
  blurb: "Live % of the model's context window used on the current turn.",
  order: 1,
  intervalMs: 3000,
  realtime: true,
  defaultEnabled: true,
  poll: (gt) => gt.transcript(),
  render: (d) => {
    if (!d?.ok)
      return (
        <Card icon={Brain} title="Context Window">
          <Empty>No active Claude session</Empty>
        </Card>
      )
    return (
      <Card
        icon={Brain}
        title="Context Window"
        right={<span className="text-[10.5px] text-zinc-500">{fmtTokens(d.contextLimit)} cap</span>}
      >
        <div className="mb-2">
          <Big value={`${d.contextPct.toFixed(1)}%`} sub={`${fmtTokens(d.contextTokens)} tok`} />
        </div>
        <Gauge pct={d.contextPct} />
      </Card>
    )
  },
}
export default plugin
