import { UsageSoftCap } from '../../components/UsageSoftCap'
import { Brain } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Gauge } from '../../components/ui/gauge'
import { Big, Empty } from '../../components/ui/display'
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
  engines: ['claude'],
  poll: (gt) => gt.transcript(),
  render: (d) => {
    if (!d?.ok)
      return (
        <TitledCard icon={Brain} title="Context Window">
          <Empty>No active Claude session</Empty>
        </TitledCard>
      )
    return (
      <TitledCard
        icon={Brain}
        title="Context Window"
        right={
          <span className="text-[10.5px] text-muted-foreground">
            {fmtTokens(d.contextLimit)} cap
          </span>
        }
      >
        <div className="mb-2">
          <Big value={`${d.contextPct.toFixed(1)}%`} sub={`${fmtTokens(d.contextTokens)} tok`} />
        </div>
        <Gauge pct={d.contextPct} />
        <UsageSoftCap kind="context" pct={d.contextPct} />
      </TitledCard>
    )
  },
}
export default plugin
