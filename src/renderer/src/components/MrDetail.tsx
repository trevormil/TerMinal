import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  FileText,
  ScanSearch,
  TriangleAlert,
  Lightbulb,
  GitCompare,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  GitBranch,
  Folder,
  File,
  Rows3,
} from 'lucide-react'
import parseDiff from 'parse-diff'
import hljs from 'highlight.js/lib/common'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Badge } from './ui'
import { Markdown } from './Markdown'
import { PrAgentActions } from './PrAgentActions'
import { MrMergeButton } from './MrMergeButton'
import { DigestView } from './DigestView'
import { xtermThemeFromCss } from './Terminal'
import { groupJobsByStage } from '../lib/ci'
import { stateTone, verdictTone, testTone, sevTone, ciTone } from '../lib/badges'
import type { MrDetail, Finding, CiInfo, StructuralDiffResult } from '../lib/types'

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

type DiffFile = ReturnType<typeof parseDiff>[number]
type DiffTreeFile = {
  type: 'file'
  name: string
  path: string
  file: DiffFile
  additions: number
  deletions: number
}
type DiffTreeDir = {
  type: 'dir'
  name: string
  path: string
  children: DiffTreeNode[]
  fileCount: number
  additions: number
  deletions: number
}
type DiffTreeNode = DiffTreeDir | DiffTreeFile

const filePathOf = (f: DiffFile) => f.to || f.from || ''

function buildDiffTree(files: DiffFile[]): DiffTreeDir {
  const root: DiffTreeDir = {
    type: 'dir',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
    additions: 0,
    deletions: 0,
  }
  const dirs = new Map<string, DiffTreeDir>([['', root]])
  const ensureDir = (path: string, name: string): DiffTreeDir => {
    const existing = dirs.get(path)
    if (existing) return existing
    const parentPath = path.split('/').slice(0, -1).join('/')
    const parentName = parentPath.split('/').pop() || ''
    const parent = ensureDir(parentPath, parentName)
    const dir: DiffTreeDir = {
      type: 'dir',
      name,
      path,
      children: [],
      fileCount: 0,
      additions: 0,
      deletions: 0,
    }
    dirs.set(path, dir)
    parent.children.push(dir)
    return dir
  }

  for (const file of files) {
    const path = filePathOf(file)
    if (!path) continue
    const parts = path.split('/')
    const name = parts.pop() || path
    const dirPath = parts.join('/')
    const dirName = parts[parts.length - 1] || ''
    const dir = ensureDir(dirPath, dirName)
    const node: DiffTreeFile = {
      type: 'file',
      name,
      path,
      file,
      additions: file.additions,
      deletions: file.deletions,
    }
    dir.children.push(node)
    for (let i = 0; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      const d = dirs.get(p)
      if (!d) continue
      d.fileCount += 1
      d.additions += file.additions
      d.deletions += file.deletions
    }
  }

  const sort = (dir: DiffTreeDir) => {
    dir.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const child of dir.children) if (child.type === 'dir') sort(child)
  }
  sort(root)
  return root
}

function collectDirPaths(dir: DiffTreeDir): string[] {
  return dir.children.flatMap((child) =>
    child.type === 'dir' ? [child.path, ...collectDirPaths(child)] : [],
  )
}

export function FileDiff({
  file,
  mode,
  focusLine,
  mechanicalHunks,
}: {
  file: any
  mode: 'unified' | 'split'
  focusLine?: number
  mechanicalHunks?: { mechanical: boolean; label: string }[]
}) {
  const langId = langOf(file.to || file.from || '')
  const focusRef = useRef<HTMLTableRowElement>(null)
  const [openMech, setOpenMech] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (focusLine != null) focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focusLine])
  // Only collapse when the per-hunk flags line up 1:1 with parse-diff's hunks.
  const canCollapse = !!mechanicalHunks && mechanicalHunks.length === file.chunks.length
  return (
    <div className="font-mono text-[12px]">
      <div className="sticky top-0 z-10 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-3 py-2 text-[12px] text-zinc-300">
        <span className="text-zinc-500">{file.from === file.to ? '' : `${file.from} → `}</span>
        <span>{file.to || file.from}</span>
        <span className="ml-3 text-[var(--gt-green)]">+{file.additions}</span>{' '}
        <span className="text-[var(--gt-red)]">-{file.deletions}</span>
      </div>
      {file.chunks.map((c: any, ci: number) => {
        if (canCollapse && mechanicalHunks![ci].mechanical && !openMech.has(ci)) {
          const n = c.changes.filter((ch: any) => ch.type !== 'normal').length
          return (
            <button
              key={ci}
              onClick={() => setOpenMech((s) => new Set(s).add(ci))}
              className="flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/40 bg-[var(--gt-panel)]/40 px-3 py-1 text-left text-[11px] text-zinc-600 hover:text-zinc-400"
            >
              <ChevronRight size={11} strokeWidth={2} className="shrink-0" />
              {mechanicalHunks![ci].label} · {n} lines — skip
            </button>
          )
        }
        return (
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
        )
      })}
    </div>
  )
}

