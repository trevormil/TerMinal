import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Hand, ArrowUpRight, ChevronRight, ChevronDown, Bot, GitPullRequest, CircleDot, Play, RotateCcw, SquareTerminal, ListChecks, Check, X } from 'lucide-react'
import { Badge, badgeClasses } from './ui'
import { Markdown } from './Markdown'
import { EnginePicker } from './EnginePicker'
import { EngineLogo } from './EngineLogo'
import { EngineModelPicker } from './EngineModelPicker'
import { MrDetailView } from './MrDetail'
import { SkillHint } from './SkillHint'
import { statusTone, priorityTone, typeTone, horizonTone, stateTone, verdictTone, testTone, modelTierTone } from '../lib/badges'
import { navigateTo, onNavigate } from '../lib/nav'
import { engineLabel } from '../lib/engines'
import { engineInstanceLabel, openPromptInTerminal, remoteForTabContext, type LaunchMode } from '../lib/launch'
import { useResizableWidth, ResizeHandle } from './ResizeHandle'
import { fileTicketPrompt, ticketImplementationPrompt } from '../lib/agentPrompts'
import type { BadgeTone } from './ui'
import type { Ticket, TicketAgent, TicketAgentRecommendation, TicketRunLink, TabContext, Mr, Engine, Persona } from '../lib/types'

// A ticket's `prs:` entries are forge URLs (…/-/merge_requests/N or …/pull/N).
// Parse the change number so we can link to the in-app MR view instead of
// opening the upstream forge in a browser.
function prIidFromUrl(url: string): number | null {
  const m = url.match(/(?:\/-\/merge_requests\/|\/pull\/|\/merge_requests\/)(\d+)/)
  return m ? Number(m[1]) : null
}

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
  source === 'cron' ? 'accent' : source === 'bg' ? 'yellow' : source === 'session' ? 'green' : 'blue'

const STATUSES = ['open', 'in-progress', 'closed', 'stuck', 'icebox']
const TYPES = ['feature', 'bug', 'security', 'docs', 'dx', 'testing', 'ux', 'performance']
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const HORIZONS = ['now', 'next', 'future']
// Tickets are grouped by status (active work up top); closed/icebox start
// collapsed so you don't wade through finished tickets by default.
const STATUS_GROUPS = ['open', 'in-progress', 'stuck', 'closed', 'icebox']
const COLLAPSED_BY_DEFAULT = ['closed', 'icebox']

function ticketAgentContextId(agent?: TicketAgent): string {
  if (!agent?.id) return ''
  return agent.kind === 'persistent' ? `persistent:${agent.id}` : `agent:${agent.id}`
}

function contextToTicketAgent(context: Persona | undefined): TicketAgent | null {
  if (!context?.agentId || !context.agentScope || !context.agentKind) return null
  return { id: context.agentId, scope: context.agentScope, kind: context.agentKind }
}

function FieldSelect({
  value,
  options,
  tone,
  onChange,
}: {
  value: string
  options: string[]
  tone: BadgeTone
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // field-sizing:content makes the <select> hug the selected value instead of
      // sizing to its widest option ("in-progress"/"critical") — kills the
      // trailing min-width padding on short values like "open".
      className={`cursor-pointer appearance-none rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none [field-sizing:content] ${badgeClasses(tone)}`}
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-[var(--gt-panel)] normal-case text-zinc-200">
          {o}
        </option>
      ))}
    </select>
  )
}

