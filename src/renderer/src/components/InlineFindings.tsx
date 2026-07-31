import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, Check, MessageSquarePlus, Loader2 } from 'lucide-react'
import { capabilityMissing, probeCapability } from '../lib/capability'
import type { NormalizedFinding, Severity } from '../lib/types'

const CAP = 'prReview'

// Renders automatic pre-review findings INLINE in a diff, anchored to file:line,
// with a per-finding "post to the PR thread" action.
//
// INTEGRATION POINT (deliberately not wired in this PR — the MRs tab is owned by
// another change): in `components/MrDetail.tsx`'s `DiffView`, take
// `const inline = useInlineFindings(iid)` and, when rendering a hunk row, emit
//   {inline.at(filePath, newLineNumber).length > 0 && (
//     <tr><td colSpan={3}><FindingsAtLine
//        findings={inline.at(filePath, newLineNumber)} iid={iid} /></td></tr>
//   )}
// directly beneath that row. Nothing else in DiffView changes; when auto-review
// is off (the default) `at()` returns [] everywhere and the diff is unchanged.

const TONE: Record<Severity, { text: string; border: string; bg: string; label: string }> = {
  critical: {
    text: 'text-rose-300',
    border: 'border-rose-500/50',
    bg: 'bg-rose-500/10',
    label: 'critical',
  },
  high: {
    text: 'text-orange-300',
    border: 'border-orange-500/50',
    bg: 'bg-orange-500/10',
    label: 'high',
  },
  medium: {
    text: 'text-amber-300',
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/10',
    label: 'medium',
  },
  low: { text: 'text-sky-300', border: 'border-sky-500/40', bg: 'bg-sky-500/10', label: 'low' },
  info: {
    text: 'text-zinc-400',
    border: 'border-[var(--gt-border)]',
    bg: 'bg-white/5',
    label: 'info',
  },
}

/** Fetches a PR's normalized findings once and indexes them by file:line. */
export function useInlineFindings(iid: number) {
  const [byLocation, setByLocation] = useState<Record<string, NormalizedFinding[]>>({})
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let live = true
    if (!iid || capabilityMissing(CAP)) return
    probeCapability(CAP, () => window.gt.prReview.findings(iid))
      .then((ok) => (ok ? window.gt.prReview.findings(iid) : null))
      .then((r) => {
        // A missing handler must leave the diff exactly as it was, not throw
        // an unhandled rejection on every PR you open.
        if (!live || !r) return
        setByLocation(r.byLocation || {})
        setStale(!!r.stale)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [iid])

  const at = useCallback(
    (file: string, line?: number): NormalizedFinding[] =>
      !file || !line ? [] : byLocation[`${file}:${line}`] || [],
    [byLocation],
  )
  const count = useMemo(
    () => Object.values(byLocation).reduce((n, v) => n + v.length, 0),
    [byLocation],
  )
  return { at, count, stale }
}

function FindingCard({ f, iid }: { f: NormalizedFinding; iid: number }) {
  const [state, setState] = useState<'idle' | 'posting' | 'posted'>('idle')
  const [err, setErr] = useState('')
  const t = TONE[f.severity] ?? TONE.info

  const post = async () => {
    setState('posting')
    setErr('')
    try {
      const r = await window.gt.prReview.postFinding(iid, f.id)
      if (r.ok) setState('posted')
      else {
        setState('idle')
        setErr(r.error || 'post failed')
      }
    } catch (e) {
      setState('idle')
      setErr((e as Error)?.message || 'pre-review IPC is unavailable')
    }
  }

  return (
    <div className={`my-1 rounded-lg border ${t.border} ${t.bg} px-2.5 py-2`}>
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={12} strokeWidth={2} className={`mt-0.5 shrink-0 ${t.text}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[10.5px] font-semibold uppercase tracking-wide ${t.text}`}>
              {t.label}
            </span>
            {f.rawSeverity && (
              <span
                className="rounded border border-[var(--gt-border)] px-1 text-[10px] text-zinc-500"
                title={`The artifact said "${f.rawSeverity}", which isn't a severity we map. Shown as medium so it isn't skipped.`}
              >
                unrecognized: {f.rawSeverity}
              </span>
            )}
            {f.category && <span className="text-[10.5px] text-zinc-500">{f.category}</span>}
            <span className="text-[12px] font-medium text-zinc-100">{f.title}</span>
          </div>
          {f.body && f.body !== f.title && (
            <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-snug text-zinc-300">
              {f.body}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-zinc-600">
              <Bot size={10} strokeWidth={2} /> pre-review · not an approval
            </span>
            <button
              onClick={post}
              disabled={state !== 'idle'}
              className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--gt-border)] px-1.5 py-0.5 text-[10.5px] text-zinc-300 hover:bg-white/10 disabled:opacity-50"
              title="Post this finding as a comment on the PR thread"
            >
              {state === 'posting' ? (
                <Loader2 size={10} strokeWidth={2} className="animate-spin" />
              ) : state === 'posted' ? (
                <Check size={10} strokeWidth={2} className="text-emerald-400" />
              ) : (
                <MessageSquarePlus size={10} strokeWidth={2} />
              )}
              {state === 'posted' ? 'Posted' : 'Post to thread'}
            </button>
          </div>
          {err && <p className="mt-1 text-[10.5px] text-amber-400">{err}</p>}
        </div>
      </div>
    </div>
  )
}

export function FindingsAtLine({ findings, iid }: { findings: NormalizedFinding[]; iid: number }) {
  if (!findings.length) return null
  return (
    <div className="px-3 py-0.5">
      {findings.map((f) => (
        <FindingCard key={f.id} f={f} iid={iid} />
      ))}
    </div>
  )
}
