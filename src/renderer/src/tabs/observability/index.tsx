import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownWideNarrow,
  BarChart3,
  Braces,
  ChevronRight,
  Clipboard,
  Coins,
  Cpu,
  Database,
  FileText,
  GaugeCircle,
  GitBranch,
  Layers3,
  ListTree,
  MessageSquare,
  RadioTower,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { Badge, Gauge } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { EngineLogo } from '../../components/EngineLogo'
import type { BadgeTone } from '../../components/ui'
import type {
  ObservabilitySession,
  ObservabilitySessionDetail,
  ObservabilityIndexQueryId,
  ObservabilityIndexQueryResult,
  ObservabilityIndexStatus,
  ObservabilitySnapshot,
  ObservabilityTimelineEvent,
  ObservabilityTokenSnapshot,
  ObservabilityToolCall,
  ObservabilityToolCallPayload,
  ObservabilityTranscriptWindow,
  Tab,
  TabContext,
} from '../../lib/types'

const nf = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' })
const usd = new Intl.NumberFormat('en-US', { currency: 'USD', maximumFractionDigits: 2, style: 'currency' })

// Queries scan + sort over the entire indexed history; we only paint this many
// rows so a 50k-row result can't freeze the non-virtualized table. Filter/sort
// still operate on the full matched set — this caps DOM nodes, not the data.
const GRID_RENDER_CAP = 1000

function reltime(ms: number): string {
  if (!ms) return 'unknown'
  const s = (Date.now() - ms) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function EnginePill({ engine }: { engine: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-300">
      <EngineLogo engine={engine} size={13} />
      {engine}
    </span>
  )
}

function Metric({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub: string
  icon: typeof Activity
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={13} strokeWidth={2.2} className="text-zinc-500" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">{label}</span>
      </div>
      <div className="truncate text-[24px] font-semibold tabular-nums tracking-tight text-zinc-100">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-zinc-600">{sub}</div>
    </div>
  )
}

function clock(ms: number): string {
  if (!ms) return 'n/a'
  if (ms < 10_000) return `line ${ms}`
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function duration(ms?: number): string {
  if (ms === undefined) return 'open'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m`
}

function statusTone(status: string): BadgeTone {
  if (status === 'ok' || status === 'closed' || status === 'root') return 'green'
  if (status === 'error' || status === 'failed') return 'red'
  if (status === 'open') return 'yellow'
  return 'mute'
}

function eventTone(event: ObservabilityTimelineEvent): BadgeTone {
  if (event.severity === 'error') return 'red'
  if (event.kind === 'tool_call' || event.kind === 'agent_launch') return 'blue'
  if (event.kind === 'tool_result') return 'green'
  if (event.kind === 'token_snapshot') return 'accent'
  if (event.kind === 'warning' || event.kind === 'parse_error') return 'yellow'
  return 'mute'
}

function statusBorder(status: string): string {
  if (status === 'ok' || status === 'closed' || status === 'root') return 'border-l-[var(--gt-green)]'
  if (status === 'error' || status === 'failed') return 'border-l-[var(--gt-red)]'
  if (status === 'open') return 'border-l-[var(--gt-yellow)]'
  return 'border-l-zinc-700'
}

function eventBorder(event: ObservabilityTimelineEvent): string {
  if (event.severity === 'error') return 'border-l-[var(--gt-red)]'
  if (event.kind === 'tool_result') return 'border-l-[var(--gt-green)]'
  if (event.kind === 'tool_call' || event.kind === 'agent_launch') return 'border-l-[var(--gt-blue)]'
  if (event.kind === 'token_snapshot') return 'border-l-[var(--gt-accent-light)]'
  if (event.kind === 'warning' || event.kind === 'parse_error') return 'border-l-[var(--gt-yellow)]'
  return 'border-l-zinc-700'
}

function prettyJson(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || !/^[{[]/.test(trimmed)) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

function looksMarkdown(text: string): boolean {
  return /```|^#{1,6}\s|^\s*[-*]\s|\[[^\]]+\]\([^)]+\)|^\s*\d+\.\s|^\s*>\s/m.test(text)
}

function RichPreview({ text, lang, className = '' }: { text?: string; lang?: string; className?: string }) {
  if (!text) return null
  const json = prettyJson(text)
  const body = lang ? `\`\`\`${lang}\n${text}\n\`\`\`` : json ? `\`\`\`json\n${json}\n\`\`\`` : looksMarkdown(text) ? text : ''
  if (body) {
    return (
      <div className={`obs-rich max-w-full overflow-hidden text-[12px] leading-5 ${className}`}>
        <Markdown>{body}</Markdown>
      </div>
    )
  }
  return (
    <pre className={`overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-2 font-mono text-[11px] leading-relaxed text-zinc-400 ${className}`}>
      {text}
    </pre>
  )
}

function TokenCurve({ snapshots }: { snapshots: ObservabilityTokenSnapshot[] }) {
  if (snapshots.length === 0) return <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] text-zinc-600">No token snapshots parsed.</div>
  const width = 1000
  const height = 180
  const max = Math.max(1, ...snapshots.map((s) => s.cumulativeTotal || s.total))
  const points = snapshots.map((snapshot, index) => {
    const x = snapshots.length === 1 ? 0 : (index / (snapshots.length - 1)) * width
    const y = height - ((snapshot.cumulativeTotal || snapshot.total) / max) * (height - 18) - 8
    return { snapshot, x, y }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const fill = `${path} L ${width} ${height} L 0 ${height} Z`
  return (
    <svg className="h-44 w-full overflow-visible rounded-md border border-[var(--gt-border)] bg-black/15" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      <path d={fill} fill="var(--gt-accent)" opacity="0.16" />
      <path d={path} fill="none" stroke="var(--gt-accent-light)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      {points.map((p, index) => index % Math.max(1, Math.floor(points.length / 16)) === 0 ? (
        <circle key={`${p.snapshot.timestamp}-${index}`} cx={p.x} cy={p.y} r="4" fill="var(--gt-accent-light)" />
      ) : null)}
    </svg>
  )
}

