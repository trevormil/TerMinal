import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FileText,
  ScanSearch,
  TriangleAlert,
  Lightbulb,
  GitCompare,
  ChevronLeft,
  ArrowUpRight,
  GitBranch,
} from 'lucide-react'
import parseDiff from 'parse-diff'
import hljs from 'highlight.js/lib/common'
import { Badge } from './ui'
import { Markdown } from './Markdown'
import { stateTone, verdictTone, testTone, sevTone } from '../lib/badges'
import type { MrDetail, Finding } from '../lib/types'

const HLJS_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  cjs: 'javascript', json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less',
  html: 'xml', xml: 'xml', py: 'python', rs: 'rust', go: 'go', yaml: 'yaml', yml: 'yaml', sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', java: 'java',
  php: 'php', rb: 'ruby', toml: 'ini',
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const langOf = (path: string) => HLJS_LANG[path.split('.').pop()?.toLowerCase() || '']
const stripPrefix = (s: string) =>
  s.length && (s[0] === '+' || s[0] === '-' || s[0] === ' ') ? s.slice(1) : s
function hlHtml(content: string, langId?: string): string {
  const code = stripPrefix(content)
  if (!code) return ''
  try {
    if (langId && hljs.getLanguage(langId))
      return hljs.highlight(code, { language: langId, ignoreIllegals: true }).value
  } catch {
    /* fall through */
  }
  return esc(code)
}
function Code({ content, langId }: { content: string; langId?: string }) {
  return <span dangerouslySetInnerHTML={{ __html: hlHtml(content, langId) }} />
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
  const setAll = (paths: string[], v: boolean) =>
    setM(() => (v ? Object.fromEntries(paths.map((p) => [p, true])) : {}))
  return [m, set, setAll] as const
}

type Side = { ln: number | string; content: string; type: 'normal' | 'add' | 'del' } | undefined
function alignChunk(changes: any[]): { left: Side; right: Side }[] {
  const rows: { left: Side; right: Side }[] = []
  let i = 0
  while (i < changes.length) {
    const c = changes[i]
    if (c.type === 'normal') {
      rows.push({
        left: { ln: c.ln1, content: c.content, type: 'normal' },
        right: { ln: c.ln2, content: c.content, type: 'normal' },
      })
      i++
      continue
    }
    const dels: any[] = []
    const adds: any[] = []
    while (i < changes.length && changes[i].type === 'del') dels.push(changes[i++])
    while (i < changes.length && changes[i].type === 'add') adds.push(changes[i++])
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++)
      rows.push({
        left: dels[k] ? { ln: dels[k].ln, content: dels[k].content, type: 'del' } : undefined,
        right: adds[k] ? { ln: adds[k].ln, content: adds[k].content, type: 'add' } : undefined,
      })
  }
  return rows
}
const sideBg = (s: Side) =>
  s?.type === 'add'
    ? 'bg-[var(--gt-green)]/[0.08]'
    : s?.type === 'del'
      ? 'bg-[var(--gt-red)]/[0.08]'
      : ''

