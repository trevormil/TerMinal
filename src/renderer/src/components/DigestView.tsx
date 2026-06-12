import { useEffect, useMemo, useState } from 'react'
import parseDiff from 'parse-diff'
import { ChevronDown, ChevronRight, TriangleAlert, Eye } from 'lucide-react'
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
      {files.map((f) =>
        fileMap.get(f) ? (
          <div
            key={f}
            className="mt-2 max-h-72 overflow-auto rounded-md border border-[var(--gt-border)]"
          >
            <FileDiff file={fileMap.get(f)} mode="unified" />
          </div>
        ) : null,
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

export function DigestView({ iid, short, diff }: { iid: number; short: string; diff: string | null }) {
  const [digest, setDigest] = useState<DigestArtifact | null | undefined>(undefined)
  const [section, setSection] = useState<Section>('summary')

  useEffect(() => {
    setDigest(undefined)
    window.gt.getDigest(iid, short || undefined).then(setDigest)
  }, [iid, short])

  const fileMap = useMemo(() => {
    const m = new Map<string, any>()
    if (diff)
      for (const f of parseDiff(diff)) {
        if (f.to) m.set(f.to, f)
        if (f.from) m.set(f.from, f)
      }
    return m
  }, [diff])

  if (digest === undefined)
    return <div className="p-6 text-[12px] text-zinc-600">Loading digest…</div>
  if (digest === null)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        No digest for this MR yet. Run <code className="text-zinc-400">/digest</code> on it, then reopen.
      </div>
    )

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
                <ul className="space-y-1">
                  {digest.double_check.map((dc, i) => (
                    <li key={i} className="text-[12px] text-zinc-300">
                      <span className="font-mono text-[11px] text-zinc-500">{dc.file}</span> — {dc.why}
                    </li>
                  ))}
                </ul>
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