function SummaryView({ session, detail }: { session: ObservabilitySession; detail: ObservabilitySessionDetail | null }) {
  const cachedInput = detail?.tokenSnapshots.reduce((sum, snap) => sum + (snap.cachedInput || 0), 0) ?? 0
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <EnginePill engine={session.engine} />
        <Badge tone={session.telemetry === 'ready' ? 'green' : 'yellow'}>{session.telemetry}</Badge>
        {session.model && <Badge tone="mute">{session.model}</Badge>}
        <span className="text-[11px] text-zinc-600">{session.cwd || 'unknown cwd'}</span>
      </div>
      <h2 className="text-lg font-semibold leading-snug text-zinc-100">{session.title}</h2>
      {session.firstUserText && (
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-[12px] leading-5 text-zinc-400">
          {session.firstUserText}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Context</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-100">{session.contextLimit ? `${Math.round(session.contextPct)}%` : 'n/a'}</div>
          <div className="mt-1"><Gauge pct={session.contextPct} /></div>
          <div className="mt-1 text-[10px] tabular-nums text-zinc-600">{compact.format(session.contextTokens)} / {compact.format(session.contextLimit)}</div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Tokens</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-100">{compact.format(session.totalInputTokens + session.totalOutputTokens)}</div>
          <div className="text-[10.5px] text-zinc-600">{compact.format(session.totalInputTokens)} in · {compact.format(session.totalOutputTokens)} out</div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Cost</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-100">{usd.format(session.estCostUsd)}</div>
          <div className="text-[10.5px] text-zinc-600">{cachedInput ? `${compact.format(cachedInput)} cached in` : 'estimated'}</div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Tool Calls</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-100">{nf.format(detail?.toolCalls.length ?? session.toolTotal)}</div>
          <div className="truncate text-[10.5px] text-zinc-600">{session.lastAction ? `${session.lastAction.tool} · ${session.lastAction.detail}` : 'no last action'}</div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Turns</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-100">{nf.format(detail?.turns.length ?? session.turns)}</div>
          <div className="text-[10.5px] text-zinc-600">{detail?.events.length ?? 0} timeline events</div>
        </div>
      </div>
      {detail && detail.warnings.length > 0 && (
        <div className="rounded-md border border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/5 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--gt-yellow)]">
            <AlertTriangle size={12} /> {nf.format(detail.warnings.length)} parse warning{detail.warnings.length === 1 ? '' : 's'}
          </div>
          <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[10.5px] leading-5 text-zinc-500">
            {detail.warnings.slice(0, 40).map((warning, index) => (
              <div key={index} className="truncate" title={warning}>{warning}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function firstLine(text?: string): string {
  if (!text) return ''
  const index = text.indexOf('\n')
  return (index === -1 ? text : text.slice(0, index)).trim()
}

function lineCount(text?: string): number {
  if (!text) return 0
  return text.split('\n').length
}

function eventBody(event: ObservabilityTimelineEvent): { command?: string; preview?: string; output?: string } | null {
  if (!event.commandPreview && !event.previewText && !event.joinedOutputPreview) return null
  return { command: event.commandPreview, preview: event.previewText, output: event.joinedOutputPreview }
}

function TimelineRow({ event, open, onToggle }: { event: ObservabilityTimelineEvent; open: boolean; onToggle: () => void }) {
  const body = eventBody(event)
  const summary = firstLine(event.commandPreview) || firstLine(event.previewText) || firstLine(event.joinedOutputPreview)
  return (
    <div className={`min-w-0 rounded-md border border-l-2 border-[var(--gt-border)] ${eventBorder(event)} bg-black/15`}>
      <button
        onClick={onToggle}
        disabled={!body}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
      >
        {body ? (
          <ChevronRight size={13} className={`shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <Badge tone={eventTone(event)}>{event.kind.replace('_', ' ')}</Badge>
        {event.toolName && <span className="shrink-0 text-[12px] font-semibold text-zinc-200">{event.toolName}</span>}
        {!open && summary && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">{summary}</span>}
        <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-zinc-600">{clock(event.timestamp)}</span>
        <span className="shrink-0 text-[10.5px] tabular-nums text-zinc-700">ln {event.line}</span>
      </button>
      {open && body && (
        <div className="min-w-0 border-t border-[var(--gt-border)]/60 px-3 py-2 text-[12px] leading-5 text-zinc-400">
          {event.callId && <div className="mb-2 truncate font-mono text-[10px] text-zinc-600">{event.callId}</div>}
          {body.command && <RichPreview text={body.command} lang="bash" className="mb-2" />}
          {body.preview && <div className="max-h-56 overflow-y-auto"><RichPreview text={body.preview} /></div>}
          {body.output && <div className="mt-2 max-h-40 overflow-y-auto"><RichPreview text={body.output} /></div>}
        </div>
      )}
    </div>
  )
}

function TimelineView({ detail }: { detail: ObservabilitySessionDetail }) {
  const events = detail.events
  const expandable = useMemo(() => events.filter((event) => eventBody(event)).map((event) => event.id), [events])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const allOpen = expandable.length > 0 && expandable.every((id) => open.has(id))
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  if (events.length === 0) {
    return <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] text-zinc-600">No timeline events parsed.</div>
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[10.5px] text-zinc-600">{nf.format(events.length)} events</span>
        <button
          onClick={() => setOpen(allOpen ? new Set() : new Set(expandable))}
          disabled={expandable.length === 0}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-[var(--gt-border)] bg-black/20 px-2 text-[10px] font-semibold text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {events.map((event) => (
        <TimelineRow key={event.id} event={event} open={open.has(event.id)} onToggle={() => toggle(event.id)} />
      ))}
    </div>
  )
}

function bytes(n?: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${nf.format(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const PAYLOAD_LINE_CAP = 200

function ExactPayloadBox({
  title,
  text,
  bytesValue,
  empty,
}: {
  title: string
  text: string
  bytesValue: number
  empty: string
}) {
  const [full, setFull] = useState(false)
  const total = lineCount(text)
  const truncated = !full && total > PAYLOAD_LINE_CAP
  const shown = truncated ? text.split('\n').slice(0, PAYLOAD_LINE_CAP).join('\n') : text
  useEffect(() => {
    setFull(false)
  }, [text])
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--gt-border)] bg-black/15">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-2">
        <FileText size={12} className="text-zinc-500" />
        <span className="text-[11px] font-semibold text-zinc-300">{title}</span>
        {text && <span className="text-[10px] tabular-nums text-zinc-700">{nf.format(total)} ln</span>}
        <span className="ml-auto text-[10px] tabular-nums text-zinc-600">{bytes(bytesValue)}</span>
        <button
          onClick={() => navigator.clipboard?.writeText(text || '')}
          disabled={!text}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          title={`Copy ${title.toLowerCase()}`}
        >
          <Clipboard size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {text ? (
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-zinc-300">{shown}</pre>
        ) : (
          <div className="p-3 text-[12px] text-zinc-600">{empty}</div>
        )}
      </div>
      {truncated && (
        <button
          onClick={() => setFull(true)}
          className="shrink-0 border-t border-[var(--gt-border)] bg-black/20 py-1.5 text-center text-[10.5px] font-semibold text-[var(--gt-accent-light)] hover:bg-black/30"
        >
          Show all {nf.format(total)} lines
        </button>
      )}
    </div>
  )
}

type ToolSort = 'footprint' | 'input' | 'output' | 'duration' | 'line'

function ToolsView({
  sessionId,
  tools,
  targetCallId,
}: {
  sessionId: string
  tools: ObservabilityToolCall[]
  targetCallId?: string
}) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<ToolSort>('footprint')
  const [status, setStatus] = useState<'all' | 'ok' | 'error' | 'open'>('all')
  const [selectedCallId, setSelectedCallId] = useState('')
  const [payload, setPayload] = useState<ObservabilityToolCallPayload | null>(null)
  const [payloadBusy, setPayloadBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return tools
      .filter((tool) => status === 'all' || tool.status === status)
      .filter((tool) => {
        if (!q) return true
        return [
          tool.callId,
          tool.toolName,
          tool.skillName,
          tool.agentRole,
          tool.commandPreview,
          tool.argumentsPreview,
          tool.outputPreview,
          tool.turnId,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        const inputA = a.argumentsBytes || 0
        const inputB = b.argumentsBytes || 0
        const outputA = a.outputBytes || 0
        const outputB = b.outputBytes || 0
        if (sort === 'input') return inputB - inputA || outputB - outputA
        if (sort === 'output') return outputB - outputA || inputB - inputA
        if (sort === 'duration') return (b.durationMs || 0) - (a.durationMs || 0)
        if (sort === 'line') return (a.line || 0) - (b.line || 0)
        return inputB + outputB - (inputA + outputA) || outputB - outputA
      })
  }, [filter, sort, status, tools])

  const selected = filtered.find((tool) => tool.callId === selectedCallId) || filtered[0] || null

  useEffect(() => {
    if (!targetCallId) return
    setStatus('all')
    setFilter('')
    setSelectedCallId(targetCallId)
  }, [targetCallId])

  useEffect(() => {
    if (!selected?.callId) {
      setSelectedCallId('')
      return
    }
    if (selectedCallId !== selected.callId) setSelectedCallId(selected.callId)
  }, [selected?.callId, selectedCallId])

  useEffect(() => {
    let canceled = false
    const loadPayload = async () => {
      if (!sessionId || !selectedCallId) {
        setPayload(null)
        return
      }
      setPayloadBusy(true)
      try {
        const next = await window.gt.agentview.toolCall(sessionId, selectedCallId)
        if (!canceled) setPayload(next)
      } finally {
        if (!canceled) setPayloadBusy(false)
      }
    }
    loadPayload()
    return () => {
      canceled = true
    }
  }, [sessionId, selectedCallId])

  return (
    <div className="grid min-h-[680px] gap-3 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
      {tools.length === 0 ? (
        <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] leading-5 text-zinc-600">
          No tool calls parsed for this transcript. That is expected for prompt-enhancer or response-only sessions; use the session list filters to jump to tool-bearing sessions.
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--gt-border)] bg-black/15">
            <div className="shrink-0 border-b border-[var(--gt-border)] p-2">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search size={12} className="pointer-events-none absolute left-2 top-2 text-zinc-600" />
                  <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter call, command, skill, output"
                    className="h-8 w-full rounded-md border border-[var(--gt-border)] bg-black/20 pl-7 pr-2 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/70"
                  />
                </div>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                  className="h-8 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[11px] text-zinc-300 outline-none"
                >
                  <option value="all">all</option>
                  <option value="ok">ok</option>
                  <option value="error">error</option>
                  <option value="open">open</option>
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {[
                  ['footprint', 'Footprint'],
                  ['input', 'Input'],
                  ['output', 'Output'],
                  ['duration', 'Duration'],
                  ['line', 'Transcript'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setSort(id as ToolSort)}
                    className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10.5px] font-semibold ${
                      sort === id
                        ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                        : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <ArrowDownWideNarrow size={11} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="p-3 text-[12px] text-zinc-600">No calls match the current filters.</div>
              ) : filtered.map((tool) => {
                const on = selectedCallId === tool.callId
                return (
                  <button
                    key={tool.callId}
                    onClick={() => setSelectedCallId(tool.callId)}
                    className={`mb-1.5 block w-full rounded-md border border-l-2 px-2.5 py-2 text-left ${statusBorder(tool.status)} ${
                      on ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15' : 'border-[var(--gt-border)] bg-black/20 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge tone={statusTone(tool.status)}>{tool.status}</Badge>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">{tool.toolName}</span>
                      <span className="text-[10px] tabular-nums text-zinc-600">ln {tool.line || '?'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10.5px] text-zinc-600">
                      <span>{tool.turnId || 'no turn'}</span>
                      {tool.skillName && <span className="text-[var(--gt-accent-light)]">skill {tool.skillName}</span>}
                      {tool.agentRole && <span className="text-[var(--gt-blue)]">agent {tool.agentRole}</span>}
                      <span>{bytes(tool.argumentsBytes)} in</span>
                      <span>{bytes(tool.outputBytes)} out</span>
                      <span>{duration(tool.durationMs)}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10.5px] text-zinc-500">
                      {tool.commandPreview || tool.argumentsPreview || tool.outputPreview || tool.callId}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-[var(--gt-border)] bg-black/15">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
              <Badge tone={statusTone(selected?.status || 'open')}>{selected?.status || 'none'}</Badge>
              <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-100">{selected?.toolName || 'Select a call'}</span>
              {payloadBusy && <RefreshCw size={12} className="animate-spin text-zinc-600" />}
              {selected?.skillName && <Badge tone="accent">{selected.skillName}</Badge>}
              {selected?.agentRole && <Badge tone="blue">{selected.agentRole}</Badge>}
              {selected && <span className="ml-auto text-[10.5px] text-zinc-600">line {selected.line}{selected.completedLine ? ` -> ${selected.completedLine}` : ''}</span>}
            </div>
            <div className="grid min-h-0 flex-1 gap-2 p-2 lg:grid-rows-2">
              <ExactPayloadBox
                title="Exact Input"
                text={payload?.inputText || ''}
                bytesValue={payload?.inputBytes || selected?.argumentsBytes || 0}
                empty={payloadBusy ? 'Loading exact input…' : 'No input payload for this call.'}
              />
              <ExactPayloadBox
                title="Exact Output"
                text={payload?.outputText || ''}
                bytesValue={payload?.outputBytes || selected?.outputBytes || 0}
                empty={payloadBusy ? 'Loading exact output…' : selected?.status === 'open' ? 'Call is still open.' : 'No output payload for this call.'}
              />
            </div>
            {payload?.sourceFile && (
              <div className="shrink-0 truncate border-t border-[var(--gt-border)] px-3 py-2 font-mono text-[10px] text-zinc-700">
                {payload.sourceFile}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TokensView({ detail }: { detail: ObservabilitySessionDetail }) {
  const [sort, setSort] = useState<'total' | 'input' | 'output' | 'tools'>('total')
  const turns = useMemo(
    () =>
      [...detail.turns].sort((a, b) => {
        if (sort === 'input') return b.inputTokens - a.inputTokens || b.outputTokens - a.outputTokens
        if (sort === 'output') return b.outputTokens - a.outputTokens || b.inputTokens - a.inputTokens
        if (sort === 'tools') return b.toolCalls - a.toolCalls || b.totalTokens - a.totalTokens
        return b.totalTokens - a.totalTokens
      }),
    [detail.turns, sort],
  )
  return (
    <div className="space-y-3">
      <TokenCurve snapshots={detail.tokenSnapshots} />
      <div className="grid gap-2 md:grid-cols-4">
        <Metric icon={GaugeCircle} label="Snapshots" value={nf.format(detail.tokenSnapshots.length)} sub="assistant usage rows" />
        <Metric icon={Layers3} label="Cumulative" value={compact.format(detail.tokenSnapshots.at(-1)?.cumulativeTotal ?? 0)} sub="input + cache + output" />
        <Metric icon={Database} label="Cached in" value={compact.format(detail.tokenSnapshots.reduce((sum, snap) => sum + (snap.cachedInput || 0), 0))} sub="prompt cache reads" />
        <Metric icon={Cpu} label="Turns" value={nf.format(detail.turns.length)} sub="token-bearing exchanges" />
      </div>
      <div className="rounded-md border border-[var(--gt-border)] bg-black/15">
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--gt-border)] p-2">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600">Rank turns by</span>
          {[
            ['total', 'Total'],
            ['input', 'Input'],
            ['output', 'Output'],
            ['tools', 'Tools'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSort(id as typeof sort)}
              className={`h-7 rounded-md border px-2 text-[10.5px] font-semibold ${
                sort === id
                  ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[11px]">
            <thead className="sticky top-0 bg-[var(--gt-panel)] text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              <tr>
                <th className="border-b border-[var(--gt-border)] px-2 py-2">turn</th>
                <th className="border-b border-[var(--gt-border)] px-2 py-2">input</th>
                <th className="border-b border-[var(--gt-border)] px-2 py-2">output</th>
                <th className="border-b border-[var(--gt-border)] px-2 py-2">total</th>
                <th className="border-b border-[var(--gt-border)] px-2 py-2">tools</th>
                <th className="border-b border-[var(--gt-border)] px-2 py-2">last assistant message</th>
              </tr>
            </thead>
            <tbody>
              {turns.map((turn) => (
                <tr key={turn.id} className="border-b border-[var(--gt-border)]/70 odd:bg-white/[0.025]">
                  <td className="px-2 py-2 tabular-nums text-zinc-500">{turn.id}</td>
                  <td className="px-2 py-2 tabular-nums text-zinc-400">{nf.format(turn.inputTokens)}</td>
                  <td className="px-2 py-2 tabular-nums text-zinc-400">{nf.format(turn.outputTokens)}</td>
                  <td className="px-2 py-2 tabular-nums text-zinc-300">{nf.format(turn.totalTokens)}</td>
                  <td className="px-2 py-2 tabular-nums text-zinc-400">{nf.format(turn.toolCalls)}</td>
                  <td className="max-w-[420px] truncate px-2 py-2 text-zinc-500" title={turn.lastMessage}>{turn.lastMessage || 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AgentTree({ detail }: { detail: ObservabilitySessionDetail }) {
  const graph = detail.graph
  return (
    <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-3">
      {graph.edges.map((edge) => (
        <div key={edge.id} className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1.5">
          <GitBranch size={12} className="text-zinc-500" />
          <Badge tone={statusTone(edge.status)}>{edge.status}</Badge>
          <span className="text-[11px] text-zinc-500">{edge.toolCallId}</span>
        </div>
      ))}
      <div className="grid gap-2 md:grid-cols-2">
        {graph.nodes.map((node) => (
          <div key={node.id} className="rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(node.status)}>{node.status}</Badge>
              <span className="text-[10px] uppercase tracking-wider text-zinc-600">depth {node.depth}</span>
            </div>
            <div className="mt-2 text-[13px] font-semibold text-zinc-100">{node.label}</div>
            <div className="mt-1 text-[11px] text-zinc-500">{node.role} · {compact.format(node.tokens)} tokens</div>
            {node.taskPreview && <div className="mt-2 text-[11px] leading-5 text-zinc-500">{node.taskPreview}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivityView({ detail }: { detail: ObservabilitySessionDetail }) {
  const hasAgents = detail.graph.nodes.length > 1
  return (
    <div className="space-y-3">
      {hasAgents && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-700">
            <ListTree size={12} strokeWidth={2.2} />
            Agent tree
          </div>
          <AgentTree detail={detail} />
        </div>
      )}
      <TimelineView detail={detail} />
    </div>
  )
}

type QueryEntry = { id: ObservabilityIndexQueryId; label: string; icon: typeof Activity }

const QUERY_GROUPS: { group: string; items: QueryEntry[] }[] = [
  {
    group: 'Where did tokens go?',
    items: [
      { id: 'turn_hotspots', label: 'Heaviest turns', icon: MessageSquare },
      { id: 'costliest_turns', label: 'Costliest turns', icon: Coins },
      { id: 'sessions_by_tokens', label: 'Biggest sessions', icon: Database },
      { id: 'low_yield_sessions', label: 'Low-yield sessions', icon: Search },
    ],
  },
  {
    group: 'What did tools do?',
    items: [
      { id: 'tool_calls', label: 'All tool calls', icon: Wrench },
      { id: 'tool_payloads', label: 'Full payloads', icon: Braces },
      { id: 'tool_errors', label: 'Failed calls', icon: AlertTriangle },
      { id: 'tool_call_bloat', label: 'Noisiest tools', icon: Layers3 },
    ],
  },
  {
    group: 'Rollups',
    items: [
      { id: 'model_rollup', label: 'By model', icon: Cpu },
      { id: 'repo_rollup', label: 'By repo', icon: BarChart3 },
    ],
  },
  {
    group: 'Quality',
    items: [{ id: 'audit', label: 'Audit flags', icon: ShieldCheck }],
  },
]

type InspectorMode = 'overview' | 'timeline' | 'tools' | 'tokens' | 'raw' | 'payload'

const MODE_LABELS: Record<InspectorMode, string> = {
  overview: 'Overview',
  tools: 'Calls',
  tokens: 'Tokens',
  timeline: 'Activity',
  raw: 'Raw',
  payload: 'Payload',
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000) return nf.format(Math.round(value))
    if (!Number.isInteger(value)) return value.toFixed(value < 1 ? 4 : 2)
    return String(value)
  }
  return String(value)
}

const COLUMN_LABELS: Record<string, string> = {
  repo: 'Repo',
  model: 'Model',
  tool_name: 'Tool',
  skill_name: 'Skill',
  status: 'Status',
  line: 'Line',
  turn_id: 'Turn',
  turn_input_tokens: 'Turn input',
  turn_output_tokens: 'Turn output',
  turn_total_tokens: 'Turn total',
  input_tokens: 'Input tokens',
  output_tokens: 'Output tokens',
  total_tokens: 'Total tokens',
  input_bytes: 'Input bytes',
  output_bytes: 'Output bytes',
  total_output_bytes: 'Output bytes',
  avg_output_bytes: 'Avg output',
  max_output_bytes: 'Max output',
  duration_ms: 'Duration',
  command_preview: 'Exact operation',
  command_text: 'Command',
  cost_usd: 'Cost',
  tool_calls: 'Calls',
  input_json: 'Request JSON',
  output_json: 'Response',
  error_text: 'Error',
  truncated: 'Truncated',
  output_per_input: 'Out / in',
  open_calls: 'Open',
  error_calls: 'Errors',
  sessions: 'Sessions',
  seq: 'Seq',
  kind: 'Kind',
  severity: 'Severity',
  role: 'Role',
  bytes: 'Bytes',
  text: 'Content',
}

function columnLabel(column: string): string {
  return COLUMN_LABELS[column] || column.replaceAll('_', ' ')
}

function visibleColumns(query: ObservabilityIndexQueryResult | null): string[] {
  if (!query) return []
  if (query.query === 'tool_calls') {
    return [
      'tool_name',
      'repo',
      'status',
      'turn_input_tokens',
      'turn_output_tokens',
      'turn_total_tokens',
      'input_bytes',
      'output_bytes',
      'duration_ms',
      'line',
      'command_preview',
    ].filter((column) => query.columns.includes(column))
  }
  if (query.query === 'turn_hotspots') {
    return ['repo', 'model', 'turn_id', 'input_tokens', 'output_tokens', 'total_tokens', 'tool_calls'].filter((column) => query.columns.includes(column))
  }
  if (query.query === 'costliest_turns') {
    return ['repo', 'model', 'turn_id', 'cost_usd', 'total_tokens', 'input_tokens', 'output_tokens', 'tool_calls', 'duration_ms'].filter((column) => query.columns.includes(column))
  }
  if (query.query === 'tool_payloads') {
    // The full JSON blobs live in the inspector's Payload view, not the grid cell.
    return ['tool_name', 'repo', 'status', 'input_bytes', 'output_bytes', 'duration_ms', 'truncated'].filter((column) => query.columns.includes(column))
  }
  if (query.query === 'tool_errors') {
    return ['tool_name', 'repo', 'turn_id', 'line', 'output_bytes', 'duration_ms', 'command_text'].filter((column) => query.columns.includes(column))
  }
  if (query.query === 'session_events') {
    return ['seq', 'kind', 'severity', 'turn_id', 'tool_name', 'role', 'bytes', 'text'].filter((column) => query.columns.includes(column))
  }
  if (query.query === 'sessions_by_tokens' || query.query === 'low_yield_sessions') {
    return query.columns.filter((column) => column !== 'session_id')
  }
  return query.columns
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value === null || value === undefined ? '' : String(value)
}

function numericCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function defaultSortColumn(query?: ObservabilityIndexQueryId): string {
  if (query === 'tool_calls') return 'turn_total_tokens'
  if (query === 'tool_payloads') return 'output_bytes'
  if (query === 'turn_hotspots') return 'total_tokens'
  if (query === 'costliest_turns') return 'cost_usd'
  if (query === 'sessions_by_tokens' || query === 'repo_rollup' || query === 'model_rollup') return 'total_tokens'
  if (query === 'low_yield_sessions') return 'input_tokens'
  if (query === 'tool_call_bloat') return 'total_output_bytes'
  // tool_errors + session_events keep the SQL ordering (recency / chronological).
  return ''
}

type IndexedRowSelection = { query: ObservabilityIndexQueryId; row: Record<string, unknown> }

function QueryRail({
  snap,
  status,
  active,
  busy,
  onRebuild,
  onQuery,
}: {
  snap: ObservabilitySnapshot
  status: ObservabilityIndexStatus | null
  active: ObservabilityIndexQueryId
  busy: boolean
  onRebuild: () => void
  onQuery: (query: ObservabilityIndexQueryId) => void
}) {
  const topTools = snap.topTools.slice(0, 10)
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/70">
      <div className="shrink-0 border-b border-[var(--gt-border)] p-3">
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700">Tokens</div>
            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">{compact.format(snap.totals.tokens)}</div>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700">Calls</div>
            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">{compact.format(snap.totals.toolCalls)}</div>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700">Traces</div>
            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">{nf.format(snap.totals.sessions)}</div>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700">Spend</div>
            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">{usd.format(snap.totals.costUsd)}</div>
          </div>
        </div>
        <button
          onClick={onRebuild}
          disabled={busy || status?.sqliteAvailable === false}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 px-2 text-[11px] font-semibold text-zinc-100 hover:bg-[var(--gt-accent)]/25 disabled:opacity-50"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          Reindex {status?.indexedAt ? `(${reltime(status.indexedAt)})` : ''}
        </button>
        {status?.error && <div className="mt-2 text-[11px] text-[var(--gt-red)]">{status.error}</div>}
      </div>

      <div className="shrink-0 space-y-3 border-b border-[var(--gt-border)] p-2">
        {!status?.exists && (
          <div className="rounded-md border border-[var(--gt-border)] bg-black/15 px-2 py-2 text-[11px] leading-4 text-zinc-500">
            Build the index, then pick a question to see where tokens and tool calls went.
          </div>
        )}
        {QUERY_GROUPS.map(({ group, items }) => (
          <div key={group}>
            <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-700">{group}</div>
            <div className="space-y-1">
              {items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => onQuery(id)}
                  disabled={busy || !status?.exists}
                  className={`flex h-8 w-full items-center gap-2 rounded-md border px-2 text-left text-[11px] font-semibold ${
                    active === id
                      ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                      : 'border-transparent bg-transparent text-zinc-500 hover:border-[var(--gt-border)] hover:bg-black/15 hover:text-zinc-300'
                  } disabled:opacity-45`}
                >
                  <Icon size={13} strokeWidth={2.2} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-700">Top tools</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {topTools.length === 0 ? (
            <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-3 text-[12px] text-zinc-600">No parsed tool calls yet.</div>
          ) : topTools.map((tool) => (
            <div key={tool.tool} className="mb-1.5 rounded-md border border-[var(--gt-border)] bg-black/15 px-2 py-2">
              <div className="flex items-center gap-2">
                <Wrench size={12} className="text-zinc-600" />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-zinc-300">{tool.tool}</span>
                <span className="text-[10.5px] tabular-nums text-zinc-500">{nf.format(tool.count)}</span>
              </div>
              <div className="mt-1"><Gauge pct={(tool.count / Math.max(1, topTools[0]?.count || 1)) * 100} color="var(--gt-blue)" /></div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function ResultGrid({
  query,
  busy,
  selection,
  initialFilter,
  onSelect,
}: {
  query: ObservabilityIndexQueryResult | null
  busy: boolean
  selection: IndexedRowSelection | null
  initialFilter: string
  onSelect: (query: ObservabilityIndexQueryId, row: Record<string, unknown>) => void
}) {
  const [filter, setFilter] = useState('')
  const [toolFilter, setToolFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const columns = useMemo(() => visibleColumns(query), [query])
  const toolOptions = useMemo(
    () =>
      [...new Set((query?.rows ?? []).map((row) => rowString(row, 'tool_name')).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [query],
  )
  const statusOptions = useMemo(
    () =>
      [...new Set((query?.rows ?? []).map((row) => rowString(row, 'status')).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [query],
  )
  useEffect(() => {
    setFilter(initialFilter)
    setToolFilter('all')
    setStatusFilter('all')
    setSortCol(defaultSortColumn(query?.query))
    setSortDir('desc')
  }, [initialFilter, query?.query, query?.indexedAt])

  const rows = useMemo(() => {
    if (!query) return []
    const q = filter.trim().toLowerCase()
    return query.rows
      .filter((row) => toolFilter === 'all' || rowString(row, 'tool_name') === toolFilter)
      .filter((row) => statusFilter === 'all' || rowString(row, 'status') === statusFilter)
      .filter((row) => !q || Object.values(row).some((value) => displayCell(value).toLowerCase().includes(q)))
      .sort((a, b) => {
        if (!sortCol) return 0
        const av = a[sortCol]
        const bv = b[sortCol]
        const an = numericCell(av)
        const bn = numericCell(bv)
        const diff =
          an !== null && bn !== null
            ? an - bn
            : displayCell(av).localeCompare(displayCell(bv), undefined, { numeric: true, sensitivity: 'base' })
        return sortDir === 'asc' ? diff : -diff
      })
  }, [filter, query, sortCol, sortDir, statusFilter, toolFilter])

  const chooseSort = (column: string) => {
    if (sortCol === column) {
      setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortCol(column)
      setSortDir('desc')
    }
  }

  const quickSorts = [
    ['turn_input_tokens', 'Input tokens'],
    ['turn_output_tokens', 'Output tokens'],
    ['turn_total_tokens', 'Total tokens'],
    ['input_bytes', 'Input payload'],
    ['output_bytes', 'Output payload'],
  ].filter(([column]) => query?.columns.includes(column))

  useEffect(() => {
    if (!query || rows.length === 0) return
    if (selection?.query === query.query && rows.includes(selection.row)) return
    onSelect(query.query, rows[0])
  }, [onSelect, query?.query, rows, selection?.query, selection?.row])

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--gt-border)] bg-[var(--gt-bg)]">
      <div className="flex min-h-[76px] shrink-0 flex-col gap-2 border-b border-[var(--gt-border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
        <Search size={14} className="text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-zinc-100">{query?.title || 'No indexed query loaded'}</div>
          <div className="truncate text-[10.5px] text-zinc-600">{query?.description || 'Build the index, then choose a query.'}</div>
        </div>
        {toolOptions.length > 0 && (
          <select
            value={toolFilter}
            onChange={(event) => setToolFilter(event.target.value)}
            className="h-8 max-w-[150px] rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[11px] text-zinc-300 outline-none"
            title="Filter tool"
          >
            <option value="all">all tools</option>
            {toolOptions.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
          </select>
        )}
        {statusOptions.length > 0 && (
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-8 max-w-[120px] rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[11px] text-zinc-300 outline-none"
            title="Filter status"
          >
            <option value="all">all status</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        )}
        <button
          onClick={() => setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-200"
          title={`Sort ${sortDir === 'desc' ? 'descending' : 'ascending'}`}
        >
          <ArrowDownWideNarrow size={13} className={sortDir === 'asc' ? 'rotate-180' : ''} />
        </button>
        <div className="relative w-56 max-w-[28%]">
          <Search size={12} className="pointer-events-none absolute left-2 top-2 text-zinc-700" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter rows"
            className="h-8 w-full rounded-md border border-[var(--gt-border)] bg-black/20 pl-7 pr-2 text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/70"
          />
        </div>
        {busy && <RefreshCw size={13} className="animate-spin text-zinc-600" />}
        {query && <Badge tone="mute">{nf.format(rows.length)} rows</Badge>}
        </div>
        {quickSorts.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-700">Hotspots</span>
            {quickSorts.map(([column, label]) => (
              <button
                key={column}
                onClick={() => {
                  setSortCol(column)
                  setSortDir('desc')
                }}
                className={`shrink-0 rounded-md border px-2 py-1 text-[10.5px] font-semibold ${
                  sortCol === column
                    ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {query?.error ? (
          <div className="p-4 text-[12px] text-[var(--gt-red)]">{query.error}</div>
        ) : !query ? (
          <div className="p-4 text-[12px] text-zinc-600">Build the index to start debugging token spend.</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-[12px] text-zinc-600">No rows match the current filter.</div>
        ) : (
          <table className="w-full min-w-[960px] text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-[var(--gt-panel)] text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    onClick={() => chooseSort(col)}
                    className="cursor-pointer border-b border-[var(--gt-border)] px-2 py-2 font-semibold hover:text-zinc-300"
                    title={`Sort by ${col.replaceAll('_', ' ')}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {columnLabel(col)}
                      {sortCol === col && <span className="text-[var(--gt-accent-light)]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, GRID_RENDER_CAP).map((row, index) => {
                const on = selection?.query === query.query && selection.row === row
                return (
                  <tr
                    key={index}
                    onClick={() => onSelect(query.query, row)}
                    className={`cursor-pointer border-b border-[var(--gt-border)]/70 odd:bg-white/[0.025] hover:bg-[var(--gt-accent)]/10 ${
                      on ? 'bg-[var(--gt-accent)]/15 outline outline-1 -outline-offset-1 outline-[var(--gt-accent)]/45' : ''
                    }`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={`truncate px-2 py-2 tabular-nums ${
                          col === 'command_preview' || col === 'command_text' || col === 'text'
                            ? 'max-w-[360px] font-mono text-zinc-500'
                            : 'max-w-[220px] text-zinc-400'
                        }`}
                        title={displayCell(row[col])}
                      >
                        {col === 'truncated'
                          ? displayCell(row[col]) === '1' ? <span className="text-[var(--gt-yellow)]">truncated</span> : '—'
                          : col === 'cost_usd'
                            ? usd.format(numericCell(row[col]) ?? 0)
                            : displayCell(row[col])}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {query && rows.length > GRID_RENDER_CAP && (
          <div className="sticky bottom-0 border-t border-[var(--gt-border)] bg-[var(--gt-panel)] px-3 py-1.5 text-center text-[10.5px] text-zinc-600">
            Painting top {nf.format(GRID_RENDER_CAP)} of {nf.format(rows.length)} matched rows (sorted across the full set) — filter to narrow.
          </div>
        )}
      </div>
    </section>
  )
}

function CallFocus({
  detail,
  callId,
  payload,
  busy,
}: {
  detail: ObservabilitySessionDetail | null
  callId: string
  payload: ObservabilityToolCallPayload | null
  busy: boolean
}) {
  const [payloadTab, setPayloadTab] = useState<'input' | 'output'>('input')
  const call = detail?.toolCalls.find((tool) => tool.callId === callId) || null
  const text = payloadTab === 'input' ? payload?.inputText || '' : payload?.outputText || ''
  const size = payloadTab === 'input' ? payload?.inputBytes || call?.argumentsBytes || 0 : payload?.outputBytes || call?.outputBytes || 0
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="shrink-0 rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={statusTone(call?.status || payload?.status || 'open')}>{call?.status || payload?.status || 'call'}</Badge>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-100">{call?.toolName || payload?.toolName || 'Tool call'}</span>
          {busy && <RefreshCw size={12} className="animate-spin text-zinc-600" />}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10.5px] text-zinc-600">
          <span className="font-mono">{callId || 'no call selected'}</span>
          {call?.line && <span>line {call.line}</span>}
          <span>{bytes(payload?.inputBytes || call?.argumentsBytes)} in</span>
          <span>{bytes(payload?.outputBytes || call?.outputBytes)} out</span>
          <span>{duration(call?.durationMs)}</span>
        </div>
        <div className="mt-2 flex gap-1">
          {[
            ['input', 'Input', payload?.inputBytes || call?.argumentsBytes || 0],
            ['output', 'Output', payload?.outputBytes || call?.outputBytes || 0],
          ].map(([id, label, n]) => (
            <button
              key={id as string}
              onClick={() => setPayloadTab(id as typeof payloadTab)}
              className={`h-7 flex-1 rounded-md border px-2 text-[10.5px] font-semibold ${
                payloadTab === id
                  ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label as string} <span className="text-zinc-600">{bytes(n as number)}</span>
            </button>
          ))}
        </div>
      </div>
      <ExactPayloadBox
        title={payloadTab === 'input' ? 'Exact Input' : 'Exact Output'}
        text={text}
        bytesValue={size}
        empty={
          busy
            ? `Loading exact ${payloadTab}...`
            : payloadTab === 'output' && call?.status === 'open'
              ? 'Call is still open.'
              : `No ${payloadTab} payload for this call.`
        }
      />
    </div>
  )
}

function RawTranscriptView({ transcript, busy }: { transcript: ObservabilityTranscriptWindow | null; busy: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--gt-border)] bg-black/15">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-2">
        <FileText size={12} className="text-zinc-500" />
        <span className="text-[11px] font-semibold text-zinc-300">Raw Transcript</span>
        {busy && <RefreshCw size={12} className="animate-spin text-zinc-600" />}
        {transcript && (
          <span className="ml-auto text-[10px] text-zinc-600">
            lines {transcript.startLine}-{transcript.endLine} / {transcript.totalLines}
          </span>
        )}
        <button
          onClick={() => navigator.clipboard?.writeText(transcript?.lines.map((line) => line.text).join('\n') || '')}
          disabled={!transcript?.lines.length}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          title="Copy raw transcript window"
        >
          <Clipboard size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!transcript ? (
          <div className="p-3 text-[12px] text-zinc-600">{busy ? 'Loading transcript window...' : 'No raw transcript window loaded.'}</div>
        ) : (
          <div className="min-w-[760px] font-mono text-[10.5px] leading-relaxed">
            {transcript.lines.map((line) => (
              <div key={line.line} className="grid grid-cols-[56px_96px_minmax(0,1fr)] border-b border-[var(--gt-border)]/60">
                <div className="select-none bg-black/20 px-2 py-1 text-right tabular-nums text-zinc-700">{line.line}</div>
                <div className="truncate border-l border-[var(--gt-border)]/60 px-2 py-1 text-zinc-600">
                  {line.role || line.kind || 'jsonl'}
                </div>
                <pre className="whitespace-pre-wrap break-words border-l border-[var(--gt-border)]/60 px-2 py-1 text-zinc-400">{line.text}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
      {transcript?.sourceFile && (
        <div className="shrink-0 truncate border-t border-[var(--gt-border)] px-2 py-1 font-mono text-[10px] text-zinc-700">
          {transcript.sourceFile}
        </div>
      )}
    </div>
  )
}

// Renders the FULL request/response JSON (and error / event text) captured in the
// SQLite index, read straight from the selected query row — no transcript re-read.
function PayloadInspect({ row }: { row: Record<string, unknown> | null }) {
  const fields = useMemo(() => {
    if (!row) return [] as { id: string; title: string; text: string; bytes: number }[]
    const out: { id: string; title: string; text: string; bytes: number }[] = []
    const command = rowString(row, 'command_text')
    const input = rowString(row, 'input_json')
    const output = rowString(row, 'output_json')
    const error = rowString(row, 'error_text')
    const text = rowString(row, 'text')
    const inBytes = numericCell(row['input_bytes'])
    const outBytes = numericCell(row['output_bytes'])
    if (command) out.push({ id: 'command', title: 'Command', text: command, bytes: command.length })
    if (input) out.push({ id: 'input', title: 'Request JSON', text: input, bytes: inBytes ?? input.length })
    if (output) out.push({ id: 'output', title: 'Response', text: output, bytes: outBytes ?? output.length })
    if (error) out.push({ id: 'error', title: 'Error output', text: error, bytes: outBytes ?? error.length })
    if (text) out.push({ id: 'text', title: 'Event content', text, bytes: numericCell(row['bytes']) ?? text.length })
    return out
  }, [row])
  const [tab, setTab] = useState(0)
  useEffect(() => setTab(0), [row])

  if (!row) {
    return <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] text-zinc-600">Select a row to inspect its stored payload.</div>
  }
  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] leading-5 text-zinc-500">
        No full payload stored for this row. Reindex to capture exact request/response JSON for tool calls.
      </div>
    )
  }
  const active = fields[Math.min(tab, fields.length - 1)]
  const truncated = rowString(row, 'truncated') === '1'
  const callId = rowString(row, 'call_id')
  const tool = rowString(row, 'tool_name')
  const status = rowString(row, 'status')
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="shrink-0 rounded-md border border-[var(--gt-border)] bg-black/15 p-2">
        <div className="flex min-w-0 items-center gap-2">
          {status && <Badge tone={statusTone(status)}>{status}</Badge>}
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-100">{tool || 'Stored payload'}</span>
          {truncated && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--gt-yellow)]">
              <AlertTriangle size={11} /> capped at 1 MB
            </span>
          )}
        </div>
        {callId && <div className="mt-1 truncate font-mono text-[10.5px] text-zinc-600">{callId}</div>}
        <div className="mt-2 flex flex-wrap gap-1">
          {fields.map((field, index) => (
            <button
              key={field.id}
              onClick={() => setTab(index)}
              className={`h-7 rounded-md border px-2 text-[10.5px] font-semibold ${
                index === Math.min(tab, fields.length - 1)
                  ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {field.title} <span className="text-zinc-600">{bytes(field.bytes)}</span>
            </button>
          ))}
        </div>
      </div>
      <ExactPayloadBox title={active.title} text={active.text} bytesValue={active.bytes} empty="Empty payload." />
    </div>
  )
}

function InspectorPane({
  selection,
  selected,
  detail,
  detailBusy,
  mode,
  focusedCallId,
  payload,
  payloadBusy,
  transcript,
  transcriptBusy,
  onMode,
  onRelatedCalls,
  onSessionEvents,
}: {
  selection: IndexedRowSelection | null
  selected: ObservabilitySession | null
  detail: ObservabilitySessionDetail | null
  detailBusy: boolean
  mode: InspectorMode
  focusedCallId: string
  payload: ObservabilityToolCallPayload | null
  payloadBusy: boolean
  transcript: ObservabilityTranscriptWindow | null
  transcriptBusy: boolean
  onMode: (mode: InspectorMode) => void
  onRelatedCalls: (row: Record<string, unknown>) => void
  onSessionEvents: (sessionId: string) => void
}) {
  const row = selection?.row || null
  const callId = focusedCallId || rowString(row || {}, 'call_id')
  const summaryColumns = [
    'tool_name',
    'repo',
    'status',
    'turn_input_tokens',
    'turn_output_tokens',
    'turn_total_tokens',
    'input_bytes',
    'output_bytes',
    'duration_ms',
    'line',
    'turn_id',
    'model',
    'cost_usd',
  ].filter((key) => row && row[key] !== undefined && row[key] !== '')

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--gt-panel)]">
      <div className="shrink-0 border-b border-[var(--gt-border)] p-3">
        <div className="flex flex-wrap items-center gap-1">
          {[
            ['overview', Activity, 'Overview'],
            ['tools', Wrench, 'Calls'],
            ['tokens', GaugeCircle, 'Tokens'],
            ['timeline', MessageSquare, 'Activity'],
            ['payload', Braces, 'Payload'],
            ['raw', FileText, 'Raw'],
          ].map(([id, Icon, label]) => (
            <button
              key={id as string}
              onClick={() => onMode(id as typeof mode)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10.5px] font-semibold ${
                mode === id
                  ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon size={12} strokeWidth={2.2} />
              {label as string}
            </button>
          ))}
          {selected && (
            <button
              onClick={() => onSessionEvents(selected.id)}
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[10.5px] font-semibold text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
              title="Load the full chronological event stream for this session from the index"
            >
              <ListTree size={12} strokeWidth={2.2} />
              Event stream
            </button>
          )}
          {detailBusy && <RefreshCw size={12} className="animate-spin text-zinc-600" />}
        </div>
      </div>

      {row && (
        <div className="shrink-0 border-b border-[var(--gt-border)] bg-black/10 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={selection?.query === 'tool_calls' ? 'accent' : selection?.query === 'audit' ? 'yellow' : 'blue'}>
              {(selection?.query || 'row').replaceAll('_', ' ')}
            </Badge>
            {rowString(row, 'command_preview') && <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-zinc-500">{rowString(row, 'command_preview')}</span>}
          </div>
          <div className="grid gap-1 md:grid-cols-3">
            {summaryColumns.slice(0, 9).map((col) => (
              <div key={col} className="min-w-0 rounded border border-[var(--gt-border)] bg-black/20 px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700">{columnLabel(col)}</div>
                <div className="truncate font-mono text-[10px] text-zinc-400" title={displayCell(row[col])}>{displayCell(row[col]) || 'n/a'}</div>
              </div>
            ))}
          </div>
          {selection?.query !== 'tool_calls' && (
            <button
              onClick={() => row && onRelatedCalls(row)}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[10.5px] font-semibold text-zinc-400 hover:text-zinc-100"
            >
              <Wrench size={12} />
              See related calls
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {mode === 'payload' ? (
          <PayloadInspect row={row} />
        ) : !selected ? (
          <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] text-zinc-600">Select a row or session.</div>
        ) : selected.engine !== 'claude' ? (
          <div className="rounded-md border border-[var(--gt-border)] bg-black/15 p-4 text-[12px] leading-5 text-zinc-500">
            Detailed transcript events are currently implemented for Claude transcripts. This {selected.engine} session is metadata-only.
          </div>
        ) : detailBusy && !detail ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-zinc-600">Loading transcript context...</div>
        ) : mode === 'tools' && callId ? (
          <CallFocus detail={detail} callId={callId} payload={payload} busy={payloadBusy} />
        ) : mode === 'tools' && detail ? (
          <ToolsView sessionId={detail.session.id} tools={detail.toolCalls} />
        ) : mode === 'raw' ? (
          <RawTranscriptView transcript={transcript} busy={transcriptBusy} />
        ) : mode === 'tokens' && detail ? (
          <TokensView detail={detail} />
        ) : mode === 'timeline' && detail ? (
          <ActivityView detail={detail} />
        ) : (
          <SummaryView session={selected} detail={detail} />
        )}
      </div>
    </aside>
  )
}

function Crumb({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 ${dim ? 'text-zinc-600' : 'text-zinc-300'}`}>{children}</span>
}

function ContextBar({
  selected,
  selection,
  focusedCallId,
  mode,
}: {
  selected: ObservabilitySession | null
  selection: IndexedRowSelection | null
  focusedCallId: string
  mode: InspectorMode
}) {
  const row = selection?.row || null
  const turn = rowString(row || {}, 'turn_id')
  const call = focusedCallId || rowString(row || {}, 'call_id')
  const repo = selected?.repo || selected?.cwd || ''

  const crumbs: React.ReactNode[] = []
  if (selected) {
    crumbs.push(
      <Crumb key="engine">
        <EngineLogo engine={selected.engine} size={12} />
        <span className="uppercase tracking-wide">{selected.engine}</span>
      </Crumb>,
    )
    if (repo) {
      crumbs.push(
        <Crumb key="repo" dim>
          <GitBranch size={11} />
          <span className="max-w-[200px] truncate">{repo}</span>
        </Crumb>,
      )
    }
    if (selected.title) {
      crumbs.push(
        <Crumb key="title">
          <span className="max-w-[280px] truncate">{selected.title}</span>
        </Crumb>,
      )
    }
    if (turn) crumbs.push(<Crumb key="turn" dim>turn {turn}</Crumb>)
    if (call) {
      crumbs.push(
        <Crumb key="call" dim>
          <span className="max-w-[160px] truncate font-mono">{call}</span>
        </Crumb>,
      )
    }
  }
  crumbs.push(
    <Crumb key="mode">
      <Badge tone="accent">{MODE_LABELS[mode]}</Badge>
    </Crumb>,
  )

  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 px-3 text-[11px]">
      {!selected && <span className="shrink-0 text-zinc-600">No session selected</span>}
      {crumbs.map((crumb, index) => (
        <Fragment key={index}>
          {index > 0 && <ChevronRight size={12} className="shrink-0 text-zinc-700" />}
          {crumb}
        </Fragment>
      ))}
    </div>
  )
}

function ObservabilityTab({ ctx }: { ctx: TabContext }) {
  const [snap, setSnap] = useState<ObservabilitySnapshot | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<ObservabilitySessionDetail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [mode, setMode] = useState<InspectorMode>('tools')
  const [sessionFilter, setSessionFilter] = useState<'all' | 'tools' | 'quiet'>('all')
  const [focusedCallId, setFocusedCallId] = useState('')
  const [selection, setSelection] = useState<IndexedRowSelection | null>(null)
  const [payload, setPayload] = useState<ObservabilityToolCallPayload | null>(null)
  const [payloadBusy, setPayloadBusy] = useState(false)
  const [transcript, setTranscript] = useState<ObservabilityTranscriptWindow | null>(null)
  const [transcriptBusy, setTranscriptBusy] = useState(false)
  const [gridFilter, setGridFilter] = useState('')
  const [indexStatus, setIndexStatus] = useState<ObservabilityIndexStatus | null>(null)
  const [indexQuery, setIndexQuery] = useState<ObservabilityIndexQueryResult | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const next = await window.gt.agentview.snapshot(160)
      setSnap(next)
      setSelectedId((cur) => (cur && next.sessions.some((s) => s.id === cur) ? cur : next.sessions[0]?.id || ''))
    } catch (e) {
      setErr((e as Error).message || 'Could not load observability snapshot.')
    } finally {
      setBusy(false)
    }
  }

  // session_events needs a session arg; fall back to tool_calls for the no-arg
  // status/rebuild refreshes so we never re-fire it without scope.
  const reloadableQuery = (): ObservabilityIndexQueryId =>
    indexQuery?.query && indexQuery.query !== 'session_events' ? indexQuery.query : 'tool_calls'

  const loadIndexStatus = async () => {
    const status = await window.gt.observability.indexStatus()
    setIndexStatus(status)
    if (status.exists) {
      const query = await window.gt.observability.indexQuery(reloadableQuery())
      setIndexQuery(query)
    }
  }

  const runIndexQuery = async (query: ObservabilityIndexQueryId) => {
    setIndexBusy(true)
    try {
      setIndexQuery(await window.gt.observability.indexQuery(query))
    } finally {
      setIndexBusy(false)
    }
  }

  const rebuildIndex = async () => {
    setIndexBusy(true)
    setErr('')
    try {
      const status = await window.gt.observability.rebuildIndex(100000)
      setIndexStatus(status)
      setIndexQuery(await window.gt.observability.indexQuery(reloadableQuery()))
    } catch (e) {
      setErr((e as Error).message || 'Could not rebuild observability index.')
    } finally {
      setIndexBusy(false)
    }
  }

  const selectIndexedRow = (query: ObservabilityIndexQueryId, row: Record<string, unknown>) => {
    setSelection({ query, row })
    if (query === 'tool_call_bloat') return
    // session_events rows are scoped to the already-selected session and carry no
    // session_id of their own — keep the current session and show the stored text.
    if (query === 'session_events') {
      setFocusedCallId('')
      setMode('payload')
      return
    }

    const sessionId = rowString(row, 'session_id')
    if (sessionId) {
      setSessionFilter('all')
      setSelectedId(sessionId)
    }

    if (query === 'tool_calls') {
      setFocusedCallId(rowString(row, 'call_id'))
      setMode('tools')
    } else if (query === 'tool_payloads' || query === 'tool_errors') {
      setFocusedCallId(rowString(row, 'call_id'))
      setMode('payload')
    } else if (query === 'turn_hotspots' || query === 'costliest_turns' || query === 'low_yield_sessions' || query === 'sessions_by_tokens') {
      setFocusedCallId('')
      setMode('tokens')
    } else if (sessionId) {
      setFocusedCallId('')
      setMode('overview')
    }
  }

  const runSessionEvents = async (sessionId: string) => {
    if (!sessionId) return
    setIndexBusy(true)
    setGridFilter('')
    try {
      setIndexQuery(await window.gt.observability.indexQuery('session_events', sessionId))
    } catch (e) {
      setErr((e as Error).message || 'Could not load the session event stream.')
    } finally {
      setIndexBusy(false)
    }
  }

  const showRelatedCalls = (row: Record<string, unknown>) => {
    const turnId = rowString(row, 'turn_id')
    const sessionId = rowString(row, 'session_id')
    setGridFilter([sessionId, turnId].filter(Boolean).join(' '))
    setFocusedCallId('')
    setMode('tools')
    runIndexQuery('tool_calls').catch(() => {})
  }

  useEffect(() => {
    load()
    loadIndexStatus().catch(() => {})
  }, [ctx.sessionId])

  useEffect(() => {
    let canceled = false
    const loadDetail = async () => {
      if (!selectedId) {
        setDetail(null)
        return
      }
      setDetailBusy(true)
      try {
        const next = await window.gt.agentview.session(selectedId)
        if (!canceled) setDetail(next)
      } catch (e) {
        if (!canceled) {
          setDetail(null)
          setErr((e as Error).message || 'Could not load session detail.')
        }
      } finally {
        if (!canceled) setDetailBusy(false)
      }
    }
    loadDetail()
    return () => {
      canceled = true
    }
  }, [selectedId])

  useEffect(() => {
    const first = indexQuery?.rows[0]
    if (!indexQuery || !first) {
      setSelection(null)
      return
    }
    selectIndexedRow(indexQuery.query, first)
  }, [indexQuery?.query, indexQuery?.indexedAt])

  useEffect(() => {
    let canceled = false
    const loadPayload = async () => {
      const callId = focusedCallId || rowString(selection?.row || {}, 'call_id')
      const sessionId = rowString(selection?.row || {}, 'session_id') || selectedId
      if (!sessionId || !callId || mode !== 'tools') {
        setPayload(null)
        return
      }
      setPayloadBusy(true)
      try {
        const next = await window.gt.agentview.toolCall(sessionId, callId)
        if (!canceled) setPayload(next)
      } finally {
        if (!canceled) setPayloadBusy(false)
      }
    }
    loadPayload()
    return () => {
      canceled = true
    }
  }, [focusedCallId, mode, selectedId, selection?.row])

  useEffect(() => {
    let canceled = false
    const loadTranscript = async () => {
      if (!selectedId || mode !== 'raw') {
        setTranscript(null)
        return
      }
      const line = Number(rowString(selection?.row || {}, 'line') || rowString(selection?.row || {}, 'completed_line') || 0)
      setTranscriptBusy(true)
      try {
        const next = await window.gt.agentview.transcriptWindow(selectedId, Number.isFinite(line) ? line : 0, 36)
        if (!canceled) setTranscript(next)
      } finally {
        if (!canceled) setTranscriptBusy(false)
      }
    }
    loadTranscript()
    return () => {
      canceled = true
    }
  }, [mode, selectedId, selection?.row])

  const allSessions = snap?.sessions ?? []
  const sessions = useMemo(
    () =>
      allSessions.filter((session) =>
        sessionFilter === 'tools' ? session.toolTotal > 0 : sessionFilter === 'quiet' ? session.toolTotal === 0 : true,
      ),
    [allSessions, sessionFilter],
  )
  const selected = allSessions.find((s) => s.id === selectedId) ?? (detail?.session.id === selectedId ? detail.session : null) ?? sessions[0] ?? allSessions[0] ?? null
  const selectedDetail = detail?.session.id === selected?.id ? detail : null
  useEffect(() => {
    if (sessions.length === 0) return
    if (!selectedId) setSelectedId(sessions[0].id)
  }, [sessionFilter, sessions, selectedId])
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
        <RadioTower size={15} strokeWidth={2.25} className="text-[var(--gt-accent-light)]" />
        <span className="text-[12px] font-semibold text-zinc-100">Observability</span>
        <Badge tone="accent">trace browser</Badge>
        {indexQuery && <Badge tone="mute">{indexQuery.query.replaceAll('_', ' ')}</Badge>}
        {snap && <span className="text-[10.5px] text-zinc-600">updated {reltime(snap.ts)}</span>}
        {err && <span className="text-[11px] text-[var(--gt-red)]">{err}</span>}
        <button
          onClick={load}
          disabled={busy}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 text-[11px] font-semibold text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100 disabled:opacity-50"
        >
          <RefreshCw size={12} strokeWidth={2.2} className={busy ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {!snap ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-zinc-600">
          {busy ? 'Loading observability…' : 'No observability snapshot loaded.'}
        </div>
      ) : (
        <>
        <ContextBar selected={selected} selection={selection} focusedCallId={focusedCallId} mode={mode} />
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(460px,1fr)_minmax(430px,0.82fr)] overflow-hidden">
          <QueryRail
            snap={snap}
            status={indexStatus}
            active={indexQuery?.query || 'tool_calls'}
            busy={indexBusy}
            onRebuild={rebuildIndex}
            onQuery={(query) => {
              setGridFilter('')
              runIndexQuery(query)
            }}
          />
          <ResultGrid
            query={indexQuery}
            busy={indexBusy}
            selection={selection}
            initialFilter={gridFilter}
            onSelect={selectIndexedRow}
          />
          <InspectorPane
            selection={selection}
            selected={selected}
            detail={selectedDetail}
            detailBusy={detailBusy}
            mode={mode}
            focusedCallId={focusedCallId}
            payload={payload}
            payloadBusy={payloadBusy}
            transcript={transcript}
            transcriptBusy={transcriptBusy}
            onMode={setMode}
            onRelatedCalls={showRelatedCalls}
            onSessionEvents={runSessionEvents}
          />
        </div>
        </>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'observability',
  title: 'Observability',
  icon: RadioTower,
  order: 7,
  appliesTo: () => true,
  Component: ObservabilityTab,
}

export default tab
