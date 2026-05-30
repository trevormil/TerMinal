import { Gauge as GaugeIcon } from 'lucide-react'
import { Card, Gauge, Row, Badge, Empty } from '../../components/ui'
import type { Plugin, Usage, UsageWindow } from '../../lib/types'

function resetIn(resetsAt: number | null): string {
  if (!resetsAt) return ''
  const s = resetsAt - Date.now() / 1000
  if (s <= 0) return 'resetting'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function WindowRow({ label, w }: { label: string; w: UsageWindow }) {
  if (!w) return <Row label={label} value={<span className="text-zinc-600">—</span>} />
  const tone = w.pct > 90 ? '#ff5c7c' : w.pct > 70 ? '#ffb35c' : 'var(--gt-accent-2)'
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-200">
          {w.pct.toFixed(0)}%
          {w.resetsAt && (
            <span className="ml-1.5 text-[10.5px] text-zinc-600">↻ {resetIn(w.resetsAt)}</span>
          )}
        </span>
      </div>
      <Gauge pct={w.pct} color={tone} />
    </div>
  )
}

// Mirrors Claude Code's `/usage`: the 5-hour + weekly plan windows and any
// overage. Polls slowly (the endpoint is rate-limited) and shows the plan tier.
const plugin: Plugin<Usage> = {
  id: 'usage',
  title: 'Plan Usage',
  icon: GaugeIcon,
  blurb: 'Your Claude subscription 5-hour + weekly limits and overage — a live /usage summary.',
  order: 3,
  intervalMs: 30_000,
  defaultEnabled: true,
  engines: ['claude'],
  poll: (gt) => gt.usage(),
  render: (d) => {
    if (!d) return null
    const planLabel = [d.plan, d.tier].filter(Boolean).join(' · ')
    if (!d.ok && !d.fiveHour && !d.sevenDay)
      return (
        <Card icon={GaugeIcon} title="Plan Usage">
          <Empty>{d.error || 'usage unavailable'}</Empty>
        </Card>
      )
    return (
      <Card
        icon={GaugeIcon}
        title="Plan Usage"
        right={
          d.stale ? (
            <Badge tone="mute">cached</Badge>
          ) : planLabel ? (
            <Badge tone="mute">{planLabel}</Badge>
          ) : undefined
        }
      >
        <WindowRow label="5-hour" w={d.fiveHour} />
        <WindowRow label="weekly" w={d.sevenDay} />
        {d.overagePct != null && d.overagePct > 0 && (
          <Row
            label="overage"
            value={<span className="text-amber-300">{d.overagePct.toFixed(0)}%</span>}
          />
        )}
      </Card>
    )
  },
}
export default plugin