// Acceptance criteria: the strict checklist a lane must satisfy to be eligible
// (tests pass + every criterion met) before lanes are ranked. Editable inline,
// one criterion per line; persisted to ticket frontmatter as a block list.
function AcceptanceSection({
  criteria,
  slug,
  onSaved,
}: {
  criteria: string[]
  slug: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const open = () => {
    setDraft(criteria.join('\n'))
    setEditing(true)
  }
  const save = async () => {
    setSaving(true)
    const next = draft
      .split('\n')
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean)
    await window.gt.tickets.update(slug, { acceptance: next })
    setSaving(false)
    setEditing(false)
    onSaved()
  }

  if (editing) {
    return (
      <div className="mb-3 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-zinc-500">
          <ListChecks size={12} strokeWidth={2} /> Acceptance criteria — one per line
        </div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(3, draft.split('\n').length + 1)}
          placeholder={'join endpoint returns 429 over the rate limit\nlimit configurable via env, default 60/min\nexisting auth tests still pass'}
          className="w-full resize-y rounded-md border border-[var(--gt-border)] bg-[var(--gt-bg)] p-2 font-mono text-[12px] text-zinc-100 outline-none focus:border-[var(--gt-accent)]/60"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] text-[var(--gt-accent)] hover:bg-[var(--gt-accent)]/20 disabled:opacity-50"
          >
            <Check size={12} strokeWidth={2.5} /> Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            <X size={12} strokeWidth={2.5} /> Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-zinc-500">
        <ListChecks size={12} strokeWidth={2} /> Acceptance criteria
        <button
          onClick={open}
          className="ml-1 inline-flex items-center gap-0.5 rounded border border-[var(--gt-border)] px-1 py-0.5 text-[10px] normal-case text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
        >
          {criteria.length ? 'edit' : (
            <>
              <Plus size={10} strokeWidth={2.5} /> add
            </>
          )}
        </button>
      </div>
      {criteria.length ? (
        <ul className="space-y-1">
          {criteria.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-zinc-300">
              <Check size={13} strokeWidth={2.5} className="mt-0.5 shrink-0 text-[var(--gt-accent-2)]" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[11.5px] text-zinc-600">
          None yet. Required before running more than one implementation lane — lanes
          are gated and ranked against these.
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function NewTicketModal({
  ctx,
  onClose,
}: {
  ctx: TabContext
  onClose: () => void
}) {
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
      const r = await window.gt.tickets.spawn(text, spawnEngine, spawnModel, remoteForTabContext(ctx))
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[620px] flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-100">New ticket</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5">
            cancel
          </button>
        </div>
        <SkillHint>
          {ctx.ticketProvider === 'local' ? (
            <>
              You can also file from the terminal with <code className="font-mono text-zinc-300">/ticket</code> in Claude or{' '}
              <code className="font-mono text-zinc-300">$ticket</code> in Codex.
            </>
          ) : (
            <>
              This repo files tickets to <code className="font-mono text-zinc-300">{ctx.ticketProviderLabel}</code>. New-ticket agents will use the configured provider instead of local backlog files.
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
              {spawning ? <Bot size={13} strokeWidth={2} /> : <EngineLogo engine={spawnEngine} size={13} />}
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
  const [fType, setFType] = useState('all')
  const [fHorizon, setFHorizon] = useState('all')
  const [fHitl, setFHitl] = useState(false)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(COLLAPSED_BY_DEFAULT))
  const [pickImpl, setPickImpl] = useState(false)
  const [started, setStarted] = useState(false)
  const [mrByIid, setMrByIid] = useState<Map<number, Mr>>(() => new Map())
  const [viewMrIid, setViewMrIid] = useState<number | null>(null)
  const [agentContexts, setAgentContexts] = useState<Persona[]>([])
  const [agentRecommendation, setAgentRecommendation] = useState<TicketAgentRecommendation | null>(null)
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

  const filtered = (tickets || []).filter((t) => {
    if (hitlOnly && !t.hitl) return false
    if (!hitlOnly) {
      if (fType !== 'all' && t.type !== fType) return false
      if (fHorizon !== 'all' && t.horizon !== fHorizon) return false
      if (fHitl && !t.hitl) return false
    }
    if (q && !(t.title.toLowerCase().includes(q.toLowerCase()) || String(t.id).includes(q))) return false
    return true
  })
  const selected = tickets?.find((t) => t.slug === sel) || null
  useEffect(() => {
    let alive = true
    if (!selected) {
      setAgentRecommendation(null)
      return
    }
    window.gt.tickets
      .recommendAgent({ title: selected.title, type: selected.type, body: selected.body })
      .then((r) => {
        if (alive) setAgentRecommendation(r)
      })
      .catch(() => {
        if (alive) setAgentRecommendation(null)
      })
    return () => {
      alive = false
    }
  }, [selected?.slug, selected?.title, selected?.type, selected?.body])

  // group filtered tickets by status, active statuses first
  const rank = (s: string) => (STATUS_GROUPS.indexOf(s) < 0 ? 99 : STATUS_GROUPS.indexOf(s))
  const groups = [...new Set(filtered.map((t) => t.status))]
    .sort((a, b) => rank(a) - rank(b))
    .map((status) => ({ status, items: filtered.filter((t) => t.status === status) }))
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
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar: type/horizon filters (left) + search / New (right). Status is
          the grouping axis now, so no status chips here. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] px-4 py-2">
        {!hitlOnly && (
          <>
            <Badge tone="mute">{ctx.ticketProviderLabel || 'Local backlog'}</Badge>
            <span className="mx-1 text-zinc-700">·</span>
            <Chip active={fType === 'all'} onClick={() => setFType('all')}>
              any type
            </Chip>
            {TYPES.map((t) => (
              <Chip key={t} active={fType === t} onClick={() => setFType(t)}>
                {t}
              </Chip>
            ))}
            <span className="mx-1 text-zinc-700">·</span>
            {HORIZONS.map((h) => (
              <Chip key={h} active={fHorizon === h} onClick={() => setFHorizon(fHorizon === h ? 'all' : h)}>
                {h}
              </Chip>
            ))}
            <Chip active={fHitl} onClick={() => setFHitl((v) => !v)}>
              <span className="inline-flex items-center gap-1">
                <Hand size={11} strokeWidth={2} />
                HITL
              </span>
            </Chip>
          </>
        )}
        <div className="flex-1" />
        {!hitlOnly && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('gt.settings.open', { detail: { section: 'tickets' } }))}
            className="rounded-lg border border-[var(--gt-border)] bg-black/20 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
          >
            Configure
          </button>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search…"
          className="rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
        />
        {!hitlOnly && (
          <button
            onClick={() => {
              setCreating(true)
              setSel(null)
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 py-1 text-[12px] font-semibold text-white"
          >
            <Plus size={14} strokeWidth={2.5} />
            New
          </button>
        )}
      </div>

      {/* master-detail */}
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 overflow-y-auto border-r border-[var(--gt-border)]" style={{ width: listW.width }}>
          {tickets === null ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
          ) : ticketError ? (
            <div className="p-6 text-[12px] text-[var(--gt-red)]">{ticketError}</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-[12px] text-zinc-600">
              {hitlOnly ? 'Nothing waiting on you.' : 'No tickets match.'}
            </div>
          ) : (
            groups.map(({ status, items }) => {
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
                    <Badge tone={statusTone(status)}>{status}</Badge>
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
                          <span className="font-mono text-[11px] text-zinc-600">{t.externalKey || `#${t.id}`}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{t.title}</span>
                          {t.hitl && !hitlOnly && (
                            <Badge tone="red">
                              <Hand size={10} strokeWidth={2.25} />
                            </Badge>
                          )}
                          {t.horizon !== 'now' && <Badge tone={horizonTone(t.horizon)}>{t.horizon}</Badge>}
                          {t.modelTier !== 'auto' && (
                            <Badge tone={modelTierTone(t.modelTier)}>{t.modelTier}</Badge>
                          )}
                          <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                          {t.depends_on.length > 0 &&
                            t.depends_on.some((id) => {
                              const dep = tickets?.find((x) => x.id === id)
                              return !dep || dep.status !== 'closed'
                            }) && <Badge tone="red">blocked</Badge>}
                        </div>
                        {t.prs.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-600">
                            {t.prs.map((p) => {
                              const iid = prIidFromUrl(p)
                              if (iid == null) return null
                              const mr = mrByIid.get(iid)
                              return (
                                <span key={p} className="inline-flex items-center gap-1">
                                  <GitPullRequest size={9} strokeWidth={2} className="text-zinc-700" />
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
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <div className="p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                <span className="font-mono">{selected.externalKey || `#${selected.id}`}</span>
                <FieldSelect
                  value={selected.status}
                  options={STATUSES}
                  tone={statusTone(selected.status)}
                  onChange={async (v) => {
                    await window.gt.tickets.update(selected.slug, { status: v })
                    loadTickets()
                  }}
                />
                <Badge tone={typeTone(selected.type)}>{selected.type}</Badge>
                <FieldSelect
                  value={selected.priority}
                  options={PRIORITIES}
                  tone={priorityTone(selected.priority)}
                  onChange={async (v) => {
                    await window.gt.tickets.update(selected.slug, { priority: v })
                    loadTickets()
                  }}
                />
                <Badge tone={horizonTone(selected.horizon)}>{selected.horizon}</Badge>
                <select
                  value={ticketAgentContextId(selected.agent)}
                  onChange={async (e) => {
                    const context = agentContexts.find((a) => a.id === e.target.value)
                    const agent = contextToTicketAgent(context)
                    if (!agent) return
                    await window.gt.tickets.update(selected.slug, { agent })
                    loadTickets()
                  }}
                  className="cursor-pointer rounded-md border border-[var(--gt-border)] bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
                  title="Assigned agent for this ticket"
                >
                  {agentContexts.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[var(--gt-panel)] normal-case text-zinc-200">
                      {a.title}
                    </option>
                  ))}
                </select>
                {selected.hitl && (
                  <Badge tone="red">
                    <Hand size={10} strokeWidth={2.25} />
                    HITL
                  </Badge>
                )}
                {selected.url && (
                  <button
                    onClick={() => window.gt.openExternal(selected.url || '')}
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gt-accent-2)] hover:underline"
                  >
                    open
                    <ArrowUpRight size={10} strokeWidth={2} />
                  </button>
                )}
                {selected.status === 'stuck' && (
                  <button
                    onClick={async () => {
                      await window.gt.tickets.update(selected.slug, { status: 'open' })
                      loadTickets()
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-green)]/35 bg-[var(--gt-green)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gt-green)] hover:bg-[var(--gt-green)]/15"
                    title="Move this ticket back to open once the blocker is cleared."
                  >
                    <CircleDot size={10} strokeWidth={2.25} />
                    Unblock
                  </button>
                )}
              </div>
              {/* Only surface the recommendation when it DIFFERS from the current
                  owner — recommending the owner you already have is pure noise.
                  When it differs, keep it to one quiet, borderless line; the
                  rationale + signals live in the hover title. */}
              {agentRecommendation &&
                (selected.agent.id !== agentRecommendation.agent.id ||
                  selected.agent.scope !== agentRecommendation.agent.scope ||
                  selected.agent.kind !== agentRecommendation.agent.kind) && (
                  <div
                    className="mb-3 mt-2.5 flex items-center gap-1.5 text-[11px] text-zinc-500"
                    title={[agentRecommendation.reason, agentRecommendation.signals.join(', ')].filter(Boolean).join(' · ')}
                  >
                    <span className="text-zinc-600">Suggested owner:</span>
                    <Badge tone="accent">
                      {agentContexts.find((a) => a.agentId === agentRecommendation.agent.id && a.agentKind === agentRecommendation.agent.kind)?.title ||
                        agentRecommendation.agent.id}
                    </Badge>
                    <button
                      onClick={async () => {
                        await window.gt.tickets.update(selected.slug, { agent: agentRecommendation.agent })
                        loadTickets()
                      }}
                      className="text-[10.5px] font-semibold text-[var(--gt-accent-light)] hover:underline"
                    >
                      Apply
                    </button>
                  </div>
                )}
              <h1 className="mb-2 text-lg font-bold text-zinc-100">{selected.title}</h1>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
                {selected.created && <span>created {selected.created}</span>}
                {selected.updated && <span>updated {selected.updated}</span>}
              </div>
              {selected.depends_on.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider text-zinc-600">depends on</span>
                  {selected.depends_on.map((depId) => {
                    const dep = tickets?.find((t) => t.id === depId)
                    const blocked = dep && dep.status !== 'closed'
                    return (
                      <button
                        key={depId}
                        onClick={() => dep && setSel(dep.slug)}
                        title={
                          dep
                            ? `${dep.title} · ${dep.status}${blocked ? ' (blocking this)' : ''}`
                            : `#${depId} not found in this backlog`
                        }
                        disabled={!dep}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${
                          blocked
                            ? 'border-[var(--gt-red)]/50 bg-[var(--gt-red)]/10 text-[var(--gt-red)] hover:bg-[var(--gt-red)]/20'
                            : 'border-[var(--gt-border)] bg-[var(--gt-panel)] text-zinc-300 hover:border-[var(--gt-accent)]/50'
                        }`}
                      >
                        <span className="font-mono">#{String(depId).padStart(4, '0')}</span>
                        {dep && <span className="text-[10px] text-zinc-500">{dep.status}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
              {(selected.prs.length > 0 || selected.workedBy.length > 0) && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {selected.prs.map((p) => {
                    const iid = prIidFromUrl(p)
                    if (iid == null)
                      return (
                        <button
                          key={p}
                          onClick={() => window.gt.openExternal(p)}
                          className="inline-flex items-center gap-0.5 text-[11px] text-[var(--gt-accent-2)] hover:underline"
                        >
                          {p.replace(/^https?:\/\/[^/]+\//, '')}
                          <ArrowUpRight size={11} strokeWidth={2} />
                        </button>
                      )
                    const mr = mrByIid.get(iid)
                    return (
                      <button
                        key={p}
                        onClick={() => setViewMrIid(iid)}
                        title={`View ${ctx.forgeLabel} ${ctx.forgeSym}${iid} in-app`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-1 text-[11px] hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
                      >
                        <GitPullRequest size={12} strokeWidth={2} className="text-zinc-500" />
                        <span className="font-mono text-zinc-300">
                          {ctx.forgeSym}
                          {ctx.forgeLabel}
                          {iid}
                        </span>
                        {mr && <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>}
                        {mr?.review && <Badge tone={verdictTone(mr.review.verdict)}>{mr.review.verdict}</Badge>}
                        {mr?.review && <Badge tone={testTone(mr.review.testStatus)}>tests {mr.review.testStatus}</Badge>}
                      </button>
                    )
                  })}
                  {selected.workedBy.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500"
                      title="model(s) that wrote this MR"
                    >
                      ✍ written by {selected.workedBy.join(', ')}
                    </span>
                  )}
                </div>
              )}
              <AcceptanceSection
                criteria={selected.acceptance}
                slug={selected.slug}
                onSaved={loadTickets}
              />
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
                  <span className="text-[11px] text-[var(--gt-green)]">agent started · see the Agents tab</span>
                )}
                {selected.run && (
                  <span
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2 py-1 text-[11px] text-zinc-400"
                    title={selected.run.sessionId ? `Launched from session ${selected.run.sessionId}` : 'Last recorded ticket implementation run'}
                  >
                    <Badge tone={runSourceTone(selected.run.source)}>{selected.run.source}</Badge>
                    <span className="font-mono text-zinc-500">{selected.run.id.slice(0, 8)}</span>
                    {selected.run.status && <span className="uppercase">{selected.run.status}</span>}
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
                    onClick={() => navigateTo('terminal', { sessionId: selected.run?.sessionId || selected.run?.id, cwd: ctx.repoRoot })}
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
              {/* Run detail lives in the Runs view (via "View run" above) — the
                  ticket view stays purely ticket content. */}
              <Markdown>{selected.body}</Markdown>
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
                  onPick={async (e, persona, pipeline, model, launchMode, runContext, lanes, _harness, extraContext) => {
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
                        ticketSlug: selected.slug,
                        prompt: extraContext ? `${prompt}\n\n--- Additional context for THIS run ---\n${extraContext}` : prompt,
                        remote: remoteForTabContext(ctx),
                      })
                      return
                    }
                    const r = await window.gt.agents.runTicket(selected.slug, e, persona, pipeline, model, remoteForTabContext(ctx), lanes, extraContext)
                    if (!('error' in r)) {
                      setStarted(true)
                      loadTickets()
                      setTimeout(() => setStarted(false), 4000)
                    }
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              {hitlOnly ? 'Select an item to view it.' : 'Select a ticket, or create a new one.'}
            </div>
          )}
        </div>
      </div>
      {creating && (
        <NewTicketModal
          ctx={ctx}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}
