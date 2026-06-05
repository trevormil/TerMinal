import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { sanitizeLog as stripAnsi } from '../../lib/sanitizeLog'
import { formatRunLog, type LogLineKind } from '../../lib/runLogFormat'

type RunSource = 'cron' | 'agent' | 'bg'

export function RunLogPane({
  source,
  runId,
  status,
  className = '',
}: {
  source: RunSource
  runId: string
  status?: string
  className?: string
}) {
  const [log, setLog] = useState<{ runId: string; text: string } | null>(null)
  const [logQuery, setLogQuery] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLog(null)
    const fetch = async () => {
      try {
        const text = await window.gt.agents.runLog(source, runId)
        if (alive) setLog({ runId, text })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (alive) setLog({ runId, text: `Unable to load run log: ${message}` })
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
  }, [runId, source, status])

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

  const formatted = useMemo(() => formatRunLog(visibleLog), [visibleLog])

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
      </div>
      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto bg-[var(--gt-code-bg)]"
      >
        {!visibleLog ? (
          <div className="p-4 font-mono text-[11px] text-zinc-600">Loading log...</div>
        ) : (
          <div className="min-w-full">
            {formatted.meta.length > 0 && (
              <div className="border-b border-[var(--gt-border)]/45 bg-[var(--gt-panel)]/35 px-4 py-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                  Metadata
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {formatted.meta.map((line, i) => (
                    <span
                      key={`${line}-${i}`}
                      className="inline-flex max-w-full items-center rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 font-mono text-[10.5px] text-zinc-300"
                    >
                      <span className="truncate">{line}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="border-b border-[var(--gt-border)]/35 bg-black/10 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
              Output
            </div>
            <div className="px-4 py-3 font-mono text-[11px] leading-relaxed">
              {formatted.lines.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-words ${lineClass(line.kind)}`}
                >
                  {line.kind === 'blank' ? '\u00a0' : line.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
