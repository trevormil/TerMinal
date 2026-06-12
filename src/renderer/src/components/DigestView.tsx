import { useEffect, useMemo, useState, type ReactNode } from 'react'
import parseDiff from 'parse-diff'
import { ChevronDown, ChevronRight, TriangleAlert, Eye, Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { FileDiff } from './MrDetail'
import { Mermaid } from './Mermaid'
import type { DigestArtifact, DigestChunk, DigestDecision } from '../lib/types'

// /digest viewer — the human read surface. Ranks + annotates the diff without
// abstracting code away. Sectioned via a left sidebar; signal-only (risk is a
// colored edge, not a word badge; no kind/signal tags cluttering rows).

const RISK_COLOR: Record<string, string> = {
  red: 'var(--gt-red)',
  yellow: '#d6a84a',
  green: 'var(--gt-green)',
}

const fileOf = (ref: string) => ref.replace(/:\d+.*$/, '')

// A collapsed reference to a changed file. Click to reveal the real green/red
// diff inline — never leave the digest to go read the code. `why` is the
// human-facing reason this reference matters (eyeball note / null).
function FileDrilldown({
  pathRef,
  why,
  fileMap,
  defaultOpen = false,
}: {
  pathRef: string
  why?: string | null
  fileMap: Map<string, any>
  defaultOpen?: boolean
}) {
  const file = fileMap.get(fileOf(pathRef))
  const [open, setOpen] = useState(defaultOpen && !!file)
  return (
    <div className="overflow-hidden rounded-md border border-[var(--gt-border)]">
      <button
        onClick={() => file && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${file ? 'hover:bg-white/5' : 'cursor-default'}`}
      >
        {file ? (
          open ? (
            <ChevronDown size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
          ) : (
            <ChevronRight size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-[11px] text-zinc-400">{pathRef}</span>
        {why && <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">— {why}</span>}
        {!why && <span className="flex-1" />}
        {file ? (
          <span className="shrink-0 font-mono text-[10px] text-zinc-600">
            +{file.additions} −{file.deletions}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-zinc-700">no diff</span>
        )}
      </button>
      {open && file && (
        <div className="max-h-80 overflow-auto border-t border-[var(--gt-border)]">
          <FileDiff file={file} mode="unified" />
        </div>
      )}
    </div>
  )
}

function DecisionCard({ d, fileMap }: { d: DigestDecision; fileMap: Map<string, any> }) {
  const files = [...new Set(d.files.map(fileOf))]
  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      <div className="text-[13px] font-semibold text-zinc-100">{d.title}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">
        {d.reversibility} reversibility · {d.category}
      </div>
      {d.what && <div className="mt-1.5 text-[12px] text-zinc-300">{d.what}</div>}
      {(d.why || d.alternatives) && (
        <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
          {d.why && <div>why · {d.why}</div>}
          {d.alternatives && <div>alt · {d.alternatives}</div>}
        </div>
      )}
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((f) => (
            <FileDrilldown key={f} pathRef={f} fileMap={fileMap} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChunkRow({ chunk, file }: { chunk: DigestChunk; file: any | undefined }) {
  const isGreen = chunk.risk === 'green'
  const [open, setOpen] = useState(!isGreen)
  return (
    <div
      className="overflow-hidden rounded-md border border-[var(--gt-border)] border-l-2"
      style={{ borderLeftColor: RISK_COLOR[chunk.risk] }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-200" title={chunk.file}>
          {chunk.file}
        </span>
        {isGreen ? (
          <span className="shrink-0 text-[11px] text-zinc-600">{chunk.green_label}</span>
        ) : (
          <span className="shrink-0 font-mono text-[10px] text-zinc-600">
            +{chunk.added} −{chunk.deleted}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--gt-border)]">
          {!isGreen && (chunk.summary || chunk.note || chunk.confidence) && (
            <div className="space-y-1 px-3 py-2">
              {chunk.summary && <div className="text-[12px] text-zinc-300">{chunk.summary}</div>}
              {chunk.note && <div className="text-[11px] text-zinc-500">{chunk.note}</div>}
              {chunk.confidence && (
                <div className="text-[11px] text-[#d6a84a]">uncertain · {chunk.confidence.replace(/^low:\s*/i, '')}</div>
              )}
            </div>
          )}
          {file ? (
            <div className="overflow-auto border-t border-[var(--gt-border)]">
              <FileDiff file={file} mode="unified" />
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] italic text-zinc-600">diff unavailable</div>
          )}
        </div>
      )}
    </div>
  )
}

type Section = 'summary' | 'decisions' | 'flow' | 'changes'

const sameSha = (a?: string | null, b?: string | null) =>
  !!a && !!b && (a.startsWith(b) || b.startsWith(a))

export function DigestView({
  iid,
  headShort,
  diff,
}: {
  iid: number
  headShort: string
  diff: string | null
}) {
  const [digest, setDigest] = useState<DigestArtifact | null | undefined>(undefined)
  const [section, setSection] = useState<Section>('summary')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDigest(undefined)
    setError(null)
    window.gt.getDigest(iid).then(setDigest)
    window.gt.digestStatus(iid).then((s) => setRunning(s?.status === 'running'))
  }, [iid])

  useEffect(() => {
    const off = window.gt.onDigestStatus((s) => {
      if (s.iid !== iid) return
      if (s.status === 'running') setRunning(true)
      else if (s.status === 'done') {
        setRunning(false)
        window.gt.getDigest(iid).then(setDigest)
      } else {
        setRunning(false)
        setError(s.error || 'digest failed')
      }
    })
    return off
  }, [iid])

  const fileMap = useMemo(() => {
    const m = new Map<string, any>()
    if (diff)
      for (const f of parseDiff(diff)) {
        if (f.to) m.set(f.to, f)
        if (f.from) m.set(f.from, f)
      }
    return m
  }, [diff])

  const stale = digest ? !sameSha(digest.short_sha, headShort) : false
  const runIt = async () => {
    setError(null)
    setRunning(true)
    const r = await window.gt.runDigest(iid)
    if (!r.ok) {
      setRunning(false)
      setError(r.error || 'could not start digest')
    }
  }

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--gt-border)] px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        {digest && <span className="font-mono text-zinc-600">digest @ {digest.short_sha}</span>}
        {stale && (
          <span className="rounded bg-[#d6a84a]/15 px-1.5 py-0.5 text-[#d6a84a]">
            stale · head {headShort}
          </span>
        )}
        {!digest && !running && <span className="text-zinc-600">no digest yet</span>}
        {error && <span className="truncate text-[var(--gt-red)]">{error}</span>}
      </div>
      <button
        onClick={runIt}
        disabled={running}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--gt-border)] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60 disabled:opacity-60"
      >
        {running ? (
          <>
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            generating… ~60s
          </>
        ) : digest ? (
          <>
            <RefreshCw size={12} strokeWidth={2} />
            {stale ? 'Refresh' : 'Re-run'}
          </>
        ) : (
          <>
            <Wand2 size={12} strokeWidth={2} />
            Generate digest
          </>
        )}
      </button>
    </div>
  )

  let body: ReactNode
  if (running && !digest)
    body = <div className="p-6 text-[12px] text-zinc-600">Generating digest… (~60s)</div>
  else if (digest === undefined)
    body = <div className="p-6 text-[12px] text-zinc-600">Loading digest…</div>
  else if (digest === null)
    body = (
      <div className="p-6 text-[12px] text-zinc-600">
        No digest for this MR yet. Click <span className="text-zinc-400">Generate digest</span>.
      </div>
    )
  else body = <DigestBody digest={digest} fileMap={fileMap} section={section} setSection={setSection} />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  )
}

function DigestBody({
  digest,
  fileMap,
  section,
  setSection,
}: {
  digest: DigestArtifact
  fileMap: Map<string, any>
  section: Section
  setSection: (s: Section) => void
}) {
  const s = digest.stats
  const nav: { key: Section; label: string; count?: number; show: boolean }[] = [
    { key: 'summary', label: 'Summary', show: true },
    { key: 'decisions', label: 'Decisions', count: digest.decisions.length, show: digest.decisions.length > 0 },
    { key: 'flow', label: 'Flow', show: !!digest.diagram },
    { key: 'changes', label: 'Changes', count: s.chunks, show: true },
  ]
  const active = nav.find((n) => n.key === section)?.show ? section : 'summary'

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-36 shrink-0 overflow-y-auto border-r border-[var(--gt-border)] py-2">
        {nav
          .filter((n) => n.show)
          .map((n) => (
            <button
              key={n.key}
              onClick={() => setSection(n.key)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] ${
                active === n.key
                  ? 'bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {n.label}
              {n.count != null && <span className="text-zinc-600">{n.count}</span>}
            </button>
          ))}
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {active === 'summary' && (
          <div className="space-y-3 p-5">
            <div className="flex gap-3 text-[11px]">
              <span style={{ color: RISK_COLOR.red }}>{s.red} high</span>
              <span style={{ color: RISK_COLOR.yellow }}>{s.yellow} medium</span>
              <span className="text-zinc-600">{s.green} routine</span>
            </div>
            {digest.brief && (
              <div className="text-[13px] leading-relaxed text-zinc-200">{digest.brief}</div>
            )}
            {digest.blast_radius && (
              <div className="flex items-start gap-1.5 text-[12px] text-[#d6a84a]">
                <TriangleAlert size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
                <span>{digest.blast_radius}</span>
              </div>
            )}
            {digest.double_check.length > 0 && (
              <div className="rounded-lg border border-[var(--gt-border)] p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <Eye size={12} strokeWidth={2} />
                  Eyeball these
                </div>
                <div className="space-y-1">
                  {digest.double_check.map((dc, i) => (
                    <FileDrilldown key={i} pathRef={dc.file} why={dc.why} fileMap={fileMap} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {active === 'decisions' && (
          <div className="space-y-3 p-5">
            {digest.decisions.map((d) => (
              <DecisionCard key={d.id} d={d} fileMap={fileMap} />
            ))}
          </div>
        )}

        {active === 'flow' && digest.diagram && (
          <div className="p-5">
            <Mermaid source={digest.diagram} />
          </div>
        )}

        {active === 'changes' && (
          <div className="space-y-1.5 p-3">
            {digest.chunks.map((c) => (
              <ChunkRow key={c.id} chunk={c} file={fileMap.get(c.file)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
