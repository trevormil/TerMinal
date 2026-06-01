import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { sanitizeLog as stripAnsi } from '../../lib/sanitizeLog'

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
  const logRef = useRef<HTMLPreElement>(null)

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
      <pre
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[var(--gt-code-bg)] p-4 font-mono text-[11px] leading-relaxed text-[var(--gt-text-soft)]"
      >
        {visibleLog || 'Loading log...'}
      </pre>
    </div>
  )
}
