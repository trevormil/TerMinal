import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Plus,
  Hand,
  ChevronRight,
  ChevronDown,
  Bot,
  GitPullRequest,
  Play,
  RotateCcw,
  SquareTerminal,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { Badge } from './ui'
import { EnginePicker } from './EnginePicker'
import { EngineLogo } from './EngineLogo'
import { EngineModelPicker } from './EngineModelPicker'
import { MrDetailView } from './MrDetail'
import { SkillHint } from './SkillHint'
import { TicketDetail } from './TicketDetail'
import {
  LinearAssignee,
  LinearLabelChips,
  LinearPriorityChip,
  LinearStateChip,
} from './LinearBadges'
import { prIidFromUrl } from './TicketLineagePanel'
import { ticketAgentContextId } from '../lib/ticketOwner'
import {
  statusTone,
  priorityTone,
  horizonTone,
  stateTone,
  verdictTone,
  modelTierTone,
} from '../lib/badges'
import { navigateTo, onNavigate } from '../lib/nav'
import { engineLabel } from '../lib/engines'
import {
  engineInstanceLabel,
  openPromptInTerminal,
  remoteForTabContext,
  type LaunchMode,
} from '../lib/launch'
import { useResizableWidth, ResizeHandle } from './ResizeHandle'
import { fileTicketPrompt, ticketImplementationPrompt } from '../lib/agentPrompts'
import type { BadgeTone } from './ui'
import {
  DEFAULT_TICKET_VIEW,
  activeTicketFilterCount,
  filterTickets,
  groupTickets,
  ticketFilterRailStorageKey,
  type TicketViewSpec,
} from '../lib/ticketViews'
import type { Ticket, TicketRunLink, TabContext, Mr, Engine, Persona } from '../lib/types'

// Subtle text color (no badge chrome) for a BadgeTone — used by the ticket MR
// rows so the state/verdict/tests read as quiet inline text, not loud chips.
const TONE_TEXT: Record<BadgeTone, string> = {
  ok: 'text-[var(--gt-green)]',
  green: 'text-[var(--gt-green)]',
  warn: 'text-[var(--gt-yellow)]',
  yellow: 'text-[var(--gt-yellow)]',
  bad: 'text-[var(--gt-red)]',
  red: 'text-[var(--gt-red)]',
  blue: 'text-[var(--gt-blue)]',
  accent: 'text-[var(--gt-accent-light)]',
  mute: 'text-zinc-500',
}

const runSourceTone = (source: TicketRunLink['source']): BadgeTone =>
  source === 'cron'
    ? 'accent'
    : source === 'bg'
      ? 'yellow'
      : source === 'session'
        ? 'green'
        : 'blue'

const TYPES = ['feature', 'bug', 'security', 'docs', 'dx', 'testing', 'ux', 'performance']
const HORIZONS = ['now', 'next', 'future']
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const STATUSES = ['open', 'in-progress', 'stuck', 'closed', 'icebox']
const TYPE_LABELS: Record<string, string> = {
  bug: 'Bug',
  feature: 'Feature',
  security: 'Security',
  docs: 'Docs',
  ci: 'CI',
  dx: 'DX',
  testing: 'Testing',
  ux: 'UX',
  performance: 'Performance',
}
const HORIZON_LABELS: Record<string, string> = {
  now: 'Now',
  next: 'Next',
  future: 'Future',
}
const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  stuck: 'Stuck',
  closed: 'Closed',
  icebox: 'Icebox',
}
const GROUP_LABELS: Record<TicketViewSpec['groupBy'], string> = {
  status: 'By status',
  priority: 'By priority',
  type: 'By type',
  horizon: 'By horizon',
  agent: 'By agent',
  none: 'No grouping',
}
const SORT_LABELS: Record<TicketViewSpec['sortBy'], string> = {
  'id-desc': 'Newest',
  'id-asc': 'Oldest',
  'updated-desc': 'Updated',
  priority: 'Priority',
}
const labelFrom = (labels: Record<string, string>, value: string) =>
  labels[value] || value.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
