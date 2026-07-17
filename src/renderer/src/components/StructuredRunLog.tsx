import { useMemo, useState, type ReactNode } from 'react'
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Terminal,
  TriangleAlert,
  User,
  Wrench,
} from 'lucide-react'
import {
  parseRunLog,
  sanitizeLog,
  type ParsedRunLog,
  type RunLogEntry,
} from '../../../shared/run-log'
import { Markdown } from './Markdown'

// Shared structured run-log transcript (ticket 0020). One renderer for every
// surface that shows run output: RunLogPane (Runs tab — agent/cron/bg/session
// via the UnifiedRun bridge), the Agents tab run pane, and Schedules run logs.
// Raw text stays one click away on every surface; anything the parser can't
// type renders as plain text blocks inside the transcript, never dropped.

// Rendered-entry cap: very long logs render the newest window first and reveal
// earlier entries on demand — cheap bounding without a virtualization dep.
const ENTRY_WINDOW = 300

const searchableText = (e: RunLogEntry): string => {
  switch (e.kind) {
    case 'meta':
    case 'banner':
      return e.lines.join('\n')
    case 'step':
      return `step ${e.n}/${e.total} ${e.label}`
    case 'tool':
      return `${e.name}\n${e.input || ''}\n${e.output || ''}`
    case 'command':
      return `${e.command}\n${e.output || ''}`
    default:
      return e.text
  }
}