// Human-readable copy for the non-ok structural-diff outcomes.
function structuralMessage(res: Extract<StructuralDiffResult, { ok: false }>): string {
  switch (res.reason) {
    case 'difft-missing':
      return 'difft not found. Install difftastic (brew install difftastic) to enable structural diffs.'
    case 'binary':
      return 'Binary file — structural diff is unavailable. Use Unified or Split instead.'
    case 'fetch-failed':
      return "Couldn't fetch file contents from the forge (rate limit or auth). Switch away and back to retry."
    default:
      return res.message || 'Structural diff failed.'
  }
}

// Renders difft's ANSI output for one file in a read-only xterm instance —
// reusing the app's terminal renderer means correct color + column alignment
// for free, matching difft's real terminal look. The per-file fetch is injected
// (`fetchStructural`) so the same component serves both the forge MR diff and
// the local-changes diff; a change in that (memoized) fetcher re-runs cleanly.
function StructuralFileDiff({
  fetchStructural,
}: {
  fetchStructural: (width: number) => Promise<StructuralDiffResult>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading')

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let disposed = false
    const term = new Xterm({
      fontFamily: "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      disableStdin: true,
      cursorInactiveStyle: 'none',
      convertEol: true,
      scrollback: 20000,
      theme: xtermThemeFromCss(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    try {
      fit.fit()
    } catch {
      /* container not measured yet — difft falls back to its default width */
    }
    const cols = term.cols || 160
    fetchStructural(cols)
      .then((res) => {
        if (disposed) return
        if (res.ok) {
          // xterm auto-scrolls to the bottom as output streams in; once the
          // write is flushed, snap back to the top of the file.
          term.write(res.output, () => {
            if (!disposed) term.scrollToTop()
          })
          setState('ready')
        } else {
          setState({ error: structuralMessage(res) })
        }
      })
      .catch((e) => {
        if (!disposed) setState({ error: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      disposed = true
      term.dispose()
    }
  }, [fetchStructural])

  return (
    <div className="relative h-full min-h-0">
      <div ref={hostRef} className="h-full min-h-0 p-2" />
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--gt-terminal-bg)] text-[12px] text-zinc-600">
          Running difft…
        </div>
      )}
      {typeof state === 'object' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--gt-terminal-bg)] p-6 text-center text-[12px] text-zinc-500">
          {state.error}
        </div>
      )}
    </div>
  )
}

