import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Hand, ArrowUpRight, CircleDot, ListChecks, Check, X, Bot } from 'lucide-react'
import { Badge, badgeClasses } from './ui'
import { Markdown } from './Markdown'
import { DetailTabs } from './DetailTabs'
import { TicketLineagePanel, useTicketLineage, lineageTabCount } from './TicketLineagePanel'
import { groupLogEntries } from '../lib/ticketLog'
import { logTimestamp, fullTimestamp } from '../lib/time'
import {
  activeTicketDetailTab,
  ticketDetailTabs,
  type TicketDetailSelection,
} from '../lib/detailTabs'
import { statusTone, priorityTone, typeTone, horizonTone } from '../lib/badges'
import type { BadgeTone } from './ui'
import type {
  Ticket,
  TicketAgent,
  TicketAgentRecommendation,
  TicketComment,
  Mr,
  Persona,
} from '../lib/types'

const STATUSES = ['open', 'in-progress', 'closed', 'stuck', 'icebox']
const PRIORITIES = ['critical', 'high', 'medium', 'low']

export function ticketAgentContextId(agent?: TicketAgent): string {
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
          placeholder={
            'join endpoint returns 429 over the rate limit\nlimit configurable via env, default 60/min\nexisting auth tests still pass'
          }
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
          {criteria.length ? (
            'Edit'
          ) : (
            <>
              <Plus size={10} strokeWidth={2.5} /> Add
            </>
          )}
        </button>
      </div>
      {criteria.length ? (
        <ul className="space-y-1">
          {criteria.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-zinc-300">
              <Check
                size={13}
                strokeWidth={2.5}
                className="mt-0.5 shrink-0 text-[var(--gt-accent-2)]"
              />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[11.5px] text-zinc-600">
          None yet. Required before running more than one implementation lane — lanes are gated and
          ranked against these.
        </div>
      )}
    </div>
  )
}

// One row of ticket-to-ticket relations (blocks / related / duplicate of).
// Renders nothing when empty so a ticket with no relations stays uncluttered.
// `depends_on` keeps its own bespoke row — only that one flags a live blocker.
function RelationRow({
  label,
  ids,
  allTickets,
  onSelectTicket,
}: {
  label: string
  ids: number[]
  allTickets?: Ticket[] | null
  onSelectTicket?: (slug: string) => void
}) {
  if (ids.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[10.5px] uppercase tracking-wider text-zinc-600">{label}</span>
      {ids.map((id) => {
        const t = allTickets?.find((x) => x.id === id)
        return (
          <button
            key={id}
            onClick={() => t && onSelectTicket?.(t.slug)}
            title={t ? `${t.title} · ${t.status}` : `#${id} not found in this backlog`}
            disabled={!t}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-0.5 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-mono">#{String(id).padStart(4, '0')}</span>
            {t && <span className="text-[10px] text-zinc-500">{t.status}</span>}
          </button>
        )
      })}
    </div>
  )
}

