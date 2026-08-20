import { Cpu, GitBranch } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Empty } from '../../components/ui/display'
import { Badge } from '../../components/ui/badge'
import { CopyButton } from '../../components/ui'
import type { Plugin, TranscriptStats } from '../../lib/types'

const shortModel = (m: string) =>
  m
    .replace('claude-', '')
    .replace(/-(\d+)-(\d+)/, '-$1.$2')
    .replace(/\[1m\]/, ' 1M')

const MODE: Record<string, { label: string; variant: 'warning' | 'info' | 'secondary' }> = {
  auto: { label: 'Auto', variant: 'warning' },
  bypassPermissions: { label: 'Auto', variant: 'warning' },
  acceptEdits: { label: 'Accept-edits', variant: 'info' },
  plan: { label: 'Plan', variant: 'info' },
  default: { label: 'Normal', variant: 'secondary' },
}

// Headline card: Claude's own session title + model + permission mode + branch + turns.
const plugin: Plugin<TranscriptStats> = {
  id: 'session',
  title: 'Session',
  icon: Cpu,
  blurb: "Claude's session title, model, permission mode, branch, and turn count.",
  order: 0,
  intervalMs: 4000,
  realtime: true,
  defaultEnabled: true,
  engines: ['claude'],
  poll: (gt) => gt.transcript(),
  render: (d) => {
    if (!d?.ok)
      return (
        <TitledCard icon={Cpu} title="Session">
          <Empty>No active session</Empty>
        </TitledCard>
      )
    const mode = d.permissionMode ? MODE[d.permissionMode] : null
    return (
      <TitledCard
        icon={Cpu}
        title="Session"
        right={
          <CopyButton
            value={d.sessionId}
            title="Copy session id"
            className="font-mono text-[9px] text-muted-foreground"
          >
            {d.sessionId.slice(0, 6)}
          </CopyButton>
        }
      >
        <div className="mb-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">
          {d.aiTitle || d.firstUserText || 'Untitled session'}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{shortModel(d.model)}</span>
          {mode && <Badge variant={mode.variant}>{mode.label}</Badge>}
          {d.gitBranch && (
            <span className="inline-flex items-center gap-0.5">
              <GitBranch size={10} strokeWidth={2} />
              {d.gitBranch}
            </span>
          )}
          <span className="tabular-nums">{d.turns} turns</span>
        </div>
      </TitledCard>
    )
  },
}
export default plugin