const ticketGroupLabel = (groupBy: TicketViewSpec['groupBy'], key: string) => {
  if (groupBy === 'status') return labelFrom(STATUS_LABELS, key)
  if (groupBy === 'priority') return labelFrom(PRIORITY_LABELS, key)
  if (groupBy === 'type') return labelFrom(TYPE_LABELS, key)
  if (groupBy === 'horizon') return labelFrom(HORIZON_LABELS, key)
  if (groupBy === 'none') return 'All tickets'
  return labelFrom({}, key)
}
// Group ordering lives in ticketViews.ts. These groups start collapsed so you
// don't wade through finished tickets by default.
const COLLAPSED_BY_DEFAULT = ['closed', 'icebox']

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
          : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function NewTicketModal({ ctx, onClose }: { ctx: TabContext; onClose: () => void }) {
  const [spawnText, setSpawnText] = useState('')
  const [spawnEngine, setSpawnEngine] = useState<Engine>('claude')
  const [spawnModel, setSpawnModel] = useState<string | undefined>(undefined)
  const [launchMode, setLaunchMode] = useState<LaunchMode>('terminal')
  const [spawning, setSpawning] = useState(false)
  const [spawnMsg, setSpawnMsg] = useState('')
  useEffect(() => {
    window.gt.settings.get().then((s) => setSpawnEngine(s.defaultEngine))
  }, [])

  const doSpawn = async () => {
    const text = spawnText.trim()
    if (!text || spawning) return
    setSpawning(true)
    try {
      if (launchMode === 'terminal') {
        openPromptInTerminal({
          engine: spawnEngine,
          cwd: ctx.repoRoot,
          name: `File ticket`,
          prompt: fileTicketPrompt(text, {
            model: spawnModel,
            ticketProvider: ctx.ticketProvider,
            ticketProviderLabel: ctx.ticketProviderLabel,
          }),
          remote: remoteForTabContext(ctx),
        })
        setSpawnText('')
        setTimeout(onClose, 250)
        return
      }
      const r = await window.gt.tickets.spawn(
        text,
        spawnEngine,
        spawnModel,
        remoteForTabContext(ctx),
      )
      if (r && 'error' in r) setSpawnMsg(`couldn't start: ${r.error}`)
      else {
        setSpawnText('')
        setSpawnMsg(`${engineLabel(spawnEngine)} is filing the ticket · watch the Agents tab`)
        setTimeout(onClose, 900)
      }
    } finally {
      setSpawning(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[620px] flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-100">New ticket</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
        <SkillHint>
          {ctx.ticketProvider === 'local' ? (
            <>
              You can also file from the terminal with{' '}
              <code className="font-mono text-zinc-300">/ticket</code> in Claude or{' '}
              <code className="font-mono text-zinc-300">$ticket</code> in Codex.
            </>
          ) : (
            <>
              This repo files tickets to{' '}
              <code className="font-mono text-zinc-300">{ctx.ticketProviderLabel}</code>. New-ticket
              agents will use the configured provider instead of local backlog files.
            </>
          )}
        </SkillHint>
        <div className="space-y-3">
          <textarea
            autoFocus
            value={spawnText}
            onChange={(e) => setSpawnText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doSpawn()
            }}
            rows={5}
            placeholder="Describe the work. An agent will create the structured ticket."
            className="w-full resize-y rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
          />
          <div className="flex items-center gap-2">
            <EngineModelPicker
              engine={spawnEngine}
              model={spawnModel}
              onChange={(e, m) => {
                setSpawnEngine(e)
                setSpawnModel(m)
              }}
            />
            <select
              value={launchMode}
              onChange={(e) => setLaunchMode(e.target.value as LaunchMode)}
              className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
            >
              <option value="terminal">{engineInstanceLabel(spawnEngine)} instance</option>
              <option value="process">Process</option>
            </select>
            {spawnMsg && <span className="text-[11px] text-[var(--gt-green)]">{spawnMsg}</span>}
            <button
              onClick={doSpawn}
              disabled={!spawnText.trim() || spawning}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {spawning ? (
                <Bot size={13} strokeWidth={2} />
              ) : (
                <EngineLogo engine={spawnEngine} size={13} />
              )}
              {spawning ? 'Filing...' : launchMode === 'terminal' ? 'Open instance' : 'File ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The ticket master-detail (list + detail + new-ticket form + filters), shared
 * by the Tickets tab and the HITL tab. `hitlOnly` locks the view to tickets
 * flagged `hitl: true` and trims the chrome (no type/horizon filters, no create).
 */
export function TicketsBrowser({ ctx, hitlOnly = false }: { ctx: TabContext; hitlOnly?: boolean }) {
  const listW = useResizableWidth('gt.ticketsListWidth', 460, { min: 280, max: 760, edge: 'right' })
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [ticketError, setTicketError] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // One spec drives filtering, grouping and sorting so toolbar and rail state
  // can't drift apart.
  const [view, setView] = useState<TicketViewSpec>(DEFAULT_TICKET_VIEW)
  const patchView = (p: Partial<TicketViewSpec>) => setView((v) => ({ ...v, ...p }))
  const filterRailKey = ticketFilterRailStorageKey(ctx.repoRoot)
  const [filterRailCollapsed, setFilterRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(filterRailKey) === '1'
    } catch {
      return false
    }
  })
  const filterRailToggleRef = useRef<HTMLButtonElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(COLLAPSED_BY_DEFAULT))
  const [pickImpl, setPickImpl] = useState(false)
  const [started, setStarted] = useState(false)
  const [mrByIid, setMrByIid] = useState<Map<number, Mr>>(() => new Map())
  const [viewMrIid, setViewMrIid] = useState<number | null>(null)
  const [agentContexts, setAgentContexts] = useState<Persona[]>([])
  const loadTickets = () =>
    window.gt.tickets
      .list()
      .then((list) => {
        setTicketError('')
        setTickets(list)
      })
      .catch((e) => {
        setTicketError(e?.message || 'Could not load tickets')
        setTickets([])
      })
  useEffect(() => {
    loadTickets()
    window.gt.agents.personas().then(setAgentContexts)
    // Enrich ticket MR links with live state/verdict badges. All-states list, so
    // merged/closed MRs (the common case for a closed ticket) resolve too.
    window.gt
      .listMrs()
      .then((r) => setMrByIid(new Map((r.mrs || []).map((m) => [m.iid, m]))))
      .catch(() => setMrByIid(new Map()))
  }, [ctx.sessionId])
  useEffect(() => {
    try {
      localStorage.setItem(filterRailKey, filterRailCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [filterRailCollapsed, filterRailKey])

  // Refresh the list when a ticket is filed/closed anywhere (e.g. the spawn
  // agent finishing) so a spawned ticket appears without a manual reload.
  useEffect(() => {
    const off = window.gt.activity.onEvent((ev) => {
      if (
        ev.kind === 'ticket-filed' ||
        ev.kind === 'ticket-closed' ||
        ev.kind === 'session-start' ||
        ev.kind === 'session-end' ||
        ev.title.startsWith('Ticket ')
      ) {
        loadTickets()
      }
    })
    return off
  }, [])

  useEffect(() => {
    return window.gt.agents.onStatus((run) => {
      if (run.status !== 'running') loadTickets()
    })
  }, [])

  // Cross-tab nav: when HITL (or any other tab) calls navigateTo('tickets',
  // { slug }) we pre-select that ticket so the operator lands on the
  // auto-filed cron-failure ticket without scrolling.
  useEffect(() => {
    return onNavigate((ev) => {
      if (ev.tabId !== 'tickets') return
      const slug = (ev.payload?.slug as string) || ''
      if (slug) setSel(slug)
    })
  }, [])

  // The HITL view is a fixed lens on the same data: hitl-only, and none of the
  // browsing chrome, so it ignores everything but the search box.
  const effectiveView: TicketViewSpec = hitlOnly
    ? { ...DEFAULT_TICKET_VIEW, hitl: true, q: view.q }
    : view
  const hiddenFilterCount = activeTicketFilterCount(effectiveView)
  const filterRailId = `tickets-filter-rail-${ctx.sessionId}`
  const filtered = filterTickets(tickets || [], effectiveView)
  const selected = tickets?.find((t) => t.slug === sel) || null
  const groups = groupTickets(filtered, effectiveView)

  const collapseFilterRail = () => {
    setFilterRailCollapsed(true)
    requestAnimationFrame(() => filterRailToggleRef.current?.focus())
  }

  const onFilterRailKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    collapseFilterRail()
  }

  const toggleGroup = (s: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      n.has(s) ? n.delete(s) : n.add(s)
      return n
    })

  // Internal MR view — reuse the same detail pane as the MRs tab so a ticket's
  // MR opens in-app instead of bouncing to the upstream forge in a browser.
  if (viewMrIid !== null)
    return (
      <MrDetailView
        iid={viewMrIid}
        repoLabel={ctx.repoPath || 'repo'}
        label={ctx.forgeLabel}
        sym={ctx.forgeSym}
        onBack={() => setViewMrIid(null)}
      />
    )

  return (
    <div className="tickets-browser flex h-full min-h-0 flex-col overflow-hidden">
      {/* toolbar: rail disclosure, search, create, provider, and config. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        {!hitlOnly && (
          <button
            ref={filterRailToggleRef}
            onClick={() => setFilterRailCollapsed((v) => !v)}
            aria-label={filterRailCollapsed ? 'Show filters' : 'Hide filters'}
            aria-expanded={!filterRailCollapsed}
            aria-controls={filterRailId}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
          >
            {filterRailCollapsed ? (
              <PanelLeftOpen size={13} strokeWidth={2} />
            ) : (
              <PanelLeftClose size={13} strokeWidth={2} />
            )}
            Filters
            {hiddenFilterCount > 0 && (
              <span className="ml-0.5 rounded-full bg-[var(--gt-accent)] px-1.5 py-px text-[10px] font-semibold text-white">
                {hiddenFilterCount}
              </span>
            )}
          </button>
        )}
        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          <input
            value={view.q}
            onChange={(e) => patchView({ q: e.target.value })}
            placeholder="Search title, id, body…"
            className="min-w-[12rem] max-w-[24rem] flex-1 basis-52 rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
          />
          {!hitlOnly && (
            <button
              onClick={() => {
                setCreating(true)
                setSel(null)
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 py-1 text-[12px] font-semibold text-white"
            >
              <Plus size={14} strokeWidth={2.5} />
              New
            </button>
          )}
          {!hitlOnly && (
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('gt.settings.open', { detail: { section: 'tickets' } }),
                )
              }
              className="rounded-lg border border-[var(--gt-border)] bg-black/20 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
            >
              Configure
            </button>
          )}
        </div>
      </div>

      {/* filters + master-detail */}
      <div
        className="tickets-filter-body relative flex min-h-0 flex-1 overflow-hidden"
        data-rail-state={filterRailCollapsed ? 'closed' : 'open'}
      >
        {!hitlOnly && !filterRailCollapsed && (
          <>
            <button
              type="button"
              aria-label="Close filters"
              className="tickets-filter-scrim absolute inset-0 z-10 hidden bg-black/40"
              onClick={collapseFilterRail}
            />
            <div
              id={filterRailId}
              role="region"
              aria-label="Ticket filters"
              onKeyDown={onFilterRailKeyDown}
              className="tickets-filter-rail z-20 flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)] px-3 py-3"
            >
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Group
                </div>
                <select
                  value={view.groupBy}
                  onChange={(e) =>
                    patchView({ groupBy: e.target.value as TicketViewSpec['groupBy'] })
                  }
                  title="Group the list by"
                  className="w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-1.5 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
                >
                  {(['status', 'priority', 'type', 'horizon', 'agent', 'none'] as const).map(
                    (group) => (
                      <option key={group} value={group} className="bg-[var(--gt-panel)]">
                        {GROUP_LABELS[group]}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Sort
                </div>
                <select
                  value={view.sortBy}
                  onChange={(e) =>
                    patchView({ sortBy: e.target.value as TicketViewSpec['sortBy'] })
                  }
                  title="Sort within each group"
                  className="w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-1.5 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
                >
                  {(['id-desc', 'id-asc', 'updated-desc', 'priority'] as const).map((sort) => (
                    <option key={sort} value={sort} className="bg-[var(--gt-panel)]">
                      {SORT_LABELS[sort]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Type
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={view.type === 'all'} onClick={() => patchView({ type: 'all' })}>
                    Any type
                  </Chip>
                  {TYPES.map((t) => (
                    <Chip
                      key={t}
                      active={view.type === t}
                      onClick={() => patchView({ type: view.type === t ? 'all' : t })}
                    >
                      {TYPE_LABELS[t]}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Horizon
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip
                    active={view.horizon === 'all'}
                    onClick={() => patchView({ horizon: 'all' })}
                  >
                    Any horizon
                  </Chip>
                  {HORIZONS.map((h) => (
                    <Chip
                      key={h}
                      active={view.horizon === h}
                      onClick={() => patchView({ horizon: view.horizon === h ? 'all' : h })}
                    >
                      {HORIZON_LABELS[h]}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Priority
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip
                    active={view.priority === 'all'}
                    onClick={() => patchView({ priority: 'all' })}
                  >
                    Any priority
                  </Chip>
                  {PRIORITIES.map((pr) => (
                    <Chip
                      key={pr}
                      active={view.priority === pr}
                      onClick={() => patchView({ priority: view.priority === pr ? 'all' : pr })}
                    >
                      {PRIORITY_LABELS[pr]}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Status
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={view.status === 'all'} onClick={() => patchView({ status: 'all' })}>
                    Any status
                  </Chip>
                  {STATUSES.map((s) => (
                    <Chip
                      key={s}
                      active={view.status === s}
                      onClick={() => patchView({ status: view.status === s ? 'all' : s })}
                    >
                      {STATUS_LABELS[s]}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Attention
                </div>
                <Chip active={view.hitl} onClick={() => patchView({ hitl: !view.hitl })}>
                  <span className="inline-flex items-center gap-1">
                    <Hand size={11} strokeWidth={2} />
                    HITL
                  </span>
                </Chip>
              </div>
            </div>
          </>
        )}
        <div
          className="shrink-0 overflow-y-auto border-r border-[var(--gt-border)]"
          style={{ width: listW.width }}
        >
          {tickets === null ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
          ) : ticketError ? (
            <div className="p-6 text-[12px] text-[var(--gt-red)]">{ticketError}</div>
          ) : filtered.length === 0 ? (
            tickets.length === 0 && !hitlOnly ? (
              // Fresh repo: distinguish "backlog is empty" from "filters
              // matched nothing" so an empty list doesn't read as broken.
              <div className="p-6 text-[12px] leading-relaxed text-zinc-600">
                <div className="mb-1 font-semibold text-zinc-400">No tickets yet.</div>
                This is the repo's backlog — agents pick work up from here. File the first one with{' '}
                <button
                  onClick={() => {
                    setCreating(true)
                    setSel(null)
                  }}
                  className="text-[var(--gt-accent-light)] hover:underline"
                >
                  New
                </button>
                .
              </div>
            ) : (
              <div className="p-6 text-[12px] text-zinc-600">
                {hitlOnly ? 'Nothing waiting on you.' : 'No tickets match.'}
              </div>
            )
          ) : (
            groups.map(({ key: status, items }) => {
              const isOpen = !collapsed.has(status)
              return (
                <div key={status}>
                  <button
                    onClick={() => toggleGroup(status)}
                    className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/60 bg-[var(--gt-bg)] px-3 py-1.5 text-left hover:bg-white/5"
                  >
                    {isOpen ? (
                      <ChevronDown size={12} strokeWidth={2} className="text-zinc-500" />
                    ) : (
                      <ChevronRight size={12} strokeWidth={2} className="text-zinc-500" />
                    )}
                    <Badge tone={statusTone(status)}>
                      {ticketGroupLabel(effectiveView.groupBy, status)}
                    </Badge>
                    <span className="text-[11px] tabular-nums text-zinc-600">{items.length}</span>
                  </button>
                  {isOpen &&
                    items.map((t) => (
                      <button
                        key={t.slug}
                        onClick={() => {
                          setSel(t.slug)
                          setCreating(false)
                        }}
                        className={`flex w-full flex-col gap-1 border-b border-[var(--gt-border)]/40 py-2.5 pl-7 pr-4 text-left hover:bg-white/5 ${
                          sel === t.slug ? 'bg-white/5' : ''
                        }`}
                      >
                        <div className="flex w-full items-center gap-2">
                          <span className="font-mono text-[11px] text-zinc-600">
                            {t.externalKey || `#${t.id}`}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">
                            {t.title}
                          </span>
                          {t.hitl && !hitlOnly && (
                            <Badge tone="red">
                              <Hand size={10} strokeWidth={2.25} />
                            </Badge>
                          )}
                          {t.linear ? (
                            // Linear-native row chips: exact state name + color,
                            // Linear's own priority scale, assignee, labels —
                            // not the coerced md-ticket vocabulary.
                            <>
                              <LinearLabelChips labels={t.linear.labels} max={2} />
                              <LinearStateChip meta={t.linear} />
                              <LinearPriorityChip meta={t.linear} />
                              {t.linear.assignee && <LinearAssignee name={t.linear.assignee} />}
                            </>
                          ) : (
                            <>
                              {t.horizon !== 'now' && (
                                <Badge tone={horizonTone(t.horizon)}>
                                  {labelFrom(HORIZON_LABELS, t.horizon)}
                                </Badge>
                              )}
                              {t.modelTier !== 'auto' && (
                                <Badge tone={modelTierTone(t.modelTier)}>{t.modelTier}</Badge>
                              )}
                              <Badge tone={priorityTone(t.priority)}>
                                {labelFrom(PRIORITY_LABELS, t.priority)}
                              </Badge>
                            </>
                          )}
                          {t.depends_on.length > 0 &&
                            t.depends_on.some((id) => {
                              const dep = tickets?.find((x) => x.id === id)
                              return !dep || dep.status !== 'closed'
                            }) && <Badge tone="red">Blocked</Badge>}
                        </div>
                        {t.prs.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-600">
                            {t.prs.map((p) => {
                              const iid = prIidFromUrl(p)
                              if (iid == null) return null
                              const mr = mrByIid.get(iid)
                              return (
                                <span key={p} className="inline-flex items-center gap-1">
                                  <GitPullRequest
                                    size={9}
                                    strokeWidth={2}
                                    className="text-zinc-700"
                                  />
                                  <span className="text-zinc-500">
                                    {ctx.forgeSym}
                                    {ctx.forgeLabel}
                                    {iid}
                                  </span>
                                  {mr && (
                                    <span className={`uppercase ${TONE_TEXT[stateTone(mr.state)]}`}>
                                      — {mr.state}
                                    </span>
                                  )}
                                  {mr?.review?.verdict && (
                                    <span className={TONE_TEXT[verdictTone(mr.review.verdict)]}>
                                      · {mr.review.verdict}
                                    </span>
                                  )}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        {t.workedBy.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-zinc-600">
                            <span className="text-zinc-500">✍ {t.workedBy.join(', ')}</span>
                          </div>
                        )}
                      </button>
                    ))}
                </div>
              )
            })
          )}
        </div>
        <ResizeHandle onMouseDown={listW.onResizeStart} />
        {/* TicketDetail scrolls internally below its pinned header + tabs. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {selected ? (
            <TicketDetail
              ticket={selected}
              allTickets={tickets}
              agentContexts={agentContexts}
              mrByIid={mrByIid}
              forgeLabel={ctx.forgeLabel}
              forgeSym={ctx.forgeSym}
              repoRoot={ctx.repoRoot}
              onChanged={loadTickets}
              onSelectTicket={setSel}
              onViewMr={setViewMrIid}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPickImpl(true)}
                  title="Spin up an agent in a worktree to implement this ticket and open a PR"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-3 py-1 text-[12px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
                >
                  <Bot size={13} strokeWidth={2} />
                  Implement → PR
                </button>
                {started && (
                  <span className="text-[11px] text-[var(--gt-green)]">
                    agent started · see the Agents tab
                  </span>
                )}
                {selected.run && (
                  <span
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2 py-1 text-[11px] text-zinc-400"
                    title={
                      selected.run.sessionId
                        ? `Launched from session ${selected.run.sessionId}`
                        : 'Last recorded ticket implementation run'
                    }
                  >
                    <Badge tone={runSourceTone(selected.run.source)}>{selected.run.source}</Badge>
                    <span className="font-mono text-zinc-500">{selected.run.id.slice(0, 8)}</span>
                    {selected.run.status && (
                      <span className="uppercase">{selected.run.status}</span>
                    )}
                  </span>
                )}
                {selected.run && (
                  <button
                    onClick={() => navigateTo('runs', { runId: selected.run?.id })}
                    title="View this ticket's recorded agent run"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
                  >
                    <Play size={12} strokeWidth={2} />
                    View run
                  </button>
                )}
                {selected.run?.source === 'session' && (
                  <button
                    onClick={() =>
                      navigateTo('terminal', {
                        sessionId: selected.run?.sessionId || selected.run?.id,
                        cwd: ctx.repoRoot,
                      })
                    }
                    title="Focus the linked terminal session if it is still open"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
                  >
                    <SquareTerminal size={12} strokeWidth={2} />
                    Terminal
                  </button>
                )}
                {selected.run && selected.run.source !== 'session' && (
                  <button
                    onClick={async () => {
                      const r = await window.gt.agents.rerun(selected.run?.id || '')
                      if (r && !('error' in r)) {
                        await window.gt.tickets.update(selected.slug, {
                          run: {
                            id: r.id,
                            source: 'agent',
                            sessionId: ctx.sessionId,
                            startedAt: new Date(r.startedAt).toISOString(),
                            status: r.status,
                          },
                        })
                        navigateTo('runs', { runId: r.id })
                        loadTickets()
                      }
                    }}
                    title="Resume by rerunning this ticket's recorded agent run"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
                  >
                    <RotateCcw size={12} strokeWidth={2} />
                    Resume
                  </button>
                )}
              </div>
              {pickImpl && (
                <EnginePicker
                  title={`Implement ${selected.externalKey || `#${selected.id}`} → PR`}
                  showLanes
                  showExtraContext
                  initialPersona={ticketAgentContextId(selected.agent)}
                  hint={
                    <>
                      You can also start implementation from the terminal with{' '}
                      <code className="font-mono text-zinc-300">/pr-creation</code> or{' '}
                      <code className="font-mono text-zinc-300">$pr-creation</code>.
                    </>
                  }
                  onClose={() => setPickImpl(false)}
                  onPick={async (
                    e,
                    persona,
                    pipeline,
                    model,
                    launchMode,
                    runContext,
                    lanes,
                    _harness,
                    extraContext,
                    effort,
                  ) => {
                    setPickImpl(false)
                    if (launchMode === 'terminal') {
                      const prompt = ticketImplementationPrompt(selected, {
                        persona,
                        pipeline,
                        model,
                        runContext,
                        ticketProvider: ctx.ticketProvider,
                        ticketProviderLabel: ctx.ticketProviderLabel,
                      })
                      openPromptInTerminal({
                        engine: e,
                        cwd: ctx.repoRoot,
                        name: `Implement ${selected.externalKey || `#${selected.id}`}`,
                        model,
                        effort,
                        ticketSlug: selected.slug,
                        prompt: extraContext
                          ? `${prompt}\n\n--- Additional context for THIS run ---\n${extraContext}`
                          : prompt,
                        remote: remoteForTabContext(ctx),
                      })
                      return
                    }
                    const r = await window.gt.agents.runTicket(
                      selected.slug,
                      e,
                      persona,
                      pipeline,
                      model,
                      remoteForTabContext(ctx),
                      lanes,
                      extraContext,
                      effort,
                    )
                    if (!('error' in r)) {
                      setStarted(true)
                      loadTickets()
                      setTimeout(() => setStarted(false), 4000)
                    }
                  }}
                />
              )}
            </TicketDetail>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              {hitlOnly ? 'Select an item to view it.' : 'Select a ticket, or create a new one.'}
            </div>
          )}
        </div>
      </div>
      {creating && <NewTicketModal ctx={ctx} onClose={() => setCreating(false)} />}
    </div>
  )
}
