import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react'
import { sanitizeLog as stripAnsi } from '../../lib/sanitizeLog'
import { formatRunLog, type LogHighlight, type LogLineKind } from '../../lib/runLogFormat'
import { parseRunLog } from '../../../../shared/run-log'
import { StructuredRunLog } from '../../components/StructuredRunLog'

type RunSource = 'cron' | 'agent' | 'bg' | 'session'

/** Tail size the pane polls while a run streams. */
const TAIL_BYTES = 512 * 1024
/** Raw-view render bound — one <div> per line, so unbounded render janks. */
const RAW_LINE_CAP = 3000
const RAW_LINE_STEP = 5000

export function RunLogPane({
  source,
  runId,
  status,
  hostId,
  engine,
  className = '',
}: {
  source: RunSource
  runId: string
  status?: string
  hostId?: string
  engine?: string
  className?: string
}) {
  const [log, setLog] = useState<{
    runId: string
    text: string
    size: number
    truncated: boolean
  } | null>(null)
  // Full-log escape hatch: the pane polls a bounded tail (TAIL_BYTES) so a
  // multi-MB streaming log never freezes either process; "Load full log"
  // switches this run to the unbounded fetch.
  const [full, setFull] = useState(false)
  const [rawLineCap, setRawLineCap] = useState(RAW_LINE_CAP)
  const [logQuery, setLogQuery] = useState('')
  // Structured vs raw view. 'auto' resolves to structured when the parser found
  // real structure, raw otherwise — so unparseable logs degrade gracefully.
  const [viewPref, setViewPref] = useState<'auto' | 'structured' | 'raw'>('auto')
  // Metadata (branch/worktree/command chips) is reference detail, not something
  // you read while scanning output — collapsed by default so the log starts high.
  const [metaOpen, setMetaOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLog(null)
    setFull(false)
    setRawLineCap(RAW_LINE_CAP)
  }, [runId])

  useEffect(() => {
    let alive = true
    const fetch = async () => {
      try {
        if (full) {
          const text = await window.gt.agents.runLog(source, runId, hostId)
          if (alive) setLog({ runId, text, size: text.length, truncated: false })
          return
        }
        const t = await window.gt.agents.runLogTail(source, runId, hostId, TAIL_BYTES)
        // Unchanged tail → keep the same state object so nothing re-parses.
        if (alive)
          setLog((cur) =>
            cur && cur.runId === runId && cur.text === t.text && cur.truncated === t.truncated
              ? cur
              : { runId, ...t },
          )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (alive)
          setLog({ runId, text: `Unable to load run log: ${message}`, size: 0, truncated: false })
      }
    }
    fetch()
    if (status !== 'running') {
      return () => {
        alive = false
      }
    }
    const t = setInterval(fetch, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [runId, source, status, hostId, full])

  // Export buttons always deliver the FULL log, even while the pane shows a tail.
  const fetchFullText = async (): Promise<string> => {
    if (full || !log?.truncated) return log?.text ?? ''
    try {
      return await window.gt.agents.runLog(source, runId, hostId)
    } catch {
      return log?.text ?? ''
    }
  }

  const visibleLog = useMemo(() => {
    const raw = stripAnsi(log?.text || '')
    if (!raw) return ''
    const q = logQuery.trim().toLowerCase()
    if (!q) return raw
    const lines = raw.split('\n')
    const keep = new Set<number>()
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(q)) {
        keep.add(i)
        if (i > 0) keep.add(i - 1)
        if (i + 1 < lines.length) keep.add(i + 1)
      }
    })
    const indices = [...keep].sort((a, b) => a - b)
    const out: string[] = []
    let prev = -2
    for (const i of indices) {
      if (i > prev + 1) out.push('...')
      out.push(lines[i])
      prev = i
    }
    return out.join('\n') || `(no lines match "${logQuery}")`
  }, [log?.text, logQuery])

  // Raw view renders one node per line — cap it, with "show earlier" paging.
  const { cappedLog, hiddenLines } = useMemo(() => {
    const lines = visibleLog.split('\n')
    if (lines.length <= rawLineCap) return { cappedLog: visibleLog, hiddenLines: 0 }
    return {
      cappedLog: lines.slice(-rawLineCap).join('\n'),
      hiddenLines: lines.length - rawLineCap,
    }
  }, [visibleLog, rawLineCap])
  const formatted = useMemo(() => formatRunLog(cappedLog), [cappedLog])
  const parsed = useMemo(() => parseRunLog(log?.text || '', engine), [log?.text, engine])
  const view = viewPref === 'auto' ? (parsed.structured ? 'structured' : 'raw') : viewPref

  const highlightClass = (kind: LogHighlight['kind']) => {
    switch (kind) {
      case 'link':
        return 'border-[var(--gt-accent)]/35 bg-[var(--gt-accent)]/10 text-[var(--gt-accent-light)]'
      case 'done':
        return 'border-[var(--gt-green)]/35 bg-[var(--gt-green)]/10 text-[var(--gt-green)]'
      case 'failed':
        return 'border-[var(--gt-red)]/35 bg-[var(--gt-red)]/10 text-[var(--gt-red)]'
      default:
        return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'
    }
  }

  const highlightIcon = (kind: LogHighlight['kind']) => {
    if (kind === 'link') return <ExternalLink size={11} strokeWidth={2} />
    if (kind === 'done') return <CheckCircle2 size={11} strokeWidth={2} />
    if (kind === 'failed') return <TriangleAlert size={11} strokeWidth={2} />
    if (kind === 'tool') return <Wrench size={11} strokeWidth={2} />
    return <Terminal size={11} strokeWidth={2} />
  }

  const lineClass = (kind: LogLineKind) => {
    switch (kind) {
      case 'heading':
        return 'text-zinc-100 font-semibold'
      case 'list':
        return 'text-zinc-300'
      case 'code':
        return 'bg-black/20 text-zinc-300'
      case 'step':
        return 'my-1 rounded-md border border-[var(--gt-accent)]/25 bg-[var(--gt-accent)]/10 px-2 py-1 text-[var(--gt-accent-light)]'
      case 'tool':
        return 'text-cyan-300'
      case 'error':
        return 'text-[var(--gt-red)]'
      case 'success':
        return 'text-[var(--gt-green)]'
      case 'command':
        return 'text-amber-200'
      case 'meta':
        return 'text-zinc-500'
      case 'blank':
        return 'h-3'
      default:
        return 'text-[var(--gt-text-soft)]'
    }
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)]/40 bg-[var(--gt-panel)]/30 px-3 py-1.5">
        <Search size={11} strokeWidth={2} className="text-zinc-500" />
        <input
          value={logQuery}
          onChange={(e) => setLogQuery(e.target.value)}
          placeholder="Filter log lines..."
          className="flex-1 rounded-md bg-transparent px-1 py-0.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />
        {logQuery && (
          <button
            onClick={() => setLogQuery('')}
            className="rounded-md p-0.5 text-zinc-500 hover:text-zinc-200"
            title="Clear filter"
          >
            <X size={11} strokeWidth={2} />
          </button>
        )}
        {/* Structured/raw toggle — raw is always one click away (ticket 0020). */}
        <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)]/60 p-0.5">
          {(['structured', 'raw'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewPref(v)}
              disabled={v === 'structured' && !parsed.entries.length}
              className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider disabled:opacity-40 ${
                view === v ? 'bg-white/10 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        {/* Raw-log export: copy the full RAW log (pre-filter, pre-format) to the
            clipboard, or download it as <runId>.log — GitHub's "download raw logs". */}
        <button
          onClick={async () => window.gt.clipboardWrite(await fetchFullText())}
          disabled={!log?.text}
          className="rounded-md p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          title="Copy raw log"
        >
          <Copy size={11} strokeWidth={2} />
        </button>
        <button
          onClick={async () => {
            const url = URL.createObjectURL(
              new Blob([await fetchFullText()], { type: 'text/plain' }),
            )
            const a = document.createElement('a')
            a.href = url
            a.download = `run-${runId}.log`
            a.click()
            URL.revokeObjectURL(url)
          }}
          disabled={!log?.text}
          className="rounded-md p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          title="Download raw log"
        >
          <Download size={11} strokeWidth={2} />
        </button>
      </div>
      {/* Step nav (#3): multi-step runs get clickable chips — colored by step
          status — that scroll to the step boundary. The failed step is the jump-
          to-failure. Single-step runs (the common case) show nothing. */}
      {formatted.steps.length > 1 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--gt-border)]/40 bg-[var(--gt-panel)]/20 px-3 py-1">
          <span className="mr-0.5 text-[9.5px] uppercase tracking-wider text-zinc-600">steps</span>
          {formatted.steps.map((s) => (
            <button
              key={`${s.n}-${s.line}`}
              onClick={() =>
                document
                  .getElementById(view === 'structured' ? `sr-step-${s.n}` : `ll-${s.line}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              title={`${s.label}${s.exitCode != null ? ` · exit ${s.exitCode}` : ''}`}
              className={`inline-flex max-w-[160px] items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                s.status === 'failed'
                  ? 'border-[var(--gt-red)]/50 text-[var(--gt-red)]'
                  : s.status === 'ok'
                    ? 'border-[var(--gt-green)]/40 text-[var(--gt-green)]'
                    : 'border-[var(--gt-border)] text-zinc-400'
              }`}
            >
              <span className="font-mono">{s.n}</span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={logRef} className="min-h-0 flex-1 overflow-auto bg-[var(--gt-code-bg)]">
        {!visibleLog ? (
          <div className="p-4 font-mono text-[11px] text-zinc-600">Loading log...</div>
        ) : (
          <div className="min-w-full">
            {formatted.meta.length > 0 && (
              <div className="border-b border-[var(--gt-border)]/45 bg-[var(--gt-panel)]/35 px-4 py-2">
                <button
                  onClick={() => setMetaOpen((o) => !o)}
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600 hover:text-zinc-400"
                >
                  <ChevronRight
                    size={11}
                    strokeWidth={2.5}
                    className={`transition-transform ${metaOpen ? 'rotate-90' : ''}`}
                  />
                  Metadata
                  <span className="text-zinc-700">· {formatted.meta.length}</span>
                </button>
                {metaOpen && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {formatted.meta.map((line, i) => (
                      <span
                        key={`${line}-${i}`}
                        className="inline-flex max-w-full items-center rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 font-mono text-[10.5px] text-zinc-300"
                      >
                        <span className="truncate">{line}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {formatted.highlights.length > 0 && (
              <div className="border-b border-[var(--gt-border)]/45 bg-[var(--gt-panel)]/20 px-4 py-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                  Highlights
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {formatted.highlights.map((h, i) => {
                    const content = (
                      <>
                        {highlightIcon(h.kind)}
                        <span className="shrink-0 font-semibold">{h.label}</span>
                        <span className="min-w-0 truncate font-mono text-[10px] opacity-90">
                          {h.value}
                        </span>
                      </>
                    )
                    const cls = `inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] ${highlightClass(h.kind)}`
                    return h.url ? (
                      <button
                        key={`${h.kind}-${i}`}
                        onClick={() => window.gt.openExternal(h.url!)}
                        className={`${cls} hover:brightness-125`}
                        title={h.value}
                      >
                        {content}
                      </button>
                    ) : (
                      <span key={`${h.kind}-${i}`} className={cls} title={h.value}>
                        {content}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="border-b border-[var(--gt-border)]/35 bg-black/10 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
              Output
            </div>
            {log?.truncated && !full && (
              <div className="flex items-center gap-2 border-b border-[var(--gt-border)]/35 bg-black/10 px-4 py-1.5 text-[10.5px] text-zinc-500">
                Showing the last {Math.round(TAIL_BYTES / 1024)} KB of{' '}
                {(log.size / (1024 * 1024)).toFixed(1)} MB
                <button
                  onClick={() => setFull(true)}
                  className="text-[var(--gt-accent-2)] hover:underline"
                >
                  Load full log
                </button>
              </div>
            )}
            {view === 'structured' ? (
              <StructuredRunLog parsed={parsed} filter={logQuery} hideMeta className="px-4 py-3" />
            ) : (
              <div className="px-4 py-3 font-mono text-[11px] leading-relaxed">
                {hiddenLines > 0 && (
                  <button
                    onClick={() => setRawLineCap((c) => c + RAW_LINE_STEP)}
                    className="mb-2 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 text-[10.5px] text-[var(--gt-accent-2)] hover:border-[var(--gt-accent)]/50"
                  >
                    Show {Math.min(hiddenLines, RAW_LINE_STEP)} earlier lines ({hiddenLines} hidden)
                  </button>
                )}
                {formatted.lines.map((line, i) => (
                  <div
                    key={i}
                    id={`ll-${i}`}
                    className={`whitespace-pre-wrap break-words ${lineClass(line.kind)}`}
                  >
                    {line.kind === 'blank' ? '\u00a0' : line.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
