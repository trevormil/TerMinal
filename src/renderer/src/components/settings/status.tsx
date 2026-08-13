import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { Section, tilde, type SettingsSectionSpec } from './shared'

// Harness self-status: meta-observability snapshot of how TerMinal's own
// infrastructure is doing. Refreshes on mount + every 5s while visible.
function HarnessStatusPanel() {
  const [s, setS] = useState<Awaited<ReturnType<typeof window.gt.harnessStatus>> | null>(null)
  useEffect(() => {
    const load = () => window.gt.harnessStatus().then(setS)
    void load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])
  if (!s)
    return (
      <div className="rounded-md border border-dashed border-[var(--gt-border)] p-3 text-[11px] text-zinc-600">
        loading…
      </div>
    )
  const Cell = ({
    label,
    value,
    tone = 'mute',
  }: {
    label: string
    value: number | string
    tone?: 'mute' | 'green' | 'red' | 'yellow' | 'blue'
  }) => {
    const cls =
      tone === 'green'
        ? 'text-[var(--gt-green)]'
        : tone === 'red'
          ? 'text-[var(--gt-red)]'
          : tone === 'yellow'
            ? 'text-[var(--gt-yellow)]'
            : tone === 'blue'
              ? 'text-[var(--gt-accent-light)]'
              : 'text-zinc-200'
    return (
      <div className="flex flex-col items-start gap-0.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5">
        <span className="text-[9.5px] uppercase tracking-wider text-zinc-500">{label}</span>
        <span className={`tabular-nums text-[15px] font-semibold ${cls}`}>{value}</span>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-zinc-300">
        <Cell label="Cron records" value={s.cronRunFiles} />
        <Cell
          label="Cron running"
          value={s.cronRunsRunning}
          tone={s.cronRunsRunning > 0 ? 'blue' : 'mute'}
        />
        <Cell
          label="In-proc running"
          value={s.inProcessRunning}
          tone={s.inProcessRunning > 0 ? 'blue' : 'mute'}
        />
        <Cell
          label="Failed (24h)"
          value={s.cronFailed24h}
          tone={s.cronFailed24h > 0 ? 'red' : 'green'}
        />
        <Cell
          label="Paused schedules"
          value={s.schedulesPaused}
          tone={s.schedulesPaused > 0 ? 'yellow' : 'mute'}
        />
        <Cell label="Cron worktrees" value={s.cronWorktrees} />
      </div>
      <div className="text-[10px] text-zinc-600">
        Updated live · stored in <code className="font-mono">{tilde(s.configDir)}</code>
      </div>
    </div>
  )
}

function Component() {
  return (
    <Section
      id="status"
      icon={Activity}
      title="Harness status"
      desc="How TerMinal's own infrastructure is doing right now. Refreshes every 5s."
    >
      <HarnessStatusPanel />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'status',
  title: 'Status',
  icon: Activity,
  order: 21,
  Component,
}
export default section
