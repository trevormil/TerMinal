import { useEffect, useMemo, useState } from 'react'
import parseDiff from 'parse-diff'
import { Badge } from './ui'
import { Markdown } from './Markdown'
import type { MrDetail, Finding } from '../lib/types'

type Tone = 'ok' | 'warn' | 'bad' | 'mute'
const stateTone = (s: string): Tone => (s === 'merged' ? 'ok' : s === 'closed' ? 'bad' : 'warn')
const verdictTone = (v: string): Tone =>
  v === 'approve' ? 'ok' : v === 'request-changes' || v === 'blocked' ? 'bad' : 'mute'
const testTone = (s: string): Tone => (s === 'pass' ? 'ok' : s === 'fail' ? 'bad' : 'mute')
const sevTone = (s: string): Tone => {
  const x = (s || '').toLowerCase()
  return x === 'critical' || x === 'high' ? 'bad' : x === 'medium' ? 'warn' : 'mute'
}

// per-MR "viewed file" set, persisted to localStorage
function useViewed(scope: string) {
  const key = `gt.viewed.${scope}`
  const [m, setM] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}')
    } catch {
      return {}
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(m))
  }, [key, m])
  const set = (path: string, v: boolean) => setM((o) => ({ ...o, [path]: v }))
  return [m, set] as const
}