function Clipped({
  text,
  clipAt,
  className = '',
}: {
  text: string
  clipAt: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n')
  const clipped = !open && lines.length > clipAt
  return (
    <>
      <pre
        className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${className}`}
      >
        {clipped ? lines.slice(0, clipAt).join('\n') : text}
      </pre>
      {lines.length > clipAt && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-0.5 rounded px-1 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          {clipped ? `Show ${lines.length - clipAt} more lines` : 'Show less'}
        </button>
      )}
    </>
  )
}

// Assistant/reasoning prose is markdown (claude -p and hermes emit full
// markdown documents) — render it, with the same show-more clipping as Clipped.
function MdClipped({
  text,
  clipAt,
  className = '',
}: {
  text: string
  clipAt: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n')
  const clipped = !open && lines.length > clipAt
  return (
    <>
      <Markdown className={`text-[11.5px] leading-relaxed ${className}`}>
        {clipped ? lines.slice(0, clipAt).join('\n') : text}
      </Markdown>
      {lines.length > clipAt && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-0.5 rounded px-1 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          {clipped ? `Show ${lines.length - clipAt} more lines` : 'Show less'}
        </button>
      )}
    </>
  )
}

function Disclosure({
  header,
  defaultOpen,
  borderClass = 'border-[var(--gt-border)]/60',
  children,
}: {
  header: ReactNode
  defaultOpen: boolean
  borderClass?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`rounded-md border ${borderClass} bg-black/15`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-white/5"
      >
        {open ? (
          <ChevronDown size={11} strokeWidth={2} className="shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight size={11} strokeWidth={2} className="shrink-0 text-zinc-500" />
        )}
        {header}
      </button>
      {open && <div className="border-t border-[var(--gt-border)]/40 px-2 py-1.5">{children}</div>}
    </div>
  )
}

const statusDot = (status: 'ok' | 'error' | 'unknown') => (
  <span
    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
      status === 'ok'
        ? 'bg-[var(--gt-green)]'
        : status === 'error'
          ? 'bg-[var(--gt-red)]'
          : 'bg-zinc-600'
    }`}
  />
)

const fmtDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

function Entry({ entry }: { entry: RunLogEntry }) {
  switch (entry.kind) {
    case 'meta':
      return (
        <div className="flex flex-wrap gap-1.5">
          {entry.lines.map((line, i) => (
            <span
              key={`${line}-${i}`}
              className="inline-flex max-w-full items-center rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 font-mono text-[10.5px] text-zinc-300"
            >
              <span className="truncate">{line}</span>
            </span>
          ))}
        </div>
      )
    case 'banner':
      return (
        <Disclosure
          defaultOpen={false}
          header={
            <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-zinc-500">
              <Info size={11} strokeWidth={2} className="shrink-0" />
              <span className="truncate font-mono">{entry.lines[0]}</span>
            </span>
          }
        >
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-zinc-500">
            {entry.lines.join('\n')}
          </pre>
        </Disclosure>
      )
    case 'prompt':
      return (
        <Disclosure
          defaultOpen={false}
          header={
            <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-zinc-400">
              <User size={11} strokeWidth={2} className="shrink-0 text-zinc-500" />
              <span className="shrink-0 font-semibold uppercase tracking-wider">Prompt</span>
              <span className="truncate font-mono text-zinc-600">{entry.text.split('\n')[0]}</span>
            </span>
          }
        >
          <Clipped text={entry.text} clipAt={40} className="text-zinc-400" />
        </Disclosure>
      )
    case 'assistant':
      return (
        <div className="flex gap-2">
          <Bot
            size={12}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]"
          />
          <div className="min-w-0 flex-1">
            <MdClipped text={entry.text} clipAt={40} className="text-zinc-200" />
          </div>
        </div>
      )
    case 'reasoning':
      return (
        <Disclosure
          defaultOpen={false}
          header={
            <span className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
              <Brain size={11} strokeWidth={2} className="shrink-0" />
              <span className="font-semibold uppercase tracking-wider">Thinking</span>
            </span>
          }
        >
          <MdClipped text={entry.text} clipAt={30} className="italic text-zinc-500" />
        </Disclosure>
      )
    case 'tool': {
      const hasBody = !!(entry.input || entry.output)
      const header = (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Wrench size={11} strokeWidth={2} className="shrink-0 text-cyan-300" />
          <span className="truncate font-mono text-[11px] text-cyan-200">{entry.name}</span>
          <span className="flex-1" />
          {statusDot(entry.status)}
        </span>
      )
      if (!hasBody)
        return (
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--gt-border)]/60 bg-black/15 px-2 py-1">
            {header}
          </div>
        )
      return (
        <Disclosure
          defaultOpen={entry.status === 'error'}
          borderClass={
            entry.status === 'error' ? 'border-[var(--gt-red)]/40' : 'border-[var(--gt-border)]/60'
          }
          header={header}
        >
          {entry.input && (
            <>
              <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-zinc-600">
                Input
              </div>
              <Clipped text={entry.input} clipAt={12} className="text-zinc-400" />
            </>
          )}
          {entry.output && (
            <>
              <div className="mb-0.5 mt-1 text-[9.5px] font-semibold uppercase tracking-wider text-zinc-600">
                Output
              </div>
              <Clipped
                text={entry.output}
                clipAt={12}
                className={entry.status === 'error' ? 'text-[var(--gt-red)]' : 'text-zinc-400'}
              />
            </>
          )}
        </Disclosure>
      )
    }
    case 'command': {
      const failed = entry.status === 'error'
      const header = (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Terminal size={11} strokeWidth={2} className="shrink-0 text-amber-300" />
          <span
            className={`min-w-0 flex-1 truncate font-mono text-[11px] ${failed ? 'text-[var(--gt-red)]' : 'text-amber-100'}`}
          >
            {entry.command.split('\n')[0]}
          </span>
          {/* codex reliably reports 0ms for fast commands — a 0ms badge reads
              as a parse bug, so only show real durations */}
          {entry.durationMs != null && entry.durationMs > 0 && (
            <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-zinc-600">
              {fmtDuration(entry.durationMs)}
            </span>
          )}
          {failed && entry.exitCode != null && (
            <span className="shrink-0 font-mono text-[9.5px] text-[var(--gt-red)]">
              exit {entry.exitCode}
            </span>
          )}
          {statusDot(entry.status)}
        </span>
      )
      const hasBody = entry.command.includes('\n') || !!entry.output
      if (!hasBody)
        return (
          <div
            className={`flex items-center gap-1.5 rounded-md border bg-black/15 px-2 py-1 ${failed ? 'border-[var(--gt-red)]/40' : 'border-[var(--gt-border)]/60'}`}
          >
            {header}
          </div>
        )
      return (
        <Disclosure
          defaultOpen={failed}
          borderClass={failed ? 'border-[var(--gt-red)]/40' : 'border-[var(--gt-border)]/60'}
          header={header}
        >
          {entry.command.includes('\n') && (
            <Clipped text={entry.command} clipAt={12} className="text-amber-100/90" />
          )}
          {entry.output && (
            <Clipped
              text={entry.output}
              clipAt={12}
              className={failed ? 'text-[var(--gt-red)]/90' : 'text-zinc-400'}
            />
          )}
        </Disclosure>
      )
    }
    case 'error':
      return (
        <div className="flex gap-2 rounded-md border border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 px-2 py-1.5">
          <TriangleAlert
            size={12}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-[var(--gt-red)]"
          />
          <Clipped text={entry.text} clipAt={20} className="min-w-0 flex-1 text-[var(--gt-red)]" />
        </div>
      )
    case 'summary':
      return (
        <div className="rounded-md border border-[var(--gt-green)]/30 bg-[var(--gt-green)]/8 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={12} strokeWidth={2} className="shrink-0 text-[var(--gt-green)]" />
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--gt-green)]">
              Summary
            </span>
            {entry.costUsd != null && (
              <span className="font-mono text-[10px] tabular-nums text-[var(--gt-green)]">
                ${entry.costUsd.toFixed(4)}
              </span>
            )}
            {entry.durationMs != null && (
              <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                {fmtDuration(entry.durationMs)}
              </span>
            )}
            {entry.tokens != null && (
              <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                {entry.tokens.toLocaleString()} tok
              </span>
            )}
          </div>
          {entry.text && (
            <div className="mt-1">
              <MdClipped text={entry.text} clipAt={20} className="text-zinc-300" />
            </div>
          )}
        </div>
      )
    case 'text':
      return <Clipped text={entry.text} clipAt={30} className="text-[var(--gt-text-soft)]" />
    case 'step':
      return null // rendered as a section header by the grouping below
  }
}

