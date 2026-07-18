import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Compass, Repeat, Search, Terminal as TerminalIcon, type LucideIcon } from 'lucide-react'
import type { Tab, Mr, Ticket } from '../lib/types'
import { navigateTo } from '../lib/nav'
import { sessionEngineLabel } from '../lib/engines'

// ⌘K command palette: one fuzzy list over every navigation target — tabs in the
// current session, other open sessions, tickets, MRs/PRs, and content-search
// hits. Selecting an item dispatches the same navigateTo()/activate() the UI
// already uses, so there's no new navigation path to keep in sync.

export type PaletteSession = {
  key: string
  name: string
  cwd: string
  engine: string
}

type Item = {
  id: string
  group: string
  label: string
  hint?: string
  icon?: LucideIcon
  run: () => void
}

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

const base = (cwd: string) => cwd.split('/').filter(Boolean).pop() || cwd

// Subsequence match (cheap fuzzy): every char of the query appears in order.
function matches(q: string, text: string): boolean {
  if (!q) return true
  const t = text.toLowerCase()
  let i = 0
  for (const c of q.toLowerCase()) {
    i = t.indexOf(c, i)
    if (i === -1) return false
    i++
  }
  return true
}

export function CommandPalette({
  tabs,
  sessions,
  activeKey,
  mrSym = '!',
  onActivateSession,
  onClose,
}: {
  tabs: Tab[]
  sessions: PaletteSession[]
  activeKey: string | null
  mrSym?: string
  onActivateSession: (key: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [mrs, setMrs] = useState<Mr[]>([])
  const [hits, setHits] = useState<{ file: string; line: number; text: string }[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  // Lazy-load the cross-cutting sources once when the palette opens.
  useEffect(() => {
    window.gt.tickets
      .list()
      .then(setTickets)
      .catch(() => {})
    window.gt
      .listMrs()
      .then((r) => setMrs(r.mrs || []))
      .catch(() => {})
  }, [])

  // Debounced content search — only when the query is substantial.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    const id = setTimeout(() => {
      window.gt.files
        .search(term)
        .then(setHits)
        .catch(() => setHits([]))
    }, 160)
    return () => clearTimeout(id)
  }, [q])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const close = (fn: () => void) => () => {
      fn()
      onClose()
    }

    out.push({
      id: 'tab:terminal',
      group: 'Tab',
      label: 'Terminal',
      icon: TerminalIcon,
      run: close(() => navigateTo('terminal')),
    })
    out.push({
      id: 'command:workspace-search',
      group: 'Command',
      label: q.trim() ? `Search workspace for "${q.trim()}"` : 'Workspace search',
      hint: 'Files, tickets, MRs, docs, runs, snippets, activity',
      icon: Search,
      run: close(() => {
        const payload = q.trim() ? { q: q.trim() } : undefined
        navigateTo('search', payload)
        setTimeout(() => navigateTo('search', payload), 50)
      }),
    })
    out.push({
      id: 'command:paired-loop',
      group: 'Command',
      label: 'Start paired loop',
      hint: 'Two linked sessions — a worker + a driver, contract-first',
      icon: Repeat,
      run: close(() => navigateTo('paired-loop:new')),
    })
    out.push({
      id: 'command:repo-orientation',
      group: 'Command',
      label: 'Repo orientation',
      hint: 'What each tab does in this repo',
      icon: Compass,
      run: close(() => window.dispatchEvent(new Event('gt.repoOrientation.show'))),
    })
    for (const t of tabs)
      out.push({
        id: `tab:${t.id}`,
        group: 'Tab',
        label: t.title,
        icon: t.icon,
        run: close(() => navigateTo(t.id)),
      })

    for (const s of sessions) {
      if (s.key === activeKey) continue
      out.push({
        id: `session:${s.key}`,
        group: 'Session',
        label: s.name || base(s.cwd),
        hint: `${sessionEngineLabel(s.engine)} · ${s.cwd.replace(/^\/Users\/[^/]+/, '~')}`,
        run: close(() => onActivateSession(s.key)),
      })
    }

    for (const t of tickets)
      out.push({
        id: `ticket:${t.slug}`,
        group: 'Ticket',
        label: `#${t.id} ${t.title}`,
        hint: t.status,
        run: close(() => navigateTo('tickets', { slug: t.slug })),
      })

    for (const m of mrs)
      out.push({
        id: `mr:${m.iid}`,
        group: 'MR / PR',
        label: `${mrSym}${m.iid} ${m.title}`,
        hint: m.state,
        run: close(() => navigateTo('mrs', { iid: m.iid })),
      })

    // Static items are filtered by the fuzzy query; search hits are already
    // query-derived so they pass through verbatim.
    const filtered = out.filter((it) => matches(q.trim(), `${it.label} ${it.hint || ''}`))
    for (const h of hits)
      filtered.push({
        id: `hit:${h.file}:${h.line}`,
        group: 'In files',
        label: `${h.file}:${h.line}`,
        hint: h.text.trim(),
        icon: Search,
        run: close(() => navigateTo('files', { path: h.file, line: h.line })),
      })
    return filtered
  }, [tabs, sessions, activeKey, mrSym, tickets, mrs, hits, q, onActivateSession, onClose])

  // Keep selection in range as the list shrinks/grows.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)))
  }, [items.length])

  // Scroll the active row into view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[sel]?.run()
    }
  }

  // Group label shown only at the first item of each group (the list is already
  // ordered group-by-group by construction).
  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        style={noDrag}
        className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3.5 py-2.5">
          <Search size={16} className="text-zinc-500" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKey}
            placeholder="Jump to a tab, session, ticket, MR, or search files…"
            className="w-full bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <div ref={listRef} className="overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-zinc-600">No matches</div>
          )}
          {items.map((it, idx) => {
            const header = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null
            const Icon = it.icon
            return (
              <div key={it.id}>
                {header && (
                  <div className="px-3.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                    {header}
                  </div>
                )}
                <button
                  data-idx={idx}
                  onMouseEnter={() => setSel(idx)}
                  onClick={() => it.run()}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13px] ${
                    idx === sel ? 'bg-[var(--gt-accent)]/15 text-zinc-100' : 'text-zinc-300'
                  }`}
                >
                  {Icon ? (
                    <Icon size={14} className="shrink-0 text-zinc-500" />
                  ) : (
                    <span className="w-[14px] shrink-0" />
                  )}
                  <span className="truncate">{it.label}</span>
                  {it.hint && (
                    <span className="ml-auto truncate pl-3 text-[11px] text-zinc-600">
                      {it.hint}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
