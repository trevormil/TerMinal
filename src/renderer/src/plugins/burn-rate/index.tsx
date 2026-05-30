import { Flame } from 'lucide-react'
import { Card, Big, Gauge } from '../../components/ui'
import { fmtTokens } from '../../lib/format'
import type { Plugin } from '../../lib/types'

type Burn = { total: number; ts: number; ratePerMin: number }

const plugin: Plugin<Burn> = {
  id: 'burn-rate',
  title: 'Token Burn Rate',
  icon: Flame,
  blurb: 'Live tokens/min, computed from the delta between polls.',
  order: 5,
  intervalMs: 2000,
  realtime: true,
  defaultEnabled: false,
  engines: ['claude'],
  poll: async (gt, prev) => {
    const t = await gt.transcript()
    const total = t.totalInputTokens + t.totalOutputTokens
    if (!prev) return { total, ts: t.ts, ratePerMin: 0 }
    const dMin = Math.max((t.ts - prev.ts) / 60_000, 1e-6)
    const instant = Math.max(0, (total - prev.total) / dMin)
    // exponential smoothing so the number doesn't jitter wildly
    const ratePerMin = prev.ratePerMin * 0.6 + instant * 0.4
    return { total, ts: t.ts, ratePerMin }
  },
  render: (d) => {
    const rate = d?.ratePerMin ?? 0
    // scale gauge against 50k tok/min as "hot"
    return (
      <Card icon={Flame} title="Token Burn Rate">
        <div className="mb-2">
          <Big value={fmtTokens(Math.round(rate))} sub="tok / min" />
        </div>
        <Gauge pct={(rate / 50_000) * 100} color="#ff7b3d" />
      </Card>
    )
  },
}
export default plugin
