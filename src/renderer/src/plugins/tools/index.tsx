import { Wrench } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Empty } from '../../components/ui/display'
import type { Plugin, TranscriptStats } from '../../lib/types'

// Compact breakdown of which tools the agent has used this session.
const plugin: Plugin<TranscriptStats> = {
  id: 'tools',
  title: 'Tool Use',
  icon: Wrench,
  blurb: 'How many times the agent has used each tool this session.',
  order: 7,
  intervalMs: 3000,
  realtime: true,
  defaultEnabled: false,
  engines: ['claude'],
  poll: (gt) => gt.transcript(),
  render: (d) => {
    const entries = Object.entries(d?.toolCounts || {}).sort((a, b) => b[1] - a[1])
    if (!entries.length)
      return (
        <TitledCard icon={Wrench} title="Tool Use">
          <Empty>None yet</Empty>
        </TitledCard>
      )
    const total = entries.reduce((s, [, n]) => s + n, 0)
    return (
      <TitledCard
        icon={Wrench}
        title="Tool Use"
        right={<span className="text-[9px] tabular-nums text-muted-foreground">{total}</span>}
      >
        <div className="flex flex-wrap gap-1">
          {entries.slice(0, 12).map(([name, n]) => (
            <span
              key={name}
              className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {name} <span className="font-semibold tabular-nums text-foreground/90">{n}</span>
            </span>
          ))}
        </div>
      </TitledCard>
    )
  },
}
export default plugin