function FileDiff({ file, mode }: { file: any; mode: 'unified' | 'split' }) {
  const langId = langOf(file.to || file.from || '')
  return (
    <div className="font-mono text-[12px]">
      <div className="sticky top-0 z-10 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-3 py-2 text-[12px] text-zinc-300">
        <span className="text-zinc-500">{file.from === file.to ? '' : `${file.from} → `}</span>
        <span>{file.to || file.from}</span>
        <span className="ml-3 text-[var(--gt-green)]">+{file.additions}</span>{' '}
        <span className="text-[var(--gt-red)]">-{file.deletions}</span>
      </div>
      {file.chunks.map((c: any, ci: number) => (
        <div key={ci}>
          <div className="bg-[var(--gt-panel)] px-3 py-1 text-[11px] text-zinc-500">{c.content}</div>
          {mode === 'unified' ? (
            <table className="w-full border-collapse">
              <tbody>
                {c.changes.map((ch: any, i: number) => {
                  const bg =
                    ch.type === 'add'
                      ? 'bg-[var(--gt-green)]/[0.08]'
                      : ch.type === 'del'
                        ? 'bg-[var(--gt-red)]/[0.08]'
                        : ''
                  const oldLn = ch.type === 'normal' ? ch.ln1 : ch.type === 'del' ? ch.ln : ''
                  const newLn = ch.type === 'normal' ? ch.ln2 : ch.type === 'add' ? ch.ln : ''
                  const prefix = ch.type === 'add' ? '+' : ch.type === 'del' ? '-' : ' '
                  return (
                    <tr key={i} className={bg}>
                      <td className="w-10 select-none px-2 text-right text-[10px] text-zinc-600">{oldLn || ''}</td>
                      <td className="w-10 select-none px-2 text-right text-[10px] text-zinc-600">{newLn || ''}</td>
                      <td className="w-3 select-none text-center text-zinc-600">{prefix}</td>
                      <td className="whitespace-pre px-2 text-zinc-200">
                        <Code content={ch.content} langId={langId} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full table-fixed border-collapse">
              <tbody>
                {alignChunk(c.changes).map((row, i) => (
                  <tr key={i}>
                    <td className={`w-9 select-none px-1 text-right text-[10px] text-zinc-600 ${sideBg(row.left)}`}>
                      {row.left?.ln || ''}
                    </td>
                    <td className={`w-1/2 truncate whitespace-pre border-r border-[var(--gt-border)] px-2 text-zinc-200 ${sideBg(row.left)}`}>
                      {row.left ? <Code content={row.left.content} langId={langId} /> : ''}
                    </td>
                    <td className={`w-9 select-none px-1 text-right text-[10px] text-zinc-600 ${sideBg(row.right)}`}>
                      {row.right?.ln || ''}
                    </td>
                    <td className={`w-1/2 truncate whitespace-pre px-2 text-zinc-200 ${sideBg(row.right)}`}>
                      {row.right ? <Code content={row.right.content} langId={langId} /> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}

function DiffView({ diff, scope }: { diff: string; scope: string }) {
  const files = useMemo(() => parseDiff(diff), [diff])
  const [selected, setSelected] = useState<string>('')
  const [mode, setMode] = useState<'unified' | 'split'>('unified')
  const [viewed, setViewed, setAll] = useViewed(scope)
  useEffect(() => {
    if (!selected && files[0]) setSelected(files[0].to || files[0].from || '')
  }, [files, selected])

  if (!diff) return <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
  if (files.length === 0)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        No diff (or the harness diff hasn't been generated and glab returned empty).
      </div>
    )
  const file = files.find((f) => (f.to || f.from || '') === selected) || files[0]
  const paths = files.map((f) => f.to || f.from || '')
  const viewedCount = paths.filter((p) => viewed[p]).length
  const allViewed = viewedCount === paths.length && paths.length > 0

  return (
    <div className="flex h-full min-h-0">
      <div className="w-80 shrink-0 overflow-y-auto border-r border-[var(--gt-border)]">
        <div className="flex items-center justify-between border-b border-[var(--gt-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-600">
          <span>
            {files.length} files · {viewedCount} viewed
          </span>
          <button
            onClick={() => setAll(paths, !allViewed)}
            className="rounded px-1.5 py-0.5 text-[10px] normal-case text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          >
            {allViewed ? 'clear' : 'mark all'}
          </button>
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
              <span className="text-[var(--gt-green)]">+{f.additions}</span>
              <span className="text-[var(--gt-red)]">-{f.deletions}</span>
            </div>
          )
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-3 py-1">
          <button
            onClick={() => setMode('unified')}
            className={`rounded px-2 py-0.5 text-[11px] ${mode === 'unified' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            Unified
          </button>
          <button
            onClick={() => setMode('split')}
            className={`rounded px-2 py-0.5 text-[11px] ${mode === 'split' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            Split
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <FileDiff file={file} mode={mode} />
        </div>
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
        {mr.reviewMeta?.stale && (
          <Badge tone="warn">
            <TriangleAlert size={9} strokeWidth={2.5} />
            stale
          </Badge>
        )}
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

function FindingCards({ items, muted, empty }: { items: Finding[]; muted?: boolean; empty: string }) {
  if (items.length === 0) return <div className="p-6 text-[12px] text-zinc-600">{empty}</div>
  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {items.map((f, i) => (
        <FindingCard key={i} f={f} mutedSeverity={muted} />
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
  const [view, setView] = useState<'overview' | 'review' | 'findings' | 'suggestions' | 'diff'>(
    'overview',
  )
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

  const sub = (k: typeof view, label: ReactNode, count?: number) => (
    <button
      onClick={() => setView(k)}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium ${
        view === k ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {label}
      {count != null && count > 0 && <span className="text-zinc-500">· {count}</span>}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[12px] text-zinc-400 hover:bg-white/5"
        >
          <ChevronLeft size={14} strokeWidth={2} />
          MRs
        </button>
        <span className="font-mono text-[12px] text-zinc-500">!{mr.iid}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-100">{mr.title}</span>
        <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>
        {mr.draft && <Badge tone="warn">draft</Badge>}
        <button
          onClick={() => window.gt.openExternal(mr.webUrl)}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
        >
          open
          <ArrowUpRight size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--gt-border)] px-4 py-1.5">
        {sub(
          'overview',
          <>
            <FileText size={13} strokeWidth={2} />
            Overview
          </>,
        )}
        {sub(
          'review',
          <>
            <ScanSearch size={13} strokeWidth={2} />
            Review
          </>,
        )}
        {sub(
          'findings',
          <>
            <TriangleAlert size={13} strokeWidth={2} />
            Findings
          </>,
          mr.findings.length,
        )}
        {sub(
          'suggestions',
          <>
            <Lightbulb size={13} strokeWidth={2} />
            Suggestions
          </>,
          mr.suggestions.length,
        )}
        {sub(
          'diff',
          <>
            <GitCompare size={13} strokeWidth={2} />
            Diff
          </>,
        )}
        <span className="ml-2 inline-flex items-center gap-0.5 truncate text-[10px] text-zinc-700">
          <GitBranch size={11} strokeWidth={2} />
          {mr.sourceBranch} → {mr.targetBranch}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'overview' && <Overview mr={mr} />}
        {view === 'review' && <ReviewBody mr={mr} />}
        {view === 'findings' && (
          <FindingCards items={mr.findings} empty="No findings for this MR." />
        )}
        {view === 'suggestions' && (
          <FindingCards items={mr.suggestions} muted empty="No suggestions for this MR." />
        )}
        {view === 'diff' && <DiffView diff={diff || ''} scope={`${repoLabel}.${iid}`} />}
      </div>
    </div>
  )
}
