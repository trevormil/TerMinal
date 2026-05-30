import { Cpu, GitBranch } from 'lucide-react'
import { Card, Badge, Empty } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import type { Plugin, TranscriptStats } from '../../lib/types'

const shortModel = (m: string) =>
  m.replace('claude-', '').replace(/-(\d+)-(\d+)/, '-$1.$2').replace(/\[1m\]/, ' 1M')

const MODE: Record<string, { label: string; tone: BadgeTone }> = {
  bypassPermissions: { label: 'auto', tone: 'yellow' },
  acceptEdits: { label: 'accept-edits', tone: 'blue' },
  plan: { label: 'plan', tone: 'blue' },
  default: { label: 'normal', tone: 'mute' },
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
        <Card icon={Cpu} title="Session">
          <Empty>No active session</Empty>
        </Card>
      )
    const mode = d.permissionMode ? MODE[d.permissionMode] : null
    return (
      <Card
        icon={Cpu}
        title="Session"
        right={<span className="font-mono text-[9px] text-zinc-600">{d.sessionId.slice(0, 6)}</span>}
      >
        <div className="mb-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-zinc-100">
          {d.aiTitle || d.firstUserText || 'untitled session'}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500">
          <span className="font-medium text-zinc-300">{shortModel(d.model)}</span>
          {mode && <Badge tone={mode.tone}>{mode.label}</Badge>}
          {d.gitBranch && (
            <span className="inline-flex items-center gap-0.5">
              <GitBranch size={10} strokeWidth={2} />
              {d.gitBranch}
            </span>
          )}
          <span className="tabular-nums">{d.turns} turns</span>
        </div>
      </Card>
    )
  },
}
export default plugin
