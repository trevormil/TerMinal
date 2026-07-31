import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Loader2, PlayCircle, ChevronRight, ChevronDown } from 'lucide-react'
import { EngineLogo } from '../../components/EngineLogo'
import type {
  Engine,
  ObservabilityTranscriptWindow,
  SessionSearchResult,
  TranscriptHit,
  TranscriptSearchResponse,
} from '../../lib/types'

// Full-text search across every past engine transcript, with jump-to-context and
// resume. The context window reuses the existing `agentview:transcript-window`
// IPC (the same bounded line-window reader the Observability tab uses) rather
// than loading a whole transcript into the renderer.

// The terminal's fit addon re-measures on mount, so these only have to be in
// the right ballpark — but a hardcoded 120x40 makes the first paint of a
// resumed session visibly wrong on a large display.
const viewportCols = () => Math.max(80, Math.floor(window.innerWidth / 8))
const viewportRows = () => Math.max(24, Math.floor(window.innerHeight / 18))

const roleTone: Record<TranscriptHit['role'], string> = {
  user: 'text-sky-300',
  assistant: 'text-emerald-300',
  tool: 'text-amber-300',
  other: 'text-zinc-500',
}

const repoOf = (cwd: string) => cwd.split('/').filter(Boolean).pop() || cwd

function reldate(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function ContextWindow({ sessionId, line }: { sessionId: string; line: number }) {
  const [win, setWin] = useState<ObservabilityTranscriptWindow | null>(null)

  useEffect(() => {
    let live = true
    window.gt.agentview
      .transcriptWindow(sessionId, line, 6)
      .then((w) => live && setWin(w))
      .catch(
        (e: Error) =>
          live &&
          setWin({ error: e?.message || 'context unavailable' } as ObservabilityTranscriptWindow),
      )
    return () => {
      live = false
    }
  }, [sessionId, line])

  if (!win) return <div className="px-3 py-2 text-[11px] text-zinc-600">Loading context…</div>
  if (win.error) return <div className="px-3 py-2 text-[11px] text-amber-400">{win.error}</div>

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--gt-border)] bg-black/30 p-2">
      {win.lines.map((l) => (
        <div
          key={l.line}
          className={`flex gap-2 px-1 py-0.5 font-mono text-[10.5px] leading-snug ${
            l.line === line ? 'rounded bg-[var(--gt-accent)]/15' : ''
          }`}
        >
          <span className="w-10 shrink-0 text-right text-zinc-700">{l.line}</span>
          <span className="w-14 shrink-0 text-zinc-600">{l.role || l.kind || ''}</span>
          <span className="min-w-0 flex-1 truncate text-zinc-300">
            {l.toolName ? `${l.toolName} · ` : ''}
            {l.text.slice(0, 400)}
          </span>
        </div>
      ))}
      <div className="mt-1 px-1 text-[10px] text-zinc-700">
        lines {win.startLine}–{win.endLine} of {win.totalLines}
      </div>
    </div>
  )
}

