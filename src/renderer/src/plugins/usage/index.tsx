import { Gauge as GaugeIcon } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Gauge } from '../../components/ui/gauge'
import { Row, Empty } from '../../components/ui/display'
import { Badge } from '../../components/ui/badge'
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
  if (!w) return <Row label={label} value={<span className="text-muted-foreground">—</span>} />
  const tone = w.pct > 90 ? 'var(--gt-red)' : w.pct > 70 ? 'var(--gt-yellow)' : 'var(--gt-accent-2)'
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/90">
          {w.pct.toFixed(0)}%
          {w.resetsAt && (
            <span className="ml-1.5 text-[10.5px] text-muted-foreground">↻ {resetIn(w.resetsAt)}</span>
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
    if (!d.ok && !d.fiveHour && !d.sevenDay)
      return (
        <TitledCard icon={GaugeIcon} title="Plan Usage">
          <Empty>{d.error || 'Usage unavailable'}</Empty>
        </TitledCard>
      )
    return (
      <TitledCard
        icon={GaugeIcon}
        title="Plan Usage"
        right={d.stale ? <Badge variant="secondary">Cached</Badge> : undefined}
      >
        <WindowRow label="5-hour" w={d.fiveHour} />
        <WindowRow label="Weekly" w={d.sevenDay} />
        {d.overagePct != null && d.overagePct > 0 && (
          <Row
            label="Overage"
            value={<span className="text-[var(--gt-yellow)]">{d.overagePct.toFixed(0)}%</span>}
          />
        )}
      </TitledCard>
    )
  },
}
export default plugin
