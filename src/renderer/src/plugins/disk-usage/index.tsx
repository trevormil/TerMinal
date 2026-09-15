import { HardDrive } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Big, Empty } from '../../components/ui/display'
import type { Plugin } from '../../lib/types'
import { formatBytes } from './model'

const plugin: Plugin<{ bytes?: number; error?: string }> = {
  id: 'disk-usage',
  title: 'Repo disk usage',
  icon: HardDrive,
  blurb: 'Local repo disk allocation, including dependencies. Optional, off by default.',
  order: 5.4,
  intervalMs: 60000,
  defaultEnabled: false,
  poll: async (gt) => {
    try {
      if ((await gt.tabContext()).remote)
        return { error: 'Disk usage is unavailable for remote sessions.' }
      return await gt.repoDiskUsage()
    } catch {
      return { error: 'Could not read local disk usage.' }
    }
  },
  render: (data) => (
    <TitledCard icon={HardDrive} title="Repo disk usage">
      {data?.bytes !== undefined && !data.error ? (
        <>
          <Big value={formatBytes(data.bytes)} sub="allocated on disk" />
          <Empty>Includes dependencies and hidden files · refreshes every minute.</Empty>
        </>
      ) : (
        <Empty>{data?.error || 'Loading local disk usage…'}</Empty>
      )}
    </TitledCard>
  ),
}
export default plugin