// A ticket's comment log, rendered as a thread. Not a collaboration feature —
// it is the durable per-ticket context that survives between agent runs, so an
// entry's voice (which human, or which agent on which model) is the thing the
// layout leads with.
function LogSection({
  comments,
  slug,
  onSaved,
}: {
  comments: TicketComment[]
  slug: string
  onSaved: () => void
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // Relative stamps go stale while you sit on a ticket watching a run work it.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const post = async () => {
    const body = draft.trim()
    if (!body || saving) return
    setSaving(true)
    try {
      if (await window.gt.tickets.comment(slug, { body })) {
        setDraft('')
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  const blocks = groupLogEntries(comments)

  return (
    // The tab strip already names this pane and counts it, so the section owns
    // nothing but the thread and its composer.
    <div>
      {blocks.length > 0 && (
        <div className="mb-4">
          {blocks.map((b, bi) => (
            <div key={`${b.at}:${bi}`} className="relative flex gap-2.5 pb-3">
              {/* Rail: avatar plus a connector down to the next block, so the
                  log reads as one thread rather than a stack of cards. */}
              <div className="flex w-6 shrink-0 flex-col items-center">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    b.kind === 'agent'
                      ? 'border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)]'
                      : 'border-[var(--gt-border)] bg-[var(--gt-panel)] text-zinc-400'
                  }`}
                  title={b.kind === 'agent' ? `agent ${b.author}` : b.author}
                >
                  {b.kind === 'agent' ? (
                    <Bot size={12} strokeWidth={2.25} />
                  ) : (
                    b.author.slice(0, 1).toUpperCase()
                  )}
                </div>
                {bi < blocks.length - 1 && (
                  <div className="mt-1 w-px flex-1 bg-[var(--gt-border)]" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    className={`text-[12px] font-semibold ${
                      b.kind === 'agent' ? 'text-[var(--gt-accent-light)]' : 'text-zinc-200'
                    }`}
                  >
                    {b.author}
                  </span>
                  {b.via && <span className="font-mono text-[10px] text-zinc-600">{b.via}</span>}
                  <span className="text-[10.5px] text-zinc-600" title={fullTimestamp(b.at)}>
                    {logTimestamp(b.at)}
                  </span>
                </div>
                {b.entries.map((c, i) => (
                  <div key={`${c.at}:${i}`} className="group mt-1 flex gap-2">
                    <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-zinc-300">
                      <Markdown>{c.body}</Markdown>
                    </div>
                    {/* Grouped entries lose their own header, so surface each
                        one's real time on hover — the block stamp is the
                        block's start, not this entry's. */}
                    {i > 0 && (
                      <span
                        className="shrink-0 pt-0.5 text-[10px] text-transparent transition-colors group-hover:text-zinc-600"
                        title={fullTimestamp(c.at)}
                      >
                        {logTimestamp(c.at)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2.5">
        <div className="w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void post()
            }}
            rows={2}
            placeholder="Leave a note — agents working this ticket read it. ⌘↵ to post."
            className="w-full resize-y rounded-lg border border-[var(--gt-border)] bg-black/30 px-2.5 py-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              onClick={post}
              disabled={!draft.trim() || saving}
              className="rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20 disabled:opacity-40"
            >
              {saving ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The formatted ticket detail pane. A pinned identity header (id, status,
 * priority, owner, title) stays visible above three horizontal tabs:
 *
 *   Ticket  — the default. Relations, acceptance criteria, body. What you
 *             opened the ticket to read, sharing space with nothing.
 *   Lineage — the changes this ticket produced and the runs that worked it.
 *   Log     — the comment thread and its composer.
 *
 * Extracted from TicketsBrowser so the Tickets tab and the cockpit widget's
 * in-place modal render the same content from one place. The host must give
 * this a bounded height (it manages its own scrolling).
 *
 * `children` is the caller-specific action row (Implement → PR, run buttons in
 * the tab) rendered on the Ticket tab. When `onViewMr` is absent, PR links open
 * in the external browser instead of the in-app MR view.
 */
export function TicketDetail({
  ticket,
  allTickets,
  agentContexts,
  mrByIid,
  forgeLabel,
  forgeSym,
  repoRoot,
  onChanged,
  onSelectTicket,
  onViewMr,
  children,
}: {
  ticket: Ticket
  allTickets: Ticket[] | null
  agentContexts: Persona[]
  mrByIid: Map<number, Mr>
  forgeLabel: string
  forgeSym: string
  /** Active repo — scopes the Lineage tab's runs, whose source store is global. */
  repoRoot: string
  onChanged: () => void
  onSelectTicket?: (slug: string) => void
  onViewMr?: (iid: number) => void
  children?: ReactNode
}) {
  const selected = ticket
  const [agentRecommendation, setAgentRecommendation] = useState<TicketAgentRecommendation | null>(
    null,
  )
  useEffect(() => {
    let alive = true
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
  }, [selected.slug, selected.title, selected.type, selected.body])

  // A tab choice belongs to the ticket it was made on, so a different ticket
  // always opens on its own content. Derived rather than reset in an effect —
  // an effect would render one frame of the previous ticket's tab first.
  const [tabSelection, setTabSelection] = useState<TicketDetailSelection | null>(null)
  const tab = activeTicketDetailTab(tabSelection, selected.slug)
  const lineage = useTicketLineage(selected, repoRoot)
  const tabs = ticketDetailTabs({
    lineageCount: lineageTabCount(selected, lineage),
    logCount: (selected.comments || []).length,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-5 pb-3 pt-5">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
          <span className="font-mono">{selected.externalKey || `#${selected.id}`}</span>
          <FieldSelect
            value={selected.status}
            options={STATUSES}
            tone={statusTone(selected.status)}
            onChange={async (v) => {
              await window.gt.tickets.update(selected.slug, { status: v })
              onChanged()
            }}
          />
          <Badge tone={typeTone(selected.type)}>{selected.type}</Badge>
          <FieldSelect
            value={selected.priority}
            options={PRIORITIES}
            tone={priorityTone(selected.priority)}
            onChange={async (v) => {
              await window.gt.tickets.update(selected.slug, { priority: v })
              onChanged()
            }}
          />
          {selected.horizon !== 'now' && (
            <Badge tone={horizonTone(selected.horizon)}>{selected.horizon}</Badge>
          )}
          {selected.provider === 'obsidian' && (
            <button
              onClick={() => window.gt.tickets.openInObsidian(selected.slug)}
              title="Open this ticket in Obsidian"
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10.5px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-200"
            >
              <ArrowUpRight size={11} strokeWidth={2} />
              Obsidian
            </button>
          )}
          <select
            value={ticketAgentContextId(selected.agent)}
            onChange={async (e) => {
              const context = agentContexts.find((a) => a.id === e.target.value)
              const agent = contextToTicketAgent(context)
              if (!agent) return
              await window.gt.tickets.update(selected.slug, { agent })
              onChanged()
            }}
            className="cursor-pointer rounded-md border border-[var(--gt-border)] bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
            title="Assigned agent for this ticket"
          >
            {agentContexts.map((a) => (
              <option
                key={a.id}
                value={a.id}
                className="bg-[var(--gt-panel)] normal-case text-zinc-200"
              >
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
                onChanged()
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
              title={[agentRecommendation.reason, agentRecommendation.signals.join(', ')]
                .filter(Boolean)
                .join(' · ')}
            >
              <span className="text-zinc-600">Suggested owner:</span>
              <Badge tone="accent">
                {agentContexts.find(
                  (a) =>
                    a.agentId === agentRecommendation.agent.id &&
                    a.agentKind === agentRecommendation.agent.kind,
                )?.title || agentRecommendation.agent.id}
              </Badge>
              <button
                onClick={async () => {
                  await window.gt.tickets.update(selected.slug, {
                    agent: agentRecommendation.agent,
                  })
                  onChanged()
                }}
                className="text-[10.5px] font-semibold text-[var(--gt-accent-light)] hover:underline"
              >
                Apply
              </button>
            </div>
          )}
        <h1 className="mb-2 text-lg font-bold text-zinc-100">{selected.title}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
          {selected.created && <span>created {selected.created}</span>}
          {selected.updated && <span>updated {selected.updated}</span>}
        </div>
      </div>

      <DetailTabs
        tabs={tabs}
        active={tab}
        onSelect={(id) => setTabSelection({ slug: selected.slug, tab: id })}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'ticket' && (
          <div className="px-5 pb-6 pt-4">
            {selected.depends_on.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] uppercase tracking-wider text-zinc-600">
                  depends on
                </span>
                {selected.depends_on.map((depId) => {
                  const dep = allTickets?.find((t) => t.id === depId)
                  const blocked = dep && dep.status !== 'closed'
                  return (
                    <button
                      key={depId}
                      onClick={() => dep && onSelectTicket?.(dep.slug)}
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
            {/* The other three relations. `blocks` is derived from every other
          ticket's depends_on rather than stored, so the two directions of one
          dependency can never disagree. */}
            <RelationRow
              label="blocks"
              ids={(allTickets || [])
                .filter((t) => t.depends_on.includes(selected.id))
                .map((t) => t.id)}
              allTickets={allTickets}
              onSelectTicket={onSelectTicket}
            />
            <RelationRow
              label="related"
              ids={selected.related || []}
              allTickets={allTickets}
              onSelectTicket={onSelectTicket}
            />
            <RelationRow
              label="duplicate of"
              ids={selected.duplicateOf ? [selected.duplicateOf] : []}
              allTickets={allTickets}
              onSelectTicket={onSelectTicket}
            />
            <AcceptanceSection
              criteria={selected.acceptance}
              slug={selected.slug}
              onSaved={onChanged}
            />
            {children}
            <Markdown>{selected.body}</Markdown>
          </div>
        )}

        {tab === 'lineage' && (
          <TicketLineagePanel
            ticket={selected}
            repoRoot={repoRoot}
            lineage={lineage}
            mrByIid={mrByIid}
            forgeLabel={forgeLabel}
            forgeSym={forgeSym}
            onViewMr={onViewMr}
          />
        )}

        {tab === 'log' && (
          <div className="px-5 pb-6 pt-4">
            <LogSection
              comments={selected.comments || []}
              slug={selected.slug}
              onSaved={onChanged}
            />
          </div>
        )}
      </div>
    </div>
  )
}
