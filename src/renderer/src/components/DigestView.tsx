import { useEffect, useMemo, useState } from 'react'
import parseDiff from 'parse-diff'
import {
  ChevronDown,
  ChevronRight,
  TriangleAlert,
  Eye,
  ShieldCheck,
  Layers,
  GitMerge,
} from 'lucide-react'
import { Badge } from './ui'
import { Markdown } from './Markdown'
import { FileDiff } from './MrDetail'
import { chunkRiskTone } from '../lib/badges'
import type { DigestArtifact, DigestChunk, DigestDecision } from '../lib/types'

// /digest viewer — the human read surface. Ranks the diff and annotates it;
// never abstracts code away. 🟢 chunks collapse to a label; 🟡/🔴 open with their
// summary/note + the real green/red diff (reusing FileDiff). Decisions pin on top.

const revTone = (r: DigestDecision['reversibility']) =>
  r === 'low' ? 'red' : r === 'medium' ? 'yellow' : 'mute'

function DecisionCard({ d }: { d: DigestDecision }) {
  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={revTone(d.reversibility)}>{d.reversibility} reversibility</Badge>
        <Badge tone="mute">{d.category}</Badge>
        <span className="text-[13px] font-semibold text-zinc-100">{d.title}</span>
      </div>
      {d.what && <div className="text-[12px] text-zinc-300">{d.what}</div>}
      {d.why && <div className="mt-0.5 text-[11.5px] text-zinc-500">why · {d.why}</div>}
      {d.alternatives && (
        <div className="mt-0.5 text-[11.5px] text-zinc-500">alt · {d.alternatives}</div>
      )}
      {d.files.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-zinc-600">
          {d.files.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function noteIcon(note: string | null) {
  if (!note) return null
  if (note.startsWith('verify')) return <ShieldCheck size={12} strokeWidth={2} className="text-[var(--gt-red)]" />
  if (note.startsWith('eyeball')) return <Eye size={12} strokeWidth={2} className="text-amber-400" />
  return <ShieldCheck size={12} strokeWidth={2} className="text-zinc-500" />
}

function ChunkRow({ chunk, file }: { chunk: DigestChunk; file: any | undefined }) {
  const isGreen = chunk.risk === 'green'
  const [open, setOpen] = useState(!isGreen)
  const churn = (
    <span className="shrink-0 font-mono text-[10.5px]">
      <span className="text-[var(--gt-green)]">+{chunk.added}</span>{' '}
      <span className="text-[var(--gt-red)]">-{chunk.deleted}</span>
    </span>
  )
  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={2} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-zinc-600" />
        )}
        <Badge tone={chunkRiskTone(chunk.risk)}>{chunk.risk}</Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-200" title={chunk.file}>
          {chunk.file}
        </span>
        {isGreen && chunk.green_label && (
          <span className="shrink-0 truncate text-[11px] italic text-zinc-500">{chunk.green_label}</span>
        )}
        <Badge tone="mute">{chunk.kind}</Badge>
        {chunk.decision_signals.map((s) => (
          <Badge key={s} tone="blue">{s}</Badge>
        ))}
        {churn}
      </button>
      {open && (
        <div className="border-t border-[var(--gt-border)]">
          {(chunk.summary || chunk.note || chunk.confidence) && (
            <div className="space-y-1 px-3 py-2">
              {chunk.summary && <div className="text-[12px] text-zinc-300">{chunk.summary}</div>}
              {chunk.note && (
                <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-400">
                  {noteIcon(chunk.note)}
                  {chunk.note}
                </div>
              )}
              {chunk.confidence && (
                <div className="flex items-center gap-1.5">
                  <Badge tone="warn">
                    <TriangleAlert size={9} strokeWidth={2.5} />
                    {chunk.confidence}
                  </Badge>
                </div>
              )}
            </div>
          )}
          {file ? (
            <div className="overflow-auto border-t border-[var(--gt-border)]">
              <FileDiff file={file} mode="unified" />
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] italic text-zinc-600">
              (diff not available for this file — regenerate the digest at the current head)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DigestView({ iid, short, diff }: { iid: number; short: string; diff: string | null }) {
  const [digest, setDigest] = useState<DigestArtifact | null | undefined>(undefined)

  useEffect(() => {
    setDigest(undefined)
    window.gt.getDigest(iid, short || undefined).then(setDigest)
  }, [iid, short])

  // Map both new- and old-path keys → parse-diff file, so renames/deletes match.
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
  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      {/* stats + joint */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span className="font-mono">{s.chunks} files</span>
        <span className="text-[var(--gt-red)]">{s.red} 🔴</span>
        <span className="text-amber-400">{s.yellow} 🟡</span>
        <span className="text-[var(--gt-green)]">{s.green} 🟢</span>
        <span>
          <span className="font-semibold text-zinc-300">{s.llm_chunks}</span>/{s.chunks} needed the model
        </span>
        <span className="font-mono">
          <span className="text-[var(--gt-green)]">+{s.added}</span>{' '}
          <span className="text-[var(--gt-red)]">-{s.deleted}</span>
        </span>
        {digest.joint && (
          <Badge tone="blue">
            <GitMerge size={9} strokeWidth={2.5} />
            joint · {digest.joint.member_mrs.length} MRs
          </Badge>
        )}
      </div>

      {/* brief + blast radius */}
      {(digest.brief || digest.blast_radius) && (
        <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
          {digest.brief && <div className="text-[13px] leading-relaxed text-zinc-200">{digest.brief}</div>}
          {digest.blast_radius && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-amber-300/90">
              <TriangleAlert size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
              <span>{digest.blast_radius}</span>
            </div>
          )}
        </div>
      )}

      {/* design decisions — pinned, sign-off surface */}
      {digest.decisions.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            <Layers size={12} strokeWidth={2} />
            Design decisions · sign off ({digest.decisions.length})
          </div>
          <div className="space-y-2">
            {digest.decisions.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        </div>
      )}

      {/* double-check */}
      {digest.double_check.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">
            <Eye size={12} strokeWidth={2} />
            Eyeball these
          </div>
          <ul className="space-y-0.5">
            {digest.double_check.map((dc, i) => (
              <li key={i} className="text-[11.5px] text-zinc-300">
                <span className="font-mono text-zinc-400">{dc.file}</span> — {dc.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* how-it-fits diagram (mermaid source; no in-app renderer yet) */}
      {digest.diagram && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            How it fits
          </div>
          <Markdown>{'```mermaid\n' + digest.diagram + '\n```'}</Markdown>
        </div>
      )}

      {/* chunks — sorted 🔴→🟡→🟢 by the artifact; 🟢 collapsed */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Changes
        </div>
        <div className="space-y-2">
          {digest.chunks.map((c) => (
            <ChunkRow key={c.id} chunk={c} file={fileMap.get(c.file)} />
          ))}
        </div>
      </div>
    </div>
  )
}
