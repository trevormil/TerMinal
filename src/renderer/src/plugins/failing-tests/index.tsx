import { TestTubeDiagonal } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Big, Empty } from '../../components/ui/display'
import { navigateTo } from '../../lib/nav'
import type { Plugin, TddInfo } from '../../lib/types'

type Data = { info?: TddInfo; error?: string }
const plugin: Plugin<Data> = {
  id: 'failing-tests',
  title: 'Failing tests',
  icon: TestTubeDiagonal,
  blurb:
    'Recorded failing-test count from the latest local review artifact. Optional, off by default.',
  order: 5.3,
  intervalMs: 60000,
  defaultEnabled: false,
  poll: async (gt) => {
    try {
      if ((await gt.tabContext()).remote)
        return { error: 'Test counts are unavailable for remote sessions.' }
      return { info: await gt.harnessTdd() }
    } catch {
      return { error: 'Could not read the local test summary.' }
    }
  },
  render: (data) => {
    const info = data?.info
    const count = info?.ok ? info.failedTests : null
    const card = (
      <TitledCard icon={TestTubeDiagonal} title="Failing tests">
        {count == null || data?.error ? (
          <Empty>
            {data?.error ||
              'No recorded test count. Run a local review/test gate to create a summary.'}
          </Empty>
        ) : (
          <>
            <Big value={count} sub="recorded failures" />
            <Empty>
              Latest local review · PR #{info?.number}. Historical count; rerun tests to verify
              current code.
            </Empty>
          </>
        )}
      </TitledCard>
    )
    return info?.number ? (
      <button
        type="button"
        className="block w-full rounded-lg text-left focus-visible:ring-1"
        title="Open test review"
        onClick={() => navigateTo('mrs', { iid: info.number })}
      >
        {card}
      </button>
    ) : (
      card
    )
  },
}
export default plugin
