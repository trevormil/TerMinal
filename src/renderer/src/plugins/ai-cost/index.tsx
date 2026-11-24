import { DollarSign } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Empty, Big } from '../../components/ui/display'
import type { Plugin } from '../../lib/types'
import { dailyCost, formatCost } from './model'

type CostData = ReturnType<typeof dailyCost> & { error?: string; capped?: boolean }
const plugin: Plugin<CostData> = {
  id: 'ai-cost',
  title: 'AI cost per day',
  icon: DollarSign,
  blurb: 'Estimated spend from the local AI ledger across repos. Optional, off by default.',
  order: 5.2,
  intervalMs: 60000,
  defaultEnabled: false,
  poll: async (gt) => {
    try {
      if ((await gt.tabContext()).remote)
        return { ...dailyCost([]), error: 'Cost data is unavailable for remote sessions.' }
      const runs = await gt.observability.runs(2000)
      return { ...dailyCost(runs), capped: runs.length >= 2000 }
    } catch {
      return { ...dailyCost([]), error: 'Could not read the local AI usage ledger.' }
    }
  },
  render: (data) => (
    <TitledCard icon={DollarSign} title="AI cost per day">
      {!data || data.error || !data.weekRuns ? (
        <Empty>
          {!data
            ? 'Loading local usage…'
            : data.error || 'No local AI usage recorded in the last 7 days.'}
        </Empty>
      ) : (
        <>
          {data.todayRuns ? (
            <Big value={formatCost(data.todayUsd)} sub="estimated today" />
          ) : (
            <Empty>No usage recorded today.</Empty>
          )}
          <Empty>{formatCost(data.weekUsd)} over 7 calendar days · all local repos</Empty>
          <Empty>
            Estimates by run start date, not a bill. Subscription usage may have no incremental
            charge.
          </Empty>
        </>
      )}
      {data?.capped && <Empty>Partial window: latest 2,000 ledger records only.</Empty>}
    </TitledCard>
  ),
}
export default plugin
