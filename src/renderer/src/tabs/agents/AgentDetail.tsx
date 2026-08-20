import { useEffect, useMemo, useState, type RefObject } from 'react'
import {
  Bot,
  Brain,
  FileText,
  Play,
  ListChecks,
  Gauge,
  Square,
  Trash2,
  FolderOpen,
  Pencil,
  RotateCcw,
  EyeOff,
  ClipboardList,
  AlertOctagon,
  CheckCircle2,
  Cpu,
  Database,
} from 'lucide-react'
import { ForceChip } from '../../components/ui'
import { Badge } from '../../components/ui/badge'
import { EngineLogo } from '../../components/EngineLogo'
import { DetailTabs } from '../../components/DetailTabs'
import { BashHighlight } from '../../components/BashHighlight'
import { RunOutputView } from '../../components/StructuredRunLog'
import { navigateTo } from '../../lib/nav'
import { fmtUsd } from '../../lib/format'
import { engineLabel } from '../../lib/engines'
import { relativeTime } from '../../lib/time'
import {
  fmtDuration,
  modelPolicyRows,
  parseStateSidecar,
  runSparkline,
  runStatusTone,
  shortAge,
  successRateTone,
  type UnifiedRunRow,
} from '../../lib/agentsView'
import type {
  Agent,
  AgentDefinition,
  AgentQuality,
  AgentRun,
  AgentScorecard,
} from '../../lib/types'
import { AGENT_ICON, SOURCE, SectionKicker, Stat } from './agentsShared'

// The Agents tab's right pane. Two shapes share the surface: a classic agent
// (header + Overview/Profile/Source/Runs tabs) and a persistent agent's
// read-only profile, which hands off to the memory workspace. The panels
// below (quality contract, reliability scorecard, agent profile) are reused
// by both.

const fmtRelative = relativeTime

// Map a legacy badge tone (from lib/agentsView.ts) to the shadcn badge variant.
const badgeVariantFor = (tone: string) =>
  tone === 'green' || tone === 'ok'
    ? ('success' as const)
    : tone === 'red' || tone === 'bad'
      ? ('destructive' as const)
      : tone === 'yellow' || tone === 'warn'
        ? ('warning' as const)
        : tone === 'blue'
          ? ('info' as const)
          : tone === 'accent'
            ? ('default' as const)
            : ('secondary' as const)

export type AgentDetailState = {
  path: string
  exists: boolean
  state: Record<string, unknown>
} | null

