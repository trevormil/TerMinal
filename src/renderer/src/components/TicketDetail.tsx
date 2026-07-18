import { useEffect, useState, type ReactNode } from 'react'
import {
  Plus,
  Hand,
  ArrowUpRight,
  CircleDot,
  GitPullRequest,
  ListChecks,
  Check,
  X,
} from 'lucide-react'
import { Badge, badgeClasses } from './ui'
import { Markdown } from './Markdown'
import {
  statusTone,
  priorityTone,
  typeTone,
  horizonTone,
  stateTone,
  verdictTone,
  testTone,
} from '../lib/badges'
import type { BadgeTone } from './ui'
import type { Ticket, TicketAgent, TicketAgentRecommendation, Mr, Persona } from '../lib/types'

// A ticket's `prs:` entries are forge URLs (…/-/merge_requests/N or …/pull/N).
// Parse the change number so we can link to the in-app MR view instead of
// opening the upstream forge in a browser.
export function prIidFromUrl(url: string): number | null {
  const m = url.match(/(?:\/-\/merge_requests\/|\/pull\/|\/merge_requests\/)(\d+)/)
  return m ? Number(m[1]) : null
}

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
            'edit'
          ) : (
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

/**
 * The formatted ticket detail pane — header badges (status/priority/type/agent),
 * suggested-owner row, depends_on chips, PR list, acceptance criteria, and the
 * markdown body. Extracted from TicketsBrowser so the Tickets tab and the
 * cockpit widget's in-place modal render the same content from one place.
 *
 * `children` is the caller-specific action row (Implement → PR, run buttons in
 * the tab) rendered between the acceptance section and the body. When `onViewMr`
 * is absent, PR links open in the external browser instead of the in-app MR view.
 */
export function TicketDetail({
  ticket,
  allTickets,
  agentContexts,
  mrByIid,
  forgeLabel,
  forgeSym,
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

  return (
    <div className="p-5">
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
        <Badge tone={horizonTone(selected.horizon)}>{selected.horizon}</Badge>
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
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
        {selected.created && <span>created {selected.created}</span>}
        {selected.updated && <span>updated {selected.updated}</span>}
      </div>
      {selected.depends_on.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-wider text-zinc-600">depends on</span>
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
                onClick={() => (onViewMr ? onViewMr(iid) : window.gt.openExternal(p))}
                title={
                  onViewMr
                    ? `View ${forgeLabel} ${forgeSym}${iid} in-app`
                    : `Open ${forgeLabel} ${forgeSym}${iid} in the browser`
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-1 text-[11px] hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
              >
                <GitPullRequest size={12} strokeWidth={2} className="text-zinc-500" />
                <span className="font-mono text-zinc-300">
                  {forgeSym}
                  {forgeLabel}
                  {iid}
                </span>
                {mr && <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>}
                {mr?.review && (
                  <Badge tone={verdictTone(mr.review.verdict)}>{mr.review.verdict}</Badge>
                )}
                {mr?.review && (
                  <Badge tone={testTone(mr.review.testStatus)}>tests {mr.review.testStatus}</Badge>
                )}
              </button>
            )
          })}
          {selected.workedBy.length > 0 && (
            <span
              className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500"
              title="Model(s) that wrote this MR"
            >
              ✍ written by {selected.workedBy.join(', ')}
            </span>
          )}
        </div>
      )}
      <AcceptanceSection criteria={selected.acceptance} slug={selected.slug} onSaved={onChanged} />
      {children}
      {/* Run detail lives in the Runs view (via "View run" above) — the
          ticket view stays purely ticket content. */}
      <Markdown>{selected.body}</Markdown>
    </div>
  )
}