type StepEntry = Extract<RunLogEntry, { kind: 'step' }>
type Section = { step: StepEntry | null; items: RunLogEntry[] }

function StepSection({ section, children }: { section: Section; children: ReactNode }) {
  const step = section.step
  const [open, setOpen] = useState(step ? step.status !== 'ok' : true)
  if (!step) return <>{children}</>
  return (
    <div id={`sr-step-${step.n}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`my-1 flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left ${
          step.status === 'failed'
            ? 'border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 text-[var(--gt-red)]'
            : step.status === 'ok'
              ? 'border-[var(--gt-green)]/30 bg-[var(--gt-green)]/8 text-[var(--gt-green)]'
              : 'border-[var(--gt-accent)]/25 bg-[var(--gt-accent)]/10 text-[var(--gt-accent-light)]'
        }`}
      >
        {open ? (
          <ChevronDown size={11} strokeWidth={2} className="shrink-0" />
        ) : (
          <ChevronRight size={11} strokeWidth={2} className="shrink-0" />
        )}
        <span className="font-mono text-[10px] tabular-nums">
          step {step.n}/{step.total}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px]">{step.label}</span>
        {step.exitCode != null && (
          <span className="shrink-0 font-mono text-[9.5px]">exit {step.exitCode}</span>
        )}
      </button>
      {open && <div className="ml-2 border-l border-[var(--gt-border)]/40 pl-2">{children}</div>}
    </div>
  )
}

export function StructuredRunLog({
  parsed,
  filter = '',
  hideMeta = false,
  className = '',
}: {
  parsed: ParsedRunLog
  filter?: string
  hideMeta?: boolean
  className?: string
}) {
  const [extraWindows, setExtraWindows] = useState(0)

  const sections = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const out: Section[] = [{ step: null, items: [] }]
    for (const entry of parsed.entries) {
      if (entry.kind === 'step') {
        out.push({ step: entry, items: [] })
        continue
      }
      if (hideMeta && entry.kind === 'meta') continue
      if (q && !searchableText(entry).toLowerCase().includes(q)) continue
      out[out.length - 1].items.push(entry)
    }
    return out.filter((s) => s.step || s.items.length)
  }, [parsed, filter, hideMeta])

  const total = sections.reduce((n, s) => n + s.items.length, 0)
  const cap = ENTRY_WINDOW * (1 + extraWindows)
  // Bound very long transcripts: keep the newest `cap` entries, reveal earlier
  // ones on demand. Applied across sections from the end backwards.
  let hidden = Math.max(0, total - cap)
  const bounded = sections.map((s) => {
    if (hidden <= 0) return s
    const drop = Math.min(hidden, s.items.length)
    hidden -= drop
    return { ...s, items: s.items.slice(drop) }
  })
  const hiddenCount = Math.max(0, total - cap)

  if (!parsed.entries.length)
    return <div className={`font-mono text-[11px] text-zinc-600 ${className}`}>(no output yet)</div>

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {hiddenCount > 0 && (
        <button
          onClick={() => setExtraWindows((n) => n + 1)}
          className="self-start rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-200"
        >
          Show {Math.min(hiddenCount, ENTRY_WINDOW)} earlier entries ({hiddenCount} hidden)
        </button>
      )}
      {bounded.map((section, i) => (
        <StepSection
          key={section.step ? `step-${section.step.n}-${i}` : `s-${i}`}
          section={section}
        >
          <div className="flex flex-col gap-1.5">
            {section.items.map((entry, j) => (
              <Entry key={`${i}-${j}`} entry={entry} />
            ))}
          </div>
        </StepSection>
      ))}
      {total === 0 && filter.trim() && (
        <div className="font-mono text-[11px] text-zinc-600">
          (no entries match "{filter.trim()}")
        </div>
      )}
    </div>
  )
}

/**
 * Self-contained run-output view: parses `text`, defaults to the structured
 * transcript when the parser found real structure, and always keeps the raw
 * text one click away. Used by the Agents tab run pane and Schedules run logs;
 * RunLogPane wires the same pieces itself to keep its richer raw view.
 */
export function RunOutputView({
  text,
  engine,
  className = '',
}: {
  text: string
  engine?: string
  className?: string
}) {
  const parsed = useMemo(() => parseRunLog(text, engine), [text, engine])
  const [pref, setPref] = useState<'auto' | 'structured' | 'raw'>('auto')
  const view = pref === 'auto' ? (parsed.structured ? 'structured' : 'raw') : pref
  const toggleBtn = (target: 'structured' | 'raw', label: string) => (
    <button
      onClick={() => setPref(target)}
      disabled={target === 'structured' && !parsed.entries.length}
      className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider disabled:opacity-40 ${
        view === target ? 'bg-white/10 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-end gap-0.5">
        {toggleBtn('structured', 'Structured')}
        {toggleBtn('raw', 'Raw')}
      </div>
      {view === 'structured' ? (
        <StructuredRunLog parsed={parsed} />
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--gt-text-soft)]">
          {sanitizeLog(text) || '(no output yet)'}
        </pre>
      )}
    </div>
  )
}