export function QualityPanel({ quality }: { quality: AgentQuality }) {
  const criteria = quality.acceptanceCriteria || []
  const artifacts = quality.requiredArtifacts || []
  const checks = quality.deterministicChecks || []
  const judge = quality.judge
  return (
    <section className="border-b border-[var(--gt-border)]/60 p-4">
      <SectionKicker icon={CheckCircle2} title="Quality contract" />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            Acceptance criteria
          </div>
          {criteria.length === 0 ? (
            <div className="text-[11px] text-zinc-600">No explicit criteria yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {criteria.map((item, i) => (
                <li
                  key={`${i}-${item}`}
                  className="flex gap-2 text-[11.5px] leading-snug text-zinc-300"
                >
                  <CheckCircle2
                    size={12}
                    strokeWidth={2}
                    className="mt-0.5 shrink-0 text-[var(--gt-green)]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              Deterministic checks
            </div>
            {checks.length === 0 ? (
              <div className="text-[11px] text-zinc-600">No shell checks configured.</div>
            ) : (
              <div className="space-y-2">
                {checks.map((check) => (
                  <div
                    key={check.id}
                    className="rounded-md border border-[var(--gt-border)]/70 bg-black/20 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-zinc-200">
                        {check.title}
                      </span>
                      <Badge variant={badgeVariantFor(check.required ? 'red' : 'mute')}>
                        {check.required ? 'required' : 'optional'}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10.5px] text-zinc-500">
                      {check.command}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              Output judge
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={badgeVariantFor(judge?.enabled ? 'accent' : 'mute')}>
                {judge?.enabled ? 'enabled' : 'off'}
              </Badge>
              <Badge variant="info">{judge?.mode || 'deterministic'}</Badge>
              {judge?.passThreshold !== undefined && (
                <Badge variant="warning">{judge.passThreshold}% pass</Badge>
              )}
            </div>
            {judge?.rubric?.length ? (
              <ul className="mt-2 space-y-1">
                {judge.rubric.map((item, i) => (
                  <li key={`${i}-${item}`} className="text-[11px] leading-snug text-zinc-500">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-[11px] text-zinc-600">No rubric configured.</div>
            )}
          </div>
          {artifacts.length > 0 && (
            <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                Required artifacts
              </div>
              <div className="flex flex-wrap gap-1">
                {artifacts.map((artifact) => (
                  <Badge key={artifact} variant="default">
                    {artifact}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// Reliability rollup for one agent, computed in main from the run stores that
// already exist. Also surfaces any kill-switched schedule of this agent with
// the reason it went dark plus a one-click re-enable — a disabled agent is
// otherwise silently absent from the roster.
type DarkSchedule = { id: string; label: string; reason?: string }

export function ScorecardPanel({ agentId }: { agentId: string }) {
  const [card, setCard] = useState<AgentScorecard | null>(null)
  const [dark, setDark] = useState<DarkSchedule[]>([])
  const [loaded, setLoaded] = useState(false)

  // A missing IPC handler must DEGRADE, not throw: an unregistered channel
  // rejects, and without this the panel would raise an unhandled rejection on
  // every render and stay blank forever because setLoaded never ran.
  const load = useMemo(
    () => async () => {
      try {
        const [c, disabled, schedules] = await Promise.all([
          window.gt.agentInsights.scorecard(agentId),
          window.gt.agentInsights.disabledDetail(),
          window.gt.schedules.list(),
        ])
        setCard(c)
        const byId = new Map(disabled.map((d) => [d.id, d]))
        setDark(
          schedules
            .filter((s) => s.agentId === agentId && byId.has(s.id))
            .map((s) => ({
              id: s.id,
              label: `${s.agentTitle} · ${s.repoLabel}`,
              reason: byId.get(s.id)?.reason,
            })),
        )
      } catch {
        // No insights available — render nothing rather than break the tab.
        setCard(null)
        setDark([])
      } finally {
        setLoaded(true)
      }
    },
    [agentId],
  )

  useEffect(() => {
    setLoaded(false)
    void load()
  }, [load])

  const reEnable = async (id: string) => {
    try {
      await window.gt.agentInsights.setDisabled(id, false)
    } catch {
      /* leave the chip in place — the schedule is still disabled */
    }
    await load()
  }

  if (!loaded) return null
  if (!card && !dark.length) return null

  const rate = card?.successRate
  const rateTone = successRateTone(rate)

  return (
    <section className="border-b border-[var(--gt-border)]/60 p-4">
      <SectionKicker icon={Gauge} title="Reliability" />
      {dark.map((d) => (
        <div
          key={d.id}
          className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
        >
          <AlertOctagon size={13} strokeWidth={2.5} className="shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-semibold text-destructive">Disabled · {d.label}</div>
            <div className="truncate text-[11px] text-destructive/70">
              {d.reason || 'no reason recorded'}
            </div>
          </div>
          <button
            className="shrink-0 rounded border border-destructive/50 px-2 py-1 text-[10.5px] font-semibold text-destructive hover:bg-destructive/20"
            onClick={() => void reEnable(d.id)}
          >
            Re-enable
          </button>
        </div>
      ))}
      {card && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Stat
              label="Success"
              value={rate === null || rate === undefined ? 'n/a' : `${rate}%`}
              tone={rateTone}
            />
            <Stat label="Runs" value={String(card.total)} />
            <Stat label="Failed" value={String(card.failed)} />
            <Stat label="Avg cost" value={fmtUsd(card.avgCostUsd ?? 0)} />
            <Stat
              label="Avg time"
              value={card.avgDurationMs === undefined ? '—' : fmtDuration(card.avgDurationMs)}
            />
            <Stat
              label="Eval"
              value={card.evaluated ? `${card.evalPass}/${card.evaluated} pass` : '—'}
            />
          </div>
          {card.failingChecks.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                Failing checks
              </span>
              {card.failingChecks.map((c) => (
                <Badge key={c.id} variant="destructive">
                  {c.title} ×{c.count}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-2 text-[10.5px] text-zinc-600">
            Last {card.total} run{card.total === 1 ? '' : 's'}
            {card.lastRunAt ? ` · latest ${fmtRelative(card.lastRunAt)} (${card.lastStatus})` : ''}
          </div>
        </>
      )}
    </section>
  )
}

export function DefinitionSummary({ definition }: { definition: AgentDefinition }) {
  const Icon = definition.kind === 'persistent' ? Brain : AGENT_ICON[definition.icon || ''] || Bot
  return (
    <section className="border-b border-[var(--gt-border)]/60 p-4">
      <SectionKicker icon={Icon} title="Agent profile" />
      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_220px]">
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            Runtime
          </div>
          <div className="space-y-1.5 text-[11px] text-zinc-400">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Kind</span>
              <span className="capitalize">{definition.kind}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Mode</span>
              <span>{definition.runtime.mode}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Scope</span>
              <span>{definition.scope}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Engine</span>
              <span className="inline-flex items-center gap-1">
                <EngineLogo engine={definition.runtime.engine || 'codex'} size={10} />
                {engineLabel(definition.runtime.engine || 'codex')}
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            <Cpu size={12} strokeWidth={2.5} />
            Model policy
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {modelPolicyRows(definition).map((row) => (
              <div
                key={row.label}
                className="flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--gt-border)]/60 px-2 py-1"
              >
                <Badge variant={badgeVariantFor(row.tone)}>{row.label}</Badge>
                <span className="min-w-0 truncate font-mono text-[10.5px] text-zinc-400">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            <Database size={12} strokeWidth={2.5} />
            Knowledge
          </div>
          <div className="space-y-1.5 text-[11px] text-zinc-400">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Policy</span>
              <span>{definition.instructions.knowledgePolicy || 'standard'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Memory</span>
              <span>{definition.runtime.memoryDir ? 'persistent' : 'run-local'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Override</span>
              <span>
                {definition.runtime.modelPolicy?.allowOverride === false ? 'locked' : 'allowed'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * A persistent agent selected from the unified roster: a read-only profile
 * with a single action that jumps into the memory workspace.
 */
export function PersistentDefinitionDetail({
  definition,
  onOpenWorkspace,
}: {
  definition: AgentDefinition
  onOpenWorkspace: () => void
}) {
  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-3">
        <Brain size={18} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
        <h2 className="text-[14px] font-bold text-zinc-100">{definition.title}</h2>
        <Badge variant="info">{definition.scope}</Badge>
        <span className="font-mono text-[10px] text-zinc-600">{definition.ref.id}</span>
        <div className="flex-1" />
        <button
          onClick={onOpenWorkspace}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white hover:opacity-90"
        >
          <Database size={13} strokeWidth={2.5} />
          Open memory workspace
        </button>
      </header>
      {definition.description && (
        <div className="shrink-0 border-b border-[var(--gt-border)]/60 px-5 py-2 text-[12px] text-zinc-400">
          {definition.description}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DefinitionSummary definition={definition} />
        <ScorecardPanel agentId={definition.id} />
        <section className="border-b border-[var(--gt-border)]/60 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <Brain size={12} strokeWidth={2.5} className="text-[var(--gt-accent-light)]" />
            Memory surface
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['INSTRUCTIONS.md', 'Stable role and operating contract.'],
              ['MEMORY.md', 'Durable preferences, facts, and lessons.'],
              ['STATE.md', 'Current open thread, status, and next actions.'],
              ['JOURNAL.md', 'Append-only history of runs and decisions.'],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3"
              >
                <div className="font-mono text-[11px] font-semibold text-zinc-200">{title}</div>
                <div className="mt-1 text-[11px] leading-snug text-zinc-500">{body}</div>
              </div>
            ))}
          </div>
          {definition.runtime.memoryDir && (
            <div className="mt-3 truncate rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 font-mono text-[10.5px] text-zinc-500">
              {definition.runtime.memoryDir}
            </div>
          )}
        </section>
        <QualityPanel quality={definition.quality} />
        <section className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <ClipboardList size={12} strokeWidth={2.5} className="text-[var(--gt-accent-light)]" />
            Artifact contract
          </h3>
          <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3 text-[11.5px] leading-relaxed text-zinc-400">
            Persistent agents should write durable outputs under{' '}
            <code className="font-mono text-zinc-300">artifacts/&lt;run&gt;/</code> and keep memory
            files current before ending. The memory workspace view exposes the full file browser,
            artifact previewer, and run controls for this agent.
          </div>
        </section>
      </div>
    </>
  )
}

/** The per-(repo, agent) state sidecar body — everything under the kicker. */
function StateSidecarBody({ state }: { state: NonNullable<AgentDetailState> }) {
  const { sha, ref, at, runId, extras } = parseStateSidecar(state.state)
  const relTime = at ? fmtRelative(at) : ''
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--gt-border)] bg-black/30 p-3 text-[11px] text-zinc-300">
      {sha && (
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-zinc-600">Last scanned</span>
          <span className="font-mono text-zinc-200">{sha.slice(0, 12)}</span>
          {ref && (
            <span className="rounded-md border border-[var(--gt-border)] px-1 py-0.5 text-[9.5px] uppercase text-zinc-500">
              {ref}
            </span>
          )}
        </div>
      )}
      {at > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-zinc-600">Last run at</span>
          <span>{new Date(at).toLocaleString()}</span>
          <span className="text-zinc-600">· {relTime}</span>
        </div>
      )}
      {runId && (
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-zinc-600">Last run id</span>
          <span className="truncate font-mono text-[10px] text-zinc-400">{runId}</span>
          <button
            onClick={() => navigateTo('runs', { runId })}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
          >
            View run
          </button>
        </div>
      )}
      {extras.length > 0 && (
        <div className="mt-2 border-t border-[var(--gt-border)]/40 pt-2">
          <div className="mb-1 text-[9.5px] uppercase tracking-wider text-zinc-600">extra keys</div>
          <div className="space-y-0.5 font-mono text-[10.5px]">
            {extras.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2">
                <span className="text-zinc-500">{k}</span>
                <span className="text-zinc-300">
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export type DetailTabKey = 'overview' | 'profile' | 'source' | 'runs'

export type ClassicAgentDetailProps = {
  agent: Agent
  definition: AgentDefinition | null
  script: { path: string; body: string } | null | undefined
  busy: boolean
  agentRuns: AgentRun[]
  allRuns: UnifiedRunRow[]
  spendWeek: { runs: number; usd: number } | undefined
  state: AgentDetailState
  detailTab: DetailTabKey
  onDetailTab: (t: DetailTabKey) => void
  sel: string | null
  onSel: (id: string) => void
  selectedRun: AgentRun | null
  outputs: Record<string, string>
  logRef: RefObject<HTMLDivElement | null>
  onRun: () => void
  onEdit: () => void
  onReset: () => void
  onHide: () => void
  onStateReset: () => void
}

/** The classic-agent right pane: header + Overview/Profile/Source/Runs. */
export function ClassicAgentDetail({
  agent,
  definition,
  script,
  busy,
  agentRuns,
  allRuns,
  spendWeek,
  state,
  detailTab,
  onDetailTab,
  sel,
  onSel,
  selectedRun,
  outputs,
  logRef,
  onRun,
  onEdit,
  onReset,
  onHide,
  onStateReset,
}: ClassicAgentDetailProps) {
  const Icon = AGENT_ICON[agent.icon || ''] || Bot
  const spark = runSparkline(allRuns, agent.id)
  return (
    <>
      {/* Agent header — title + actions */}
      <header className="shrink-0 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/20 px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/25">
            <Icon size={19} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-[15px] font-bold text-zinc-100">
                {agent.title}
              </h2>
              {agent.force && <ForceChip size="md" />}
              {agent.source && (
                <Badge variant={badgeVariantFor(SOURCE[agent.source].tone)}>
                  {SOURCE[agent.source].label}
                </Badge>
              )}
              {agent.hasScript && <Badge variant="info">Script</Badge>}
              <span className="font-mono text-[10px] text-zinc-600">{agent.id}</span>
            </div>
            {agent.description && (
              <div className="mt-1 max-w-4xl text-[12px] leading-relaxed text-zinc-400">
                {agent.description}
              </div>
            )}
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <EngineLogo engine={agent.engine || 'codex'} size={11} />
                {engineLabel(agent.engine || 'codex')}
              </span>
              {agent.model && <span className="font-mono text-zinc-600">· {agent.model}</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              onClick={onRun}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {busy ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-white gt-pulse" />
                  Running
                </>
              ) : (
                <>
                  <Play size={13} strokeWidth={2.5} />
                  Run
                </>
              )}
            </button>
            {script && (
              <button
                onClick={() => window.gt.openInEditor(script.path)}
                title="Edit the .sh in your configured editor"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
              >
                <Pencil size={11} strokeWidth={2} />
                Script
              </button>
            )}
            <button
              onClick={onEdit}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-accent)]/60"
              title="Edit the metadata sidecar (title/icon/engine/etc.)"
            >
              <Pencil size={11} strokeWidth={2} />
              Metadata
            </button>
            {agent.source === 'repo-override' && (
              <button
                onClick={onReset}
                title="Revert to the built-in default"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-yellow)]/60 hover:text-[var(--gt-yellow)]"
              >
                <RotateCcw size={11} strokeWidth={2} />
                Reset
              </button>
            )}
            {agent.source === 'default' && (
              <button
                onClick={onHide}
                title="Hide this built-in preset"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-yellow)]/60 hover:text-[var(--gt-yellow)]"
              >
                <EyeOff size={11} strokeWidth={2} />
                Hide
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Detail tabs — contract first (the substance), then config,
          execution source, and run history. */}
      <DetailTabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'profile', label: 'Profile' },
          { id: 'source', label: 'Source' },
          { id: 'runs', label: 'Runs', count: agentRuns.length },
        ]}
        active={detailTab}
        onSelect={onDetailTab}
      />

      {/* Scrollable body — one tab's sections at a time */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {detailTab === 'overview' &&
          (definition ? (
            <QualityPanel quality={definition.quality} />
          ) : (
            <div className="p-6 text-[12px] text-zinc-600">
              No structured quality contract for this agent.
            </div>
          ))}
        {detailTab === 'profile' &&
          (definition ? (
            <>
              <DefinitionSummary definition={definition} />
              <ScorecardPanel agentId={definition.id} />
            </>
          ) : (
            <div className="p-6 text-[12px] text-zinc-600">
              No structured profile for this agent.
            </div>
          ))}
        {detailTab === 'source' && (
          <>
            {/* Script preview — script can be undefined (loading), null
            (definitively no .sh), or {path,body} (script loaded). */}
            <section className="border-b border-[var(--gt-border)]/60 p-4">
              <SectionKicker
                icon={FileText}
                title="Execution source"
                meta={
                  <>
                    {script ? (
                      <Badge variant="info">Bash script</Badge>
                    ) : script === null ? (
                      <Badge variant="secondary">Prompt</Badge>
                    ) : (
                      <Badge variant="secondary">Loading...</Badge>
                    )}
                  </>
                }
              />
              <div className="mb-2 min-w-0 truncate text-[10.5px] text-zinc-600">
                {script
                  ? script.path
                  : script === null
                    ? `no .agents/${agent.id}.sh — runs as a single agent prompt`
                    : `reading .agents/${agent.id}.sh…`}
              </div>
              {script ? (
                <BashHighlight code={script.body} className="max-h-96" />
              ) : script === null ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--gt-border)] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
                  {agent.prompt}
                </pre>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-4 text-center text-[11px] text-zinc-600">
                  Loading script…
                </div>
              )}
            </section>

            {/* Per-(repo, agent) state sidecar — what the agent remembers
            between runs. Empty = first-time / never `terminal-cli state
            mark-main`'d. Reset wipes the file so the next run does a
            cold scan. */}
            <section className="border-b border-[var(--gt-border)]/60 p-4">
              <SectionKicker
                icon={Database}
                title="State sidecar"
                meta={
                  <>
                    <Badge variant={badgeVariantFor(state?.exists ? 'accent' : 'mute')}>
                      {state?.exists ? 'active' : 'empty'}
                    </Badge>
                    {state?.exists && (
                      <button
                        onClick={onStateReset}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-400 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                      >
                        Reset
                      </button>
                    )}
                  </>
                }
              />
              <div className="mb-2 truncate font-mono text-[9.5px] text-zinc-600">
                {state?.path || '...'}
              </div>
              {!state ? (
                <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-3 text-center text-[11px] text-zinc-600">
                  loading…
                </div>
              ) : !state.exists ? (
                <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-3 text-[11px] leading-relaxed text-zinc-500">
                  No state yet. Cadence agents persist their progress here via{' '}
                  <code className="font-mono text-zinc-300">terminal-cli state mark-main</code>;
                  nothing to show until the first run writes.
                </div>
              ) : (
                <StateSidecarBody state={state} />
              )}
            </section>
          </>
        )}
        {detailTab === 'runs' && (
          <>
            {/* Recent runs for THIS agent */}
            <section className="border-b border-[var(--gt-border)]/60 p-4">
              <SectionKicker
                icon={ListChecks}
                title="Recent runs"
                meta={
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary">{agentRuns.length}</Badge>
                    {spendWeek && spendWeek.usd > 0 && (
                      <>
                        <span
                          className="font-mono tabular-nums text-[10.5px] normal-case text-[var(--gt-accent-light)]"
                          title="Total spend across this agent's runs in the last 7 days"
                        >
                          ${spendWeek.usd.toFixed(2)} / 7d
                        </span>
                        <span className="font-mono tabular-nums text-[10.5px] normal-case text-zinc-600">
                          · avg ${(spendWeek.usd / Math.max(spendWeek.runs, 1)).toFixed(3)}/run
                        </span>
                      </>
                    )}
                  </div>
                }
              />
              {/* Sparkline: last 20 runs across cron + in-process, newest
              on the right. Each bar is a tiny color-coded square
              sized by duration (longer run = taller bar, capped).
              Hover shows status + duration + when. */}
              {spark.length > 0 && (
                <div className="mb-3 flex items-end gap-[3px] rounded-md border border-[var(--gt-border)] bg-black/30 p-2">
                  {spark.map((bar) => (
                    <span
                      key={bar.id}
                      title={bar.title}
                      className={`w-1.5 rounded-sm ${bar.tone}`}
                      style={{ height: `${bar.height}px` }}
                    />
                  ))}
                  <span className="ml-2 text-[9.5px] text-zinc-600">
                    last {spark.length} (oldest → newest)
                  </span>
                </div>
              )}
              {agentRuns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-4 text-center text-[11px] text-zinc-600">
                  No runs yet. Click <span className="mx-0.5 font-semibold text-zinc-400">Run</span>{' '}
                  above to kick one off.
                </div>
              ) : (
                <div className="space-y-1 rounded-lg border border-[var(--gt-border)] bg-black/20">
                  {agentRuns.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => onSel(r.id)}
                      className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-1.5 text-left last:border-b-0 ${
                        sel === r.id ? 'bg-white/5' : 'hover:bg-white/5'
                      }`}
                    >
                      <Badge variant={badgeVariantFor(runStatusTone(r.status))}>{r.status}</Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
                        {r.branch}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] uppercase text-zinc-600">
                        <EngineLogo engine={r.engine} size={10} />
                        {engineLabel(r.engine)}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                        {shortAge(r.startedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Selected run output */}
            {selectedRun && selectedRun.agentId === agent.id && (
              <section className="p-4">
                <SectionKicker
                  icon={Square}
                  title="Run output"
                  meta={
                    <div className="flex items-center gap-1.5">
                      <Badge variant={badgeVariantFor(runStatusTone(selectedRun.status))}>
                        {selectedRun.status}
                      </Badge>
                      <span className="max-w-[220px] truncate font-mono text-[10px] text-zinc-600">
                        {selectedRun.branch}
                      </span>
                      {selectedRun.status === 'running' && (
                        <button
                          onClick={() => window.gt.agents.cancel(selectedRun.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-300 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                        >
                          <Square size={9} strokeWidth={2} />
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => window.gt.openExternal(`file://${selectedRun.worktree}`)}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-300 hover:border-[var(--gt-accent)]/60"
                      >
                        <FolderOpen size={9} strokeWidth={2} />
                        Worktree
                      </button>
                      {selectedRun.status !== 'running' && (
                        <button
                          onClick={() => window.gt.agents.removeWorktree(selectedRun.id)}
                          title="Remove the worktree (branch/PR stay)"
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                        >
                          <Trash2 size={9} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  }
                />
                <div
                  ref={logRef}
                  className="max-h-[60vh] overflow-auto rounded-lg border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-3"
                >
                  <RunOutputView text={outputs[selectedRun.id] || ''} engine={selectedRun.engine} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
