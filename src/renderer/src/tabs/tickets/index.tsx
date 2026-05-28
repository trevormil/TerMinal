import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { MrDetailView } from '../../components/MrDetail'
import type { Tab, Ticket, Mr, TabContext } from '../../lib/types'

const STATUSES = ['open', 'in-progress', 'closed', 'stuck', 'icebox']
const TYPES = ['feature', 'bug', 'security', 'docs', 'dx', 'testing', 'ux', 'performance']
const PRIORITIES = ['critical', 'high', 'medium', 'low']

type Tone = 'ok' | 'warn' | 'bad' | 'mute'
const statusTone = (s: string): Tone =>
  s === 'closed' ? 'ok' : s === 'in-progress' ? 'warn' : s === 'stuck' ? 'bad' : 'mute'
const verdictTone = (v: string): Tone =>
  v === 'approve' ? 'ok' : v === 'request-changes' || v === 'blocked' ? 'bad' : 'mute'
const stateTone = (s: string): Tone =>
  s === 'merged' ? 'ok' : s === 'closed' ? 'bad' : 'warn'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function MrList({ mrs, onOpen }: { mrs: Mr[] | null; onOpen: (iid: number) => void }) {
  if (mrs === null) return <div className="p-6 text-[12px] text-zinc-600">Loading MRs from glab…</div>
  if (mrs.length === 0)
    return <div className="p-6 text-[12px] text-zinc-600">No open MRs (or glab not authenticated for this repo).</div>
  return (
    <div className="space-y-2 p-4">
      {mrs.map((m) => (
        <div
          key={m.iid}
          onClick={() => onOpen(m.iid)}
          className="cursor-pointer rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 transition-colors hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
        >
          <div className="flex items-start gap-2">
            <span className="font-mono text-[12px] text-zinc-500">!{m.iid}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-zinc-100">
                {m.draft && <span className="mr-1 text-amber-400">[draft]</span>}
                {m.title}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                <Badge tone={stateTone(m.state)}>{m.state}</Badge>
                {m.review && <Badge tone={verdictTone(m.review.verdict)}>{m.review.verdict}</Badge>}
                {m.review && (
                  <Badge tone={m.review.testStatus === 'pass' ? 'ok' : m.review.testStatus === 'fail' ? 'bad' : 'mute'}>
                    tests {m.review.testStatus}
                  </Badge>
                )}
                {m.review?.overall != null && <span className="text-zinc-400">score {m.review.overall}</span>}
                {m.review?.stale && <Badge tone="warn">⚠ stale</Badge>}
                <span className="text-zinc-600">⎇ {m.sourceBranch}</span>
                {m.author && <span className="text-zinc-600">· @{m.author}</span>}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.gt.openExternal(m.webUrl)
              }}
              className="shrink-0 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
            >
              open ↗
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function TicketsTab({ ctx }: { ctx: TabContext }) {
  const [mode, setMode] = useState<'tickets' | 'mrs'>('tickets')
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [mrs, setMrs] = useState<Mr[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [selectedMrIid, setSelectedMrIid] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [fStatus, setFStatus] = useState('all')
  const [fType, setFType] = useState('all')
  const [q, setQ] = useState('')

  const loadTickets = () => window.gt.tickets.list().then(setTickets)
  useEffect(() => {
    loadTickets()
  }, [ctx.sessionId])
  useEffect(() => {
    if (mode === 'mrs' && mrs === null) {
      setMrs(null)
      window.gt.listMrs().then(setMrs)
    }
    if (mode !== 'mrs' && selectedMrIid !== null) setSelectedMrIid(null)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = (tickets || []).filter(
    (t) =>
      (fStatus === 'all' || t.status === fStatus) &&
      (fType === 'all' || t.type === fType) &&
      (!q || t.title.toLowerCase().includes(q.toLowerCase()) || String(t.id).includes(q)),
  )
  const selected = tickets?.find((t) => t.slug === sel) || null

  const seg = (m: 'tickets' | 'mrs', label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded-md px-3 py-1 text-[12px] font-medium ${
        mode === m ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col bg-[var(--gt-bg)]">
      {/* sub-header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
          {seg('tickets', `🎫 Tickets${tickets ? ` ${tickets.length}` : ''}`)}
          {seg('mrs', '🔀 MRs')}
        </div>
        <span className="text-[11px] text-zinc-600">{ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}</span>
        <div className="flex-1" />
        {mode === 'tickets' && (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search…"
              className="rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
            />
            <button
              onClick={() => {
                setCreating(true)
                setSel(null)
              }}
              className="rounded-lg bg-[var(--gt-accent)] px-3 py-1 text-[12px] font-semibold text-white"
            >
              ＋ New
            </button>
          </>
        )}
      </div>

      {mode === 'tickets' && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] px-4 py-2">
          <Chip active={fStatus === 'all'} onClick={() => setFStatus('all')}>
            all
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} active={fStatus === s} onClick={() => setFStatus(s)}>
              {s}
            </Chip>
          ))}
          <span className="mx-1 text-zinc-700">·</span>
          <Chip active={fType === 'all'} onClick={() => setFType('all')}>
            any type
          </Chip>
          {TYPES.map((t) => (
            <Chip key={t} active={fType === t} onClick={() => setFType(t)}>
              {t}
            </Chip>
          ))}
        </div>
      )}

      {/* body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'mrs' ? (
          selectedMrIid !== null ? (
            <MrDetailView
              iid={selectedMrIid}
              repoLabel={ctx.repoPath || 'repo'}
              onBack={() => setSelectedMrIid(null)}
            />
          ) : (
            <div className="h-full overflow-y-auto">
              <MrList mrs={mrs} onOpen={setSelectedMrIid} />
            </div>
          )
        ) : (
          <div className="flex h-full">
            <div className="w-[42%] min-w-[280px] overflow-y-auto border-r border-[var(--gt-border)]">
              {tickets === null ? (
                <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-[12px] text-zinc-600">No tickets match.</div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.slug}
                    onClick={() => {
                      setSel(t.slug)
                      setCreating(false)
                    }}
                    className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/60 px-4 py-2.5 text-left hover:bg-white/5 ${
                      sel === t.slug ? 'bg-white/5' : ''
                    }`}
                  >
                    <span className="font-mono text-[11px] text-zinc-600">#{t.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{t.title}</span>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                  </button>
                ))
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
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-600">
                    <span className="font-mono">#{selected.id}</span>
                    <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                    <Badge tone="mute">{selected.type}</Badge>
                    <Badge tone="mute">{selected.priority}</Badge>
                  </div>
                  <h1 className="mb-2 text-lg font-bold text-zinc-100">{selected.title}</h1>
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
                    {selected.created && <span>created {selected.created}</span>}
                    {selected.updated && <span>updated {selected.updated}</span>}
                    {selected.prs.map((p) => (
                      <button
                        key={p}
                        onClick={() => window.gt.openExternal(p)}
                        className="text-[var(--gt-accent-2)] hover:underline"
                      >
                        {p.replace(/^https?:\/\/[^/]+\//, '').replace(/\/-\/merge_requests\//, ' !')} ↗
                      </button>
                    ))}
                  </div>
                  <Markdown>{selected.body}</Markdown>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
                  Select a ticket, or ＋ New.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'tickets',
  title: 'Tickets & MRs',
  icon: '🎫',
  order: 1,
  appliesTo: (ctx) => ctx.hasBacklog || !!ctx.repoPath,
  Component: TicketsTab,
}
export default tab
