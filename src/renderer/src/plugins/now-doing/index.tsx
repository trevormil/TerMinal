import { Zap } from 'lucide-react'
import { Card, Empty } from '../../components/ui'
import type { Plugin, TranscriptStats } from '../../lib/types'

const plugin: Plugin<TranscriptStats> = {
  id: 'now-doing',
  title: 'Now Doing',
  icon: Zap,
  blurb: "The agent's most recent tool call, tailed live from the transcript.",
  order: 2,
  intervalMs: 3000,
  realtime: true,
  defaultEnabled: true,
  engines: ['claude'],
  poll: (gt) => gt.transcript(),
  render: (d) => {
    const a = d?.lastAction
    return (
      <Card icon={Zap} title="Now Doing">
        {a ? (
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--gt-accent-2)] gt-pulse" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-zinc-100">{a.tool}</div>
              {a.detail && (
                <div className="truncate text-[11.5px] text-zinc-500" title={a.detail}>
                  {a.detail}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Empty>Idle</Empty>
        )}
      </Card>
    )
  },
}
export default plugin