function FileDiff({ file }: { file: any }) {
  const stripPrefix = (s: string) =>
    s.length && (s[0] === '+' || s[0] === '-' || s[0] === ' ') ? s.slice(1) : s
  return (
    <div className="font-mono text-[12px]">
      <div className="sticky top-0 z-10 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-3 py-2 text-[12px] text-zinc-300">
        <span className="text-zinc-500">{file.from === file.to ? '' : `${file.from} → `}</span>
        <span>{file.to || file.from}</span>
        <span className="ml-3 text-emerald-400">+{file.additions}</span>{' '}
        <span className="text-rose-400">-{file.deletions}</span>
      </div>
      {file.chunks.map((c: any, ci: number) => (
        <div key={ci}>
          <div className="bg-[var(--gt-panel)] px-3 py-1 text-[11px] text-zinc-500">{c.content}</div>
          <table className="w-full border-collapse">
            <tbody>
              {c.changes.map((ch: any, i: number) => {
                const bg =
                  ch.type === 'add'
                    ? 'bg-emerald-500/[0.08]'
                    : ch.type === 'del'
                      ? 'bg-rose-500/[0.08]'
                      : ''
                const lineColor =
                  ch.type === 'add'
                    ? 'text-emerald-200'
                    : ch.type === 'del'
                      ? 'text-rose-200'
                      : 'text-zinc-300'
                const oldLn = ch.type === 'normal' ? ch.ln1 : ch.type === 'del' ? ch.ln : ''
                const newLn = ch.type === 'normal' ? ch.ln2 : ch.type === 'add' ? ch.ln : ''
                const prefix = ch.type === 'add' ? '+' : ch.type === 'del' ? '-' : ' '
                return (
                  <tr key={i} className={bg}>
                    <td className="w-10 select-none px-2 text-right text-[10px] text-zinc-600">
                      {oldLn || ''}
                    </td>
                    <td className="w-10 select-none px-2 text-right text-[10px] text-zinc-600">
                      {newLn || ''}
                    </td>
                    <td className="w-3 select-none text-center text-zinc-600">{prefix}</td>
                    <td className={`whitespace-pre px-2 ${lineColor}`}>{stripPrefix(ch.content)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function DiffView({ diff, scope }: { diff: string; scope: string }) {
  const files = useMemo(() => parseDiff(diff), [diff])
  const [selected, setSelected] = useState<string>('')
  const [viewed, setViewed] = useViewed(scope)
  useEffect(() => {
    if (!selected && files[0]) setSelected(files[0].to || files[0].from || '')
  }, [files, selected])

  if (!diff)
    return <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
  if (files.length === 0)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        No diff (or the harness diff hasn't been generated and glab returned empty).
      </div>
    )
  const file = files.find((f) => (f.to || f.from || '') === selected) || files[0]
  const viewedCount = files.filter((f) => viewed[f.to || f.from || '']).length

  return (
    <div className="flex h-full min-h-0">
      <div className="w-80 shrink-0 overflow-y-auto border-r border-[var(--gt-border)]">
        <div className="border-b border-[var(--gt-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-600">
          {files.length} files · {viewedCount} viewed
        </div>
        {files.map((f) => {
          const path = f.to || f.from || ''
          const isV = !!viewed[path]
          const isSel = (file.to || file.from) === path
          return (
            <div
              key={path}
              onClick={() => setSelected(path)}
              className={`flex cursor-pointer items-center gap-2 border-b border-[var(--gt-border)]/60 px-3 py-1.5 text-[11.5px] hover:bg-white/5 ${
                isSel ? 'bg-white/5' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={isV}
                onChange={(e) => setViewed(path, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="accent-[var(--gt-accent)]"
              />
              <span
                className={`min-w-0 flex-1 truncate font-mono ${isV ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}
                title={path}
              >
                {path}
              </span>
              <span className="text-emerald-400">+{f.additions}</span>
              <span className="text-rose-400">-{f.deletions}</span>
            </div>
          )
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        <FileDiff file={file} />
      </div>
    </div>
  )
}

function Overview({ mr }: { mr: MrDetail }) {
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-500">
        {mr.author && <span>@{mr.author}</span>}
        {mr.reviewMeta?.overall != null && (
          <span>
            score <span className="font-semibold text-zinc-200">{mr.reviewMeta.overall}</span>
          </span>
        )}
        {mr.reviewMeta && <Badge tone={verdictTone(mr.reviewMeta.verdict)}>{mr.reviewMeta.verdict}</Badge>}
        {mr.reviewMeta && (
          <Badge tone={testTone(mr.reviewMeta.testStatus)}>tests {mr.reviewMeta.testStatus}</Badge>
        )}
        {mr.reviewMeta?.stale && <Badge tone="warn">⚠ stale</Badge>}
        {mr.artifactShortSha && <span className="font-mono text-zinc-600">artifact {mr.artifactShortSha}</span>}
      </div>
      {mr.description ? (
        <Markdown>{mr.description}</Markdown>
      ) : (
        <div className="text-[12px] italic text-zinc-600">No description.</div>
      )}
    </div>
  )
}

function ReviewBody({ mr }: { mr: MrDetail }) {
  return (
    <div className="h-full overflow-y-auto p-5">
      {mr.reviewMd ? (
        <Markdown>{mr.reviewMd}</Markdown>
      ) : (
        <div className="text-[12px] italic text-zinc-600">No review artifact recorded for this MR yet.</div>
      )}
    </div>
  )
}

function FindingCard({ f, mutedSeverity }: { f: Finding; mutedSeverity?: boolean }) {
  const body = (f.text || f.body || '') as string
  return (
    <div className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {f.severity && (
          <Badge tone={mutedSeverity ? 'mute' : sevTone(f.severity)}>{f.severity}</Badge>
        )}
        {f.category && <Badge tone="mute">{f.category}</Badge>}
        {f.status && <Badge tone={f.status === 'resolved' ? 'ok' : 'mute'}>{f.status}</Badge>}
        {f.title && <span className="text-[13px] font-semibold text-zinc-100">{f.title}</span>}
        {f.file && (
          <span className="ml-auto font-mono text-[10.5px] text-zinc-500">
            {f.file}
            {f.line ? `:${f.line}` : ''}
          </span>
        )}
      </div>
      {body && <Markdown>{body}</Markdown>}
      {f.agent_fix_prompt && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            agent fix prompt
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 text-[11px] text-zinc-300">
            {f.agent_fix_prompt}
          </pre>
        </details>
      )}
    </div>
  )
}

function FindingsList({ items, suggestions }: { items: Finding[]; suggestions: Finding[] }) {
  if (items.length === 0 && suggestions.length === 0)
    return <div className="p-6 text-[12px] text-zinc-600">No findings or suggestions for this MR.</div>
  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {items.length > 0 && (
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
          Findings ({items.length})
        </div>
      )}
      {items.map((f, i) => (
        <FindingCard key={i} f={f} />
      ))}
      {suggestions.length > 0 && (
        <div className="mb-1 mt-4 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
          Suggestions ({suggestions.length})
        </div>
      )}
      {suggestions.map((f, i) => (
        <FindingCard key={`s${i}`} f={f} mutedSeverity />
      ))}
    </div>
  )
}

export function MrDetailView({
  iid,
  repoLabel,
  onBack,
}: {
  iid: number
  repoLabel: string
  onBack: () => void
}) {
  const [mr, setMr] = useState<MrDetail | null | undefined>(undefined)
  const [view, setView] = useState<'overview' | 'review' | 'findings' | 'diff'>('overview')
  const [diff, setDiff] = useState<string | null>(null)

  useEffect(() => {
    setMr(undefined)
    setDiff(null)
    window.gt.getMr(iid).then(setMr)
  }, [iid])
  useEffect(() => {
    if (view === 'diff' && diff === null) {
      setDiff('')
      window.gt.getMrDiff(iid).then(setDiff)
    }
  }, [view, iid]) // eslint-disable-line react-hooks/exhaustive-deps

  if (mr === undefined)
    return <div className="p-6 text-[12px] text-zinc-600">Loading !{iid}…</div>
  if (mr === null)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        Couldn't load !{iid} (is <code className="text-zinc-400">glab</code> authenticated for this repo?)
      </div>
    )

  const sub = (k: typeof view, label: string, count?: number) => (
    <button
      onClick={() => setView(k)}
      className={`rounded-md px-3 py-1 text-[12px] font-medium ${
        view === k ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {label}
      {count != null && count > 0 && <span className="ml-1 text-zinc-500">· {count}</span>}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <button
          onClick={onBack}
          className="rounded-md px-2 py-1 text-[12px] text-zinc-400 hover:bg-white/5"
        >
          ‹ MRs
        </button>
        <span className="font-mono text-[12px] text-zinc-500">!{mr.iid}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-100">{mr.title}</span>
        <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>
        {mr.draft && <Badge tone="warn">draft</Badge>}
        <button
          onClick={() => window.gt.openExternal(mr.webUrl)}
          className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
        >
          open ↗
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--gt-border)] px-4 py-1.5">
        {sub('overview', '📝 Overview')}
        {sub('review', '🔍 Review')}
        {sub('findings', '⚠ Findings', mr.findings.length + mr.suggestions.length)}
        {sub('diff', '🧬 Diff')}
        <span className="ml-2 truncate text-[10px] text-zinc-700">
          ⎇ {mr.sourceBranch} → {mr.targetBranch}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'overview' && <Overview mr={mr} />}
        {view === 'review' && <ReviewBody mr={mr} />}
        {view === 'findings' && <FindingsList items={mr.findings} suggestions={mr.suggestions} />}
        {view === 'diff' && <DiffView diff={diff || ''} scope={`${repoLabel}.${iid}`} />}
      </div>
    </div>
  )
}
