import type { ReactNode } from 'react'
import { Bot, Brain, Plus } from 'lucide-react'
import { ForceChip } from '../../components/ui'
import {
  classicStatusDot,
  definitionStatusDot,
  filterClassicAgents,
  filterDefinitions,
  type AgentScopeFilter,
  type LastRun,
} from '../../lib/agentsView'
import type { Agent, AgentDefinition } from '../../lib/types'
import { AGENT_ICON } from './agentsShared'

// The Agents tab's left rail: mode toggle + search + scope filter over either
// the unified definition roster ('all') or the classic-agent list. Selection
// and filter state live in the tab; this module only renders and reports.

export type AgentMode = 'all' | 'classic' | 'persistent'

/** Shared empty state — distinguishes "no roster at all" from "filter matched nothing". */
function EmptyRoster({ total }: { total: number }) {
  return total === 0 ? (
    <div className="p-3 text-[11px] leading-relaxed text-zinc-600">
      <div className="mb-1 font-semibold text-zinc-400">No agents yet.</div>
      Agents own tickets and scheduled runs for this repo. Seed a starter roster with the Bootstrap
      banner, or define one under <span className="font-mono">.agents/</span>.
    </div>
  ) : (
    <div className="p-3 text-[11px] text-zinc-600">No agents match.</div>
  )
}

const rowClass = (on: boolean) =>
  `flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-1.5 text-left ${
    on ? 'bg-[var(--gt-accent)]/20' : 'hover:bg-white/5'
  }`

function StatusDot({ dot, dotTitle }: { dot: string; dotTitle: string }) {
  if (!dot) return null
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} title={dotTitle} />
}

export type AgentListProps = {
  width: number
  mode: AgentMode
  modeToggle: ReactNode
  search: string
  onSearch: (v: string) => void
  filter: AgentScopeFilter
  onFilter: (v: AgentScopeFilter) => void
  onNew: () => void
  definitions: AgentDefinition[] | null
  agents: Agent[] | null
  selDefinitionId: string | null
  selAgentId: string | null
  runningByAgent: Set<string>
  lastRunByAgent: Map<string, { status: string; startedAt: number }>
  onSelectDefinition: (definition: AgentDefinition) => void
  onSelectAgent: (id: string) => void
}

export function AgentList({
  width,
  mode,
  modeToggle,
  search,
  onSearch,
  filter,
  onFilter,
  onNew,
  definitions,
  agents,
  selDefinitionId,
  selAgentId,
  runningByAgent,
  lastRunByAgent,
  onSelectDefinition,
  onSelectAgent,
}: AgentListProps) {
  const renderDefinitions = (list: AgentDefinition[]) =>
    list.map((d) => {
      const Icon = d.kind === 'persistent' ? Brain : AGENT_ICON[d.icon || ''] || Bot
      const on = selDefinitionId === d.id
      const busy = d.kind === 'classic' && runningByAgent.has(d.ref.id)
      const last: LastRun =
        busy || d.kind !== 'classic' ? null : lastRunByAgent.get(d.ref.id) || null
      const { dot, dotTitle } = definitionStatusDot(d, busy, last)
      return (
        <button
          key={d.id}
          onClick={() => onSelectDefinition(d)}
          title={d.description || d.title}
          className={rowClass(on)}
        >
          <Icon
            size={13}
            strokeWidth={2}
            className={`shrink-0 ${
              on
                ? 'text-[var(--gt-accent-light)]'
                : d.kind === 'persistent'
                  ? 'text-[var(--gt-accent-light)]/60'
                  : 'text-zinc-500'
            }`}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">
            {d.title}
          </span>
          {d.runtime.force && <ForceChip />}
          <StatusDot dot={dot} dotTitle={dotTitle} />
        </button>
      )
    })

  const renderClassic = (list: Agent[]) =>
    list.map((a) => {
      const Icon = AGENT_ICON[a.icon || ''] || Bot
      const on = selAgentId === a.id
      const busy = runningByAgent.has(a.id)
      const last: LastRun = busy ? null : lastRunByAgent.get(a.id) || null
      const { dot, dotTitle } = classicStatusDot(busy, last)
      return (
        <button
          key={a.id}
          onClick={() => onSelectAgent(a.id)}
          title={a.description || a.title}
          className={rowClass(on)}
        >
          <Icon
            size={13}
            strokeWidth={2}
            className={`shrink-0 ${on ? 'text-[var(--gt-accent-light)]' : 'text-zinc-500'}`}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">
            {a.title}
          </span>
          {a.force && <ForceChip />}
          <StatusDot dot={dot} dotTitle={dotTitle} />
        </button>
      )
    })

  const body = () => {
    if (mode === 'all') {
      if (definitions === null) return <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
      const list = filterDefinitions(definitions, search)
      if (list.length === 0) return <EmptyRoster total={definitions.length} />
      return renderDefinitions(list)
    }
    if (agents === null) return <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
    const list = filterClassicAgents(agents, filter, search)
    if (list.length === 0) return <EmptyRoster total={agents.length} />
    return renderClassic(list)
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30"
      style={{ width }}
    >
      <div className="shrink-0 space-y-2 border-b border-[var(--gt-border)] p-2.5">
        {modeToggle}
        <div className="flex items-center gap-1.5">
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={mode === 'all' ? 'Search all agents…' : 'Search classic agents…'}
            className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
          />
          <button
            onClick={onNew}
            title="Design a new agent — describe what it does, the selected engine writes the bash"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
          >
            <Plus size={12} strokeWidth={2.5} />
            New
          </button>
        </div>
        {/* Kind (all/classic/persistent) lives solely on the top mode toggle;
            in 'all' mode the roster shows every kind, so only the scope
            filter renders — and only in the classic layout. */}
        {mode !== 'all' && (
          <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] bg-black/15 p-0.5">
            {(['all', 'generic', 'per-repo'] as const).map((f) => (
              <button
                key={f}
                onClick={() => onFilter(f)}
                className={`flex-1 rounded-sm px-1.5 py-0.5 text-[10px] capitalize ${
                  filter === f
                    ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {f === 'per-repo' ? 'per-repo' : f}
              </button>
            ))}
          </div>
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto">{body()}</nav>
    </aside>
  )
}