function ResultGroup({ r }: { r: SessionSearchResult }) {
  const [open, setOpen] = useState<number | null>(null)

  const resume = () =>
    window.gt
      .startSession(`resume-${r.sessionId}`, {
        mode: 'resume',
        engine: r.engine as Engine,
        sessionId: r.sessionId,
        cwd: r.cwd,
        cols: viewportCols(),
        rows: viewportRows(),
      })
      .catch(() => undefined)

  return (
    <div className="border-b border-[var(--gt-border)]/60">
      <div className="flex items-center gap-2 px-4 py-2">
        <EngineLogo engine={r.engine} size={11} />
        <span className="text-[12px] font-medium text-zinc-200">{repoOf(r.cwd)}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600">
          {r.firstUserText || r.sessionId}
        </span>
        <span className="shrink-0 text-[11px] text-zinc-600">
          {r.hits.length} hit{r.hits.length === 1 ? '' : 's'} · {reldate(r.mtime)}
        </span>
        <button
          onClick={resume}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--gt-border)] px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10"
          title="Resume this session in a new terminal"
        >
          <PlayCircle size={11} strokeWidth={2} /> Resume
        </button>
      </div>
      <div className="pb-1">
        {r.hits.map((h) => (
          <div key={h.line} className="px-4">
            <button
              onClick={() => setOpen(open === h.line ? null : h.line)}
              className="flex w-full items-start gap-1.5 rounded px-1 py-1 text-left hover:bg-white/5"
            >
              {open === h.line ? (
                <ChevronDown size={11} strokeWidth={2} className="mt-0.5 shrink-0 text-zinc-600" />
              ) : (
                <ChevronRight size={11} strokeWidth={2} className="mt-0.5 shrink-0 text-zinc-600" />
              )}
              <span className={`shrink-0 font-mono text-[10.5px] ${roleTone[h.role]}`}>
                {h.role}
              </span>
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-zinc-300">
                {h.preview}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-700">L{h.line}</span>
            </button>
            {open === h.line && (
              <div className="pb-2 pl-4">
                <ContextWindow sessionId={r.sessionId} line={h.line} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TranscriptSearch() {
  const [q, setQ] = useState('')
  const [thisRepoOnly, setThisRepoOnly] = useState(true)
  const [res, setRes] = useState<TranscriptSearchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [fatal, setFatal] = useState('')
  const seq = useRef(0)

  const search = useCallback(async (query: string, repoOnly: boolean) => {
    if (!query.trim()) {
      setRes(null)
      return
    }
    const mine = ++seq.current
    setBusy(true)
    const r = await window.gt.searchSessions(query, { thisRepoOnly: repoOnly })
    // Drop a stale response so fast typing can't show older results last.
    if (mine === seq.current) {
      setRes(r)
      setBusy(false)
    }
  }, [])

  // Debounced: searching scans transcripts on disk, so don't fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => search(q, thisRepoOnly), 250)
    return () => clearTimeout(t)
  }, [q, thisRepoOnly, search])

  if (fatal)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Search size={18} strokeWidth={2} className="text-zinc-600" />
        <p className="text-[12.5px] text-zinc-300">Transcript search is not available yet.</p>
        <p className="max-w-md text-[11px] leading-relaxed text-zinc-600">
          Its main-process handler is not registered (
          <code className="font-mono">registerSessionSearchIpc</code> in{' '}
          <code className="font-mono">src/main/index.ts</code>). The Docs view above is unaffected.
        </p>
        <p className="font-mono text-[10.5px] text-zinc-700">{fatal}</p>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <Search size={13} strokeWidth={2} className="text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search every past transcript… (wrap in /…/ for a regex)"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-700"
        />
        {busy && <Loader2 size={12} strokeWidth={2} className="animate-spin text-zinc-600" />}
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-500">
          <input
            type="checkbox"
            checked={thisRepoOnly}
            onChange={(e) => setThisRepoOnly(e.target.checked)}
          />
          this repo
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!q.trim() ? (
          <div className="p-6 text-[12px] leading-relaxed text-zinc-600">
            Search the text of every session you have run — prompts, replies, and the commands
            agents ran. Expand a hit to see the surrounding turns, or resume the session outright.
          </div>
        ) : res === null ? (
          <div className="p-6 text-[12px] text-zinc-600">Searching…</div>
        ) : res.results.length === 0 ? (
          <div className="p-6 text-[12px] text-zinc-600">
            No matches in {res.scanned} session{res.scanned === 1 ? '' : 's'}.
          </div>
        ) : (
          <>
            <div className="px-4 py-1.5 text-[11px] text-zinc-600">
              {res.totalHits} hit{res.totalHits === 1 ? '' : 's'} across {res.results.length}{' '}
              session{res.results.length === 1 ? '' : 's'}
              {res.truncated && ' · only the most recent sessions were scanned'}
            </div>
            {res.results.map((r) => (
              <ResultGroup key={r.sessionId} r={r} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
