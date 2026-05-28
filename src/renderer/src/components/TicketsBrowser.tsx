import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Hand, ArrowUpRight, ChevronRight, ChevronDown } from 'lucide-react'
import { Badge, badgeClasses } from './ui'
import { Markdown } from './Markdown'
import { statusTone, priorityTone, typeTone, horizonTone } from '../lib/badges'
import type { BadgeTone } from './ui'
import type { Ticket, TabContext } from '../lib/types'

const STATUSES = ['open', 'in-progress', 'closed', 'stuck', 'icebox']
const TYPES = ['feature', 'bug', 'security', 'docs', 'dx', 'testing', 'ux', 'performance']
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const HORIZONS = ['now', 'next', 'future']
// Tickets are grouped by status (active work up top); closed/icebox start
// collapsed so you don't wade through finished tickets by default.
const STATUS_GROUPS = ['open', 'in-progress', 'stuck', 'closed', 'icebox']
const COLLAPSED_BY_DEFAULT = ['closed', 'icebox']

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

function NewTicketForm({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('feature')
  const [priority, setPriority] = useState('medium')
  const [status, setStatus] = useState('open')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const t = await window.gt.tickets.create({ title: title.trim(), type, priority, status, body })
      onCreated(t.slug)
    } finally {
      setBusy(false)
    }
  }

  const sel = 'rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-100">New ticket</h2>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5">
          cancel
        </button>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className={`${sel} w-full`}
      />
      <div className="grid grid-cols-3 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={sel}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="## Description&#10;…&#10;&#10;## Acceptance criteria&#10;- …"
        rows={10}
        className={`${sel} w-full resize-none font-mono`}
      />
      <button
        onClick={submit}
        disabled={!title.trim() || busy}
        className="rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Creating…' : 'Create ticket'}
      </button>
    </div>
  )
}

/**
 * The ticket master-detail (list + detail + new-ticket form + filters), shared
 * by the Tickets tab and the HITL tab. `hitlOnly` locks the view to tickets
 * flagged `hitl: true` and trims the chrome (no type/horizon filters, no create).
 */
export function TicketsBrowser({ ctx, hitlOnly = false }: { ctx: TabContext; hitlOnly?: boolean }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [fType, setFType] = useState('all')
  const [fHorizon, setFHorizon] = useState('all')
  const [fHitl, setFHitl] = useState(false)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(COLLAPSED_BY_DEFAULT))

  const loadTickets = () => window.gt.tickets.list().then(setTickets)
  useEffect(() => {
    loadTickets()
  }, [ctx.sessionId])

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar: type/horizon filters (left) + search / New (right). Status is
          the grouping axis now, so no status chips here. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] px-4 py-2">
        {!hitlOnly && (
          <>
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
        <div className="w-[42%] min-w-[280px] overflow-y-auto border-r border-[var(--gt-border)]">
          {tickets === null ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
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
                        className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 py-2.5 pl-7 pr-4 text-left hover:bg-white/5 ${
                          sel === t.slug ? 'bg-white/5' : ''
                        }`}
                      >
                        <span className="font-mono text-[11px] text-zinc-600">#{t.id}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{t.title}</span>
                        {t.hitl && !hitlOnly && (
                          <Badge tone="red">
                            <Hand size={10} strokeWidth={2.25} />
                          </Badge>
                        )}
                        {t.horizon !== 'now' && <Badge tone={horizonTone(t.horizon)}>{t.horizon}</Badge>}
                        <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                      </button>
                    ))}
                </div>
              )
            })
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {creating ? (
            <NewTicketForm
              onClose={() => setCreating(false)}
              onCreated={(slug) => {
                setCreating(false)
                loadTickets().then(() => setSel(slug))
              }}
            />
          ) : selected ? (
            <div className="p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                <span className="font-mono">#{selected.id}</span>
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
                {selected.hitl && (
                  <Badge tone="red">
                    <Hand size={10} strokeWidth={2.25} />
                    HITL
                  </Badge>
                )}
              </div>
              <h1 className="mb-2 text-lg font-bold text-zinc-100">{selected.title}</h1>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
                {selected.created && <span>created {selected.created}</span>}
                {selected.updated && <span>updated {selected.updated}</span>}
                {selected.prs.map((p) => (
                  <button
                    key={p}
                    onClick={() => window.gt.openExternal(p)}
                    className="inline-flex items-center gap-0.5 text-[var(--gt-accent-2)] hover:underline"
                  >
                    {p.replace(/^https?:\/\/[^/]+\//, '').replace(/\/-\/merge_requests\//, ' !')}
                    <ArrowUpRight size={11} strokeWidth={2} />
                  </button>
                ))}
              </div>
              <Markdown>{selected.body}</Markdown>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              {hitlOnly ? 'Select an item to view it.' : 'Select a ticket, or create a new one.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
