import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  ArrowDownToLine,
  Loader2,
} from 'lucide-react'
import { parseCiLog, type CiLogLine, type CiLogSection } from '../../lib/ciLogFormat'
import type { CiTabJob } from '../../lib/types'
import { spanStyle } from './ciShared'

// Structured job-log viewer: fetches the raw log via window.gt.ci.log, runs it
// through parseCiLog (the shared, tested formatter), and renders the result as
// collapsible sections with a dim HH:MM:SS gutter and per-line kind styling.

const lineTone: Record<CiLogLine['kind'], string> = {
  normal: '',
  error: 'border-l-2 border-[var(--gt-red)] bg-[var(--gt-red)]/10 pl-1.5',
  warning: 'border-l-2 border-[var(--gt-yellow)] bg-[var(--gt-yellow)]/10 pl-1.5',
  command: 'border-l-2 border-[var(--gt-accent)]/50 pl-1.5 text-[var(--gt-accent-light)]',
}

function LogLine({ line, id }: { line: CiLogLine; id?: string }) {
  return (
    <div
      id={id}
      className={`flex min-w-max gap-2 whitespace-pre px-2 py-[1px] ${lineTone[line.kind]}`}
    >
      <span className="sticky left-0 select-none text-zinc-700">
        {line.kind === 'command'
          ? '$'
          : line.kind === 'error'
            ? '✕'
            : line.kind === 'warning'
              ? '!'
              : ' '}
      </span>
      {line.ts && <span className="select-none text-zinc-600">{line.ts}</span>}
      <span>
        {line.spans.map((sp, i) => (
          <span key={i} style={spanStyle(sp)}>
            {sp.text || ' '}
          </span>
        ))}
      </span>
    </div>
  )
}

function Section({
  section,
  index,
  firstErrorId,
}: {
  section: CiLogSection
  index: number
  firstErrorId: string | null
}) {
  const [open, setOpen] = useState(true)
  const hasError = section.lines.some((l) => l.kind === 'error')
  const hasWarn = section.lines.some((l) => l.kind === 'warning')

  // Ungrouped lines render flush (no foldable header).
  if (!section.name) {
    return (
      <div>
        {section.lines.map((l, i) => (
          <LogLine
            key={i}
            line={l}
            id={firstErrorId === `${index}-${i}` ? 'ci-first-error' : undefined}
          />
        ))}
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-white/5"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={2.5} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={12} strokeWidth={2.5} className="shrink-0 text-zinc-600" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-300">
          {section.name}
        </span>
        {hasError && (
          <AlertCircle size={11} strokeWidth={2.25} className="shrink-0 text-[var(--gt-red)]" />
        )}
        {!hasError && hasWarn && (
          <AlertTriangle
            size={11}
            strokeWidth={2.25}
            className="shrink-0 text-[var(--gt-yellow)]"
          />
        )}
        <span className="shrink-0 text-[9.5px] tabular-nums text-zinc-700">
          {section.lines.length}
        </span>
      </button>
      {open &&
        section.lines.map((l, i) => (
          <LogLine
            key={i}
            line={l}
            id={firstErrorId === `${index}-${i}` ? 'ci-first-error' : undefined}
          />
        ))}
    </div>
  )
}

export function LogView({
  repoRoot,
  job,
  forgeLabel,
}: {
  repoRoot: string
  job: CiTabJob
  forgeLabel: string
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setRaw(null)
    setError(null)
    setTruncated(false)
    window.gt.ci
      .log(repoRoot, job.id)
      .then((r) => {
        if (!alive) return
        if (r.error) setError(r.error)
        else {
          setRaw(r.log)
          setTruncated(!!r.truncated)
        }
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [repoRoot, job.id])

  const parsed = useMemo(() => (raw != null ? parseCiLog(raw) : null), [raw])

  // Locate the first error line so the jump button can scroll to it.
  const firstErrorId = useMemo(() => {
    if (!parsed) return null
    for (let s = 0; s < parsed.sections.length; s++) {
      const li = parsed.sections[s].lines.findIndex((l) => l.kind === 'error')
      if (li >= 0) return `${s}-${li}`
    }
    return null
  }, [parsed])

  const jumpToError = () => {
    const el = scrollRef.current?.querySelector('#ci-first-error')
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
        <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-200">{job.name}</span>
        {parsed && parsed.errorCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[var(--gt-red)]">
            <AlertCircle size={11} strokeWidth={2.25} />
            {parsed.errorCount} error{parsed.errorCount === 1 ? '' : 's'}
          </span>
        )}
        {parsed && parsed.warningCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[var(--gt-yellow)]">
            <AlertTriangle size={11} strokeWidth={2.25} />
            {parsed.warningCount} warning{parsed.warningCount === 1 ? '' : 's'}
          </span>
        )}
        <div className="flex-1" />
        {firstErrorId && (
          <button
            onClick={jumpToError}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-red)]/40 px-2 py-0.5 text-[10.5px] text-[var(--gt-red)] transition-colors hover:bg-[var(--gt-red)]/10"
          >
            <ArrowDownToLine size={11} strokeWidth={2.25} />
            First error
          </button>
        )}
        {job.webUrl && (
          <button
            onClick={() => window.gt.openExternal(job.webUrl)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white"
          >
            Open on {forgeLabel}
            <ExternalLink size={10} strokeWidth={2} />
          </button>
        )}
      </header>

      {truncated && (
        <div className="shrink-0 border-b border-[var(--gt-yellow)]/25 bg-[var(--gt-yellow)]/10 px-3 py-1 text-[10.5px] text-[var(--gt-yellow)]">
          Log truncated — showing the tail. Open on {forgeLabel} for the full output.
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-black/30 font-mono text-[11.5px] leading-[1.5] text-zinc-300"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-zinc-600">
            <Loader2 size={13} strokeWidth={2.25} className="animate-spin" />
            Loading log…
          </div>
        ) : error ? (
          <div className="m-3 rounded-md border border-[var(--gt-red)]/30 bg-[var(--gt-red)]/10 px-3 py-2 text-[11px] text-[var(--gt-red)]">
            {error}
          </div>
        ) : parsed && parsed.sections.length > 0 ? (
          <div className="py-1">
            {parsed.sections.map((s, i) => (
              <Section key={i} section={s} index={i} firstErrorId={firstErrorId} />
            ))}
          </div>
        ) : (
          <div className="px-3 py-4 text-[11px] text-zinc-600">(empty log)</div>
        )}
      </div>
    </div>
  )
}