export function DiffView({
  diff,
  scope,
  fetchStructural,
}: {
  diff: string
  scope: string
  fetchStructural: (path: string, width: number) => Promise<StructuralDiffResult>
}) {
  const files = useMemo(() => parseDiff(diff), [diff])
  const tree = useMemo(() => buildDiffTree(files), [files])
  const [selected, setSelected] = useState<string>('')
  const [mode, setMode] = useState<'unified' | 'split' | 'structural'>('unified')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [viewed, setViewed, setAll] = useViewed(scope)
  // Probe difft once so the Structural toggle can disable itself (with an
  // install hint) rather than fail on click when the binary is absent.
  const [difftOk, setDifftOk] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    window.gt.difftAvailable().then((ok) => live && setDifftOk(ok))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!selected && files[0]) setSelected(files[0].to || files[0].from || '')
  }, [files, selected])
  useEffect(() => {
    setExpanded(new Set(collectDirPaths(tree)))
  }, [tree])
  // Per-file structural fetch for the currently-selected file, memoized so
  // StructuralFileDiff only re-runs difft when the file (or fetcher) changes.
  const structuralFetch = useCallback(
    (width: number) => fetchStructural(selected, width),
    [fetchStructural, selected],
  )

  if (!diff) return <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
  if (files.length === 0)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        No diff (or the harness diff hasn't been generated and the forge returned empty).
      </div>
    )
  const file = files.find((f) => (f.to || f.from || '') === selected) || files[0]
  const paths = files.map((f) => f.to || f.from || '')
  const viewedCount = paths.filter((p) => viewed[p]).length
  const allViewed = viewedCount === paths.length && paths.length > 0
  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const renderTree = (nodes: DiffTreeNode[], depth = 0): ReactNode =>
    nodes.map((node) => {
      const pad = 10 + depth * 12
      if (node.type === 'dir') {
        const open = expanded.has(node.path)
        return (
          <div key={node.path}>
            <button
              onClick={() => toggleDir(node.path)}
              className="flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/40 py-1.5 pr-2 text-left text-[11px] hover:bg-white/5"
              style={{ paddingLeft: pad }}
              title={node.path}
            >
              {open ? (
                <ChevronDown size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
              ) : (
                <ChevronRight size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
              )}
              <Folder size={12} strokeWidth={2} className="shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">{node.name}</span>
              <span className="shrink-0 tabular-nums text-zinc-700">{node.fileCount}</span>
              <span className="shrink-0 tabular-nums text-[var(--gt-green)]/80">+{node.additions}</span>
              <span className="shrink-0 tabular-nums text-[var(--gt-red)]/80">-{node.deletions}</span>
            </button>
            {open ? renderTree(node.children, depth + 1) : null}
          </div>
        )
      }
      const path = node.path
      const isV = !!viewed[path]
      const isSel = (file.to || file.from) === path
      return (
        <div
          key={path}
          onClick={() => setSelected(path)}
          className={`flex cursor-pointer items-center gap-1.5 border-b border-[var(--gt-border)]/40 py-1.5 pr-2 text-[11.5px] hover:bg-white/5 ${
            isSel ? 'bg-white/5' : ''
          }`}
          style={{ paddingLeft: pad + 18 }}
        >
          <input
            type="checkbox"
            checked={isV}
            onChange={(e) => setViewed(path, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 accent-[var(--gt-accent)]"
          />
          <File size={11} strokeWidth={2} className="shrink-0 text-zinc-600" />
          <span
            className={`min-w-0 flex-1 truncate font-mono ${isV ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}
            title={path}
          >
            {node.name}
          </span>
          <span className="shrink-0 tabular-nums text-[var(--gt-green)]">+{node.additions}</span>
          <span className="shrink-0 tabular-nums text-[var(--gt-red)]">-{node.deletions}</span>
        </div>
      )
    })

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
        {renderTree(tree.children)}
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
          <button
            onClick={() => difftOk !== false && setMode('structural')}
            disabled={difftOk === false}
            title={
              difftOk === false
                ? 'Structural diff needs difftastic. Install with: brew install difftastic'
                : 'Tree-sitter structural diff via difftastic'
            }
            className={`rounded px-2 py-0.5 text-[11px] ${
              difftOk === false
                ? 'cursor-not-allowed text-zinc-700'
                : mode === 'structural'
                  ? 'bg-white/10 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            Structural
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {mode === 'structural' ? (
            <StructuralFileDiff key={`struct:${selected}`} fetchStructural={structuralFetch} />
          ) : (
            <FileDiff file={file} mode={mode} />
          )}
        </div>
      </div>
    </div>
  )
}

// Forge CI pipeline for the MR head — overall status + jobs grouped by stage.
function CiPanel({ ci }: { ci: CiInfo | null | undefined }) {
  if (ci === undefined)
    return <div className="mb-4 text-[11px] text-zinc-600">Loading CI pipeline…</div>
  if (ci === null)
    return <div className="mb-4 text-[11px] text-zinc-600">No CI pipeline for this MR.</div>

  const stages = groupJobsByStage(ci.jobs)

  return (
    <div className="mb-4 rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">CI pipeline</span>
        <Badge tone={ciTone(ci.status)}>{ci.status || 'unknown'}</Badge>
        {ci.webUrl && (
          <button
            onClick={() => window.gt.openExternal(ci.webUrl)}
            className="inline-flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            logs
            <ArrowUpRight size={11} strokeWidth={2} />
          </button>
        )}
      </div>
      {stages.length === 0 ? (
        <div className="text-[11px] text-zinc-600">No jobs.</div>
      ) : (
        <div className="space-y-1.5">
          {stages.map((s) => (
            <div key={s.stage} className="flex items-start gap-2">
              <span className="mt-0.5 w-20 shrink-0 truncate text-[10px] uppercase tracking-wide text-zinc-600">
                {s.stage}
              </span>
              <div className="flex flex-wrap gap-1">
                {s.jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => j.webUrl && window.gt.openExternal(j.webUrl)}
                    title={`${j.name} · ${j.status}`}
                  >
                    <Badge tone={ciTone(j.status)}>{j.name}</Badge>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Overview({ mr, ci }: { mr: MrDetail; ci: CiInfo | null | undefined }) {
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
        {mr.reviewMeta?.riskTier && mr.reviewMeta.riskTier !== 'unscored' && (
          <Badge
            tone={
              mr.reviewMeta.riskTier === 'high'
                ? 'red'
                : mr.reviewMeta.riskTier === 'medium'
                  ? 'yellow'
                  : 'green'
            }
          >
            {mr.reviewMeta.riskScore != null
              ? `risk ${mr.reviewMeta.riskScore}/5`
              : `${mr.reviewMeta.riskTier} risk`}
          </Badge>
        )}
        {mr.reviewMeta?.stale && (
          <Badge tone="warn">
            <TriangleAlert size={9} strokeWidth={2.5} />
            stale
          </Badge>
        )}
        {mr.artifactShortSha && <span className="font-mono text-zinc-600">artifact {mr.artifactShortSha}</span>}
      </div>
      <CiPanel ci={ci} />
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
        <div className="text-[12px] italic text-zinc-600">No review artifact recorded yet.</div>
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
  label = 'MR',
  sym = '!',
  onBack,
  onMerged,
}: {
  iid: number
  repoLabel: string
  label?: string
  sym?: string
  onBack: () => void
  onMerged?: () => void
}) {
  const [mr, setMr] = useState<MrDetail | null | undefined>(undefined)
  const [ci, setCi] = useState<CiInfo | null | undefined>(undefined)
  const [view, setView] = useState<
    'overview' | 'review' | 'findings' | 'suggestions' | 'diff' | 'digest'
  >('overview')
  const [diff, setDiff] = useState<string | null>(null)

  useEffect(() => {
    setMr(undefined)
    setCi(undefined)
    setDiff(null)
    window.gt.getMr(iid).then(setMr)
    window.gt.getMrCi(iid).then(setCi)
  }, [iid])
  useEffect(() => {
    // Both the Diff and Digest tabs render the real green/red diff.
    if ((view === 'diff' || view === 'digest') && diff === null) {
      setDiff('')
      window.gt.getMrDiff(iid).then(setDiff)
    }
  }, [view, iid]) // eslint-disable-line react-hooks/exhaustive-deps
  // MR-scoped structural fetch, injected into DiffView (which is source-agnostic).
  const fetchStructural = useCallback(
    (path: string, width: number) => window.gt.getStructuralDiff(iid, path, width),
    [iid],
  )

  if (mr === undefined)
    return <div className="p-6 text-[12px] text-zinc-600">Loading {sym}{iid}…</div>
  if (mr === null)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        Couldn't load {sym}{iid} (is <code className="text-zinc-400">{label === 'PR' ? 'gh' : 'glab'}</code>{' '}
        authenticated for this repo?)
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
          {label}s
        </button>
        <span className="font-mono text-[12px] text-zinc-500">{sym}{mr.iid}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-100">{mr.title}</span>
        <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>
        {mr.draft && <Badge tone="warn">draft</Badge>}
        <div className="flex items-center gap-1.5">
          <PrAgentActions pr={mr} sym={sym} />
          {mr.state === 'opened' && (
            <MrMergeButton iid={mr.iid} sym={sym} onMerged={onMerged ?? onBack} />
          )}
          <button
            onClick={() => window.gt.openExternal(mr.webUrl)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
          >
            open
            <ArrowUpRight size={12} strokeWidth={2} />
          </button>
        </div>
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
          'diff',
          <>
            <GitCompare size={13} strokeWidth={2} />
            Diff
          </>,
        )}
        {sub(
          'digest',
          <>
            <Rows3 size={13} strokeWidth={2} />
            Digest
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
        <span className="ml-2 inline-flex items-center gap-0.5 truncate text-[10px] text-zinc-700">
          <GitBranch size={11} strokeWidth={2} />
          {mr.sourceBranch} → {mr.targetBranch}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'overview' && <Overview mr={mr} ci={ci} />}
        {view === 'review' && <ReviewBody mr={mr} />}
        {view === 'findings' && (
          <FindingCards items={mr.findings} empty="No findings for this MR." />
        )}
        {view === 'suggestions' && (
          <FindingCards items={mr.suggestions} muted empty="No suggestions for this MR." />
        )}
        {view === 'diff' && (
          <DiffView diff={diff || ''} scope={`${repoLabel}.${iid}`} fetchStructural={fetchStructural} />
        )}
        {view === 'digest' && <DigestView iid={iid} headShort={mr.headShort} diff={diff} />}
      </div>
    </div>
  )
}
