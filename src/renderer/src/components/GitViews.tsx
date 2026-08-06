import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  History,
  Plus,
  RefreshCw,
  Tag,
  X,
  Archive,
} from 'lucide-react'
import { DiffView } from './MrDetail'
import { relativeTime } from '../lib/time'
import type {
  GitBranch as GitBranchInfo,
  GitCommit,
  GitCommitDetail,
  GitStash,
  GitTag,
} from '../lib/types'

// VS Code-style git views for the Files tab: commit history, branches,
// stashes, and tags. Read-mostly — the only mutations are branch checkout
// and create. Stashes are display-only on purpose: refs/stash is repo-global
// across worktrees, so apply/pop from a UI that may sit next to live agent
// worktrees is a footgun.

const PAGE = 100

const refChip = (r: string) => {
  const isTag = r.startsWith('tag: ')
  const isHead = r.startsWith('HEAD')
  return (
    <span
      key={r}
      className={`inline-flex max-w-[160px] items-center gap-0.5 truncate rounded border px-1 py-px font-mono text-[9.5px] ${
        isHead
          ? 'border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/10 text-[var(--gt-accent-light)]'
          : isTag
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-[var(--gt-border)] bg-black/30 text-zinc-400'
      }`}
      title={r}
    >
      {isTag ? <Tag size={8} strokeWidth={2} /> : <GitBranch size={8} strokeWidth={2} />}
      {r.replace(/^tag: /, '')}
    </span>
  )
}

/** Sidebar: paged commit list, optionally scoped to a ref (branch/tag). */
export function HistoryPane({
  refName,
  onClearRef,
  selected,
  onSelect,
}: {
  /** null/'' = HEAD. */
  refName: string | null
  onClearRef: () => void
  selected: string | null
  onSelect: (sha: string) => void
}) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(
    (skip: number) => {
      setLoading(true)
      window.gt
        .gitLog({ limit: PAGE, skip, ref: refName || undefined })
        .then((r) => {
          if (!r.ok) {
            setError(r.error)
            if (skip === 0) setCommits([])
            return
          }
          setError('')
          setCommits((prev) => (skip === 0 ? r.commits : [...prev, ...r.commits]))
          setDone(r.commits.length < PAGE)
        })
        .finally(() => setLoading(false))
    },
    [refName],
  )
  useEffect(() => {
    setCommits([])
    setDone(false)
    load(0)
  }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] px-3 py-2">
        <History size={12} strokeWidth={2} className="shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">
          {refName || 'HEAD'}
        </span>
        {refName && (
          <button
            onClick={onClearRef}
            className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            title="Back to HEAD history"
          >
            <X size={11} strokeWidth={2} />
          </button>
        )}
        <button
          onClick={() => load(0)}
          className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          title="Refresh"
        >
          <RefreshCw size={11} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? (
          <div className="p-3 text-[11px] text-amber-400">{error}</div>
        ) : commits.length === 0 && !loading ? (
          <div className="p-3 text-[11px] text-zinc-600">No commits.</div>
        ) : (
          commits.map((c) => (
            <button
              key={c.sha}
              onClick={() => onSelect(c.sha)}
              title={`${c.shortSha} · ${c.author}`}
              className={`block w-full px-3 py-1.5 text-left hover:bg-white/5 ${
                selected === c.sha ? 'bg-[var(--gt-accent)]/10' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <GitCommitHorizontal size={11} strokeWidth={2} className="shrink-0 text-zinc-600" />
                <span
                  className={`min-w-0 flex-1 truncate text-[11.5px] ${
                    selected === c.sha ? 'text-zinc-100' : 'text-zinc-300'
                  }`}
                >
                  {c.subject || '(no subject)'}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 pl-[17px]">
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">{c.shortSha}</span>
                <span className="min-w-0 truncate text-[10px] text-zinc-600">{c.author}</span>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
                  {relativeTime(c.date)}
                </span>
              </div>
              {c.refs.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-1 pl-[17px]">{c.refs.map(refChip)}</div>
              )}
            </button>
          ))
        )}
        {!done && commits.length > 0 && (
          <button
            onClick={() => load(commits.length)}
            disabled={loading}
            className="mx-3 my-1.5 w-[calc(100%-24px)] rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  label,
  count,
  open,
  onToggle,
}: {
  icon: typeof GitBranch
  label: string
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/60 px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
    >
      <ChevronRight
        size={10}
        strokeWidth={2}
        className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      />
      <Icon size={11} strokeWidth={2} className="shrink-0" />
      {label}
      <span className="ml-auto font-mono text-[10px] text-zinc-600">{count}</span>
    </button>
  )
}

/** Sidebar: branches (checkout/create) + stashes + tags. */
export function BranchesPane({
  onFilterHistory,
  onShowRef,
  onRepoChanged,
}: {
  /** Scope the History pane to this ref and switch to it. */
  onFilterHistory: (ref: string) => void
  /** Show a ref (stash/tag/branch tip) in the main-pane commit view. */
  onShowRef: (ref: string) => void
  /** A checkout/branch-create changed the working tree — reload trees/status. */
  onRepoChanged: () => void
}) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [stashes, setStashes] = useState<GitStash[]>([])
  const [tags, setTags] = useState<GitTag[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [openRemote, setOpenRemote] = useState(false)
  const [openStashes, setOpenStashes] = useState(true)
  const [openTags, setOpenTags] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // Two-step checkout: first click arms, second confirms. Switching branches
  // rewrites the working tree, so it must never happen on a stray click.
  const [armed, setArmed] = useState<string | null>(null)
  const [opErr, setOpErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([window.gt.gitBranches(), window.gt.gitStashes(), window.gt.gitTags()])
      .then(([b, s, t]) => {
        if (!b.ok) {
          setError(b.error)
          return
        }
        setError('')
        setBranches(b.branches)
        setStashes(s.ok ? s.stashes : [])
        setTags(t.ok ? t.tags : [])
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const locals = branches.filter((b) => !b.remote)
  const remotes = branches.filter((b) => b.remote)
  const current = locals.find((b) => b.current)

  const checkout = async (b: GitBranchInfo) => {
    // Remote rows check out via the short local name — `git switch` DWIMs a
    // tracking branch from origin/<name>.
    const target = b.remote ? b.name.replace(/^[^/]+\//, '') : b.name
    if (armed !== b.name) {
      setArmed(b.name)
      setOpErr('')
      return
    }
    setArmed(null)
    setBusy(true)
    const r = await window.gt.gitCheckout(target)
    setBusy(false)
    if (!r.ok) {
      setOpErr(r.error)
      return
    }
    setOpErr('')
    load()
    onRepoChanged()
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const r = await window.gt.gitCreateBranch(name)
    setBusy(false)
    if (!r.ok) {
      setOpErr(r.error)
      return
    }
    setOpErr('')
    setCreating(false)
    setNewName('')
    load()
    onRepoChanged()
  }

  const branchRow = (b: GitBranchInfo) => (
    <div
      key={b.name}
      className={`group flex items-center gap-1.5 px-3 py-1 ${
        b.current ? 'bg-[var(--gt-accent)]/10' : 'hover:bg-white/5'
      }`}
    >
      <GitBranch
        size={11}
        strokeWidth={2}
        className={`shrink-0 ${b.current ? 'text-[var(--gt-accent-light)]' : 'text-zinc-600'}`}
      />
      <button
        onClick={() => onFilterHistory(b.name)}
        title={`${b.name} — view history`}
        className={`min-w-0 flex-1 truncate text-left font-mono text-[11px] ${
          b.current ? 'font-semibold text-zinc-100' : 'text-zinc-300 hover:text-zinc-100'
        }`}
      >
        {b.name}
      </button>
      {(b.ahead > 0 || b.behind > 0) && (
        <span
          className="shrink-0 font-mono text-[9.5px] text-zinc-500"
          title="ahead/behind upstream"
        >
          {b.ahead > 0 ? `↑${b.ahead}` : ''}
          {b.behind > 0 ? `↓${b.behind}` : ''}
        </span>
      )}
      <span className="shrink-0 text-[9.5px] text-zinc-600">{relativeTime(b.date)}</span>
      {!b.current && (
        <button
          onClick={() => checkout(b)}
          disabled={busy}
          className={`shrink-0 rounded border px-1.5 py-px text-[9.5px] transition-opacity ${
            armed === b.name
              ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 opacity-100'
              : 'border-[var(--gt-border)] text-zinc-500 opacity-0 hover:text-zinc-200 group-hover:opacity-100'
          }`}
          title={armed === b.name ? 'Click again to switch the working tree' : 'Checkout'}
        >
          {armed === b.name ? 'sure?' : 'checkout'}
        </button>
      )}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] px-3 py-2">
        <GitBranch size={12} strokeWidth={2} className="shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">
          {current?.name || 'detached HEAD'}
        </span>
        <button
          onClick={() => {
            setCreating((v) => !v)
            setOpErr('')
          }}
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          title="Create a branch off the current HEAD"
        >
          <Plus size={11} strokeWidth={2} />
          branch
        </button>
        <button
          onClick={load}
          className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          title="Refresh"
        >
          <RefreshCw size={11} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {creating && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] px-3 py-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder="feat/new-branch — off current HEAD"
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-[var(--gt-border)] bg-black/30 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
          />
          <button
            onClick={() => void create()}
            disabled={!newName.trim() || busy}
            className="flex shrink-0 items-center rounded border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/10 px-1.5 py-1 text-[10.5px] text-zinc-100 disabled:opacity-40"
          >
            <Check size={11} strokeWidth={2} />
          </button>
        </div>
      )}
      {(error || opErr) && (
        <div className="shrink-0 border-b border-[var(--gt-border)] px-3 py-1.5 text-[10.5px] text-amber-400">
          {error || opErr}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
          Branches
        </div>
        {locals.map(branchRow)}
        {locals.length === 0 && !loading && (
          <div className="px-3 py-1 text-[11px] text-zinc-600">No local branches.</div>
        )}
        <SectionHeader
          icon={GitBranch}
          label="Remotes"
          count={remotes.length}
          open={openRemote}
          onToggle={() => setOpenRemote((v) => !v)}
        />
        {openRemote && remotes.map(branchRow)}
        <SectionHeader
          icon={Archive}
          label="Stashes"
          count={stashes.length}
          open={openStashes}
          onToggle={() => setOpenStashes((v) => !v)}
        />
        {openStashes &&
          stashes.map((s) => (
            <button
              key={s.ref}
              onClick={() => onShowRef(s.ref)}
              title={`${s.ref} — view the stashed patch (read-only; apply from a terminal)`}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-white/5"
            >
              <Archive size={11} strokeWidth={2} className="shrink-0 text-zinc-600" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{s.subject}</span>
              <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">{s.ref}</span>
            </button>
          ))}
        {openStashes && stashes.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-zinc-600">No stashes.</div>
        )}
        <SectionHeader
          icon={Tag}
          label="Tags"
          count={tags.length}
          open={openTags}
          onToggle={() => setOpenTags((v) => !v)}
        />
        {openTags &&
          tags.map((t) => (
            <button
              key={t.name}
              onClick={() => onShowRef(t.name)}
              title={`${t.name} — view the tagged commit`}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-white/5"
            >
              <Tag size={11} strokeWidth={2} className="shrink-0 text-amber-400/70" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">
                {t.name}
              </span>
              <span className="shrink-0 text-[9.5px] text-zinc-600">{relativeTime(t.date)}</span>
            </button>
          ))}
        {openTags && tags.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-zinc-600">No tags.</div>
        )}
      </div>
    </div>
  )
}

/** Main pane: one commit (or stash/tag ref) — meta header + full patch. */
export function CommitDetailView({ refName }: { refName: string }) {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setDetail(null)
    let alive = true
    window.gt.gitShow(refName).then((d) => {
      if (alive) setDetail(d)
    })
    return () => {
      alive = false
    }
  }, [refName])

  if (detail === null) return <div className="p-6 text-[12px] text-zinc-600">Loading commit…</div>
  if (!detail.ok) return <div className="p-6 text-[12px] text-amber-400">{detail.error}</div>

  const stats = detail.files.reduce(
    (acc, f) => ({ ins: acc.ins + f.insertions, del: acc.del + f.deletions }),
    { ins: 0, del: 0 },
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="shrink-0 border-b border-[var(--gt-border)] px-4 py-3">
        <div className="flex items-start gap-2">
          <GitCommitHorizontal
            size={15}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-zinc-500"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-snug text-zinc-100">
              {detail.subject || '(no subject)'}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-500">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(detail.sha)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                }}
                className="inline-flex items-center gap-1 rounded border border-[var(--gt-border)] bg-black/30 px-1.5 py-px font-mono text-[10px] text-zinc-400 hover:text-zinc-200"
                title={`Copy ${detail.sha}`}
              >
                {copied ? <Check size={9} strokeWidth={2} /> : <Copy size={9} strokeWidth={2} />}
                {detail.shortSha}
              </button>
              <span>{detail.author}</span>
              <span title={new Date(detail.date).toLocaleString()}>
                {relativeTime(detail.date)}
              </span>
              <span className="font-mono text-[10.5px]">
                {detail.files.length} file{detail.files.length === 1 ? '' : 's'}
                <span className="text-emerald-400"> +{stats.ins}</span>
                <span className="text-red-400"> −{stats.del}</span>
              </span>
              {detail.refs.map(refChip)}
            </div>
            {detail.body && (
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-zinc-400">
                {detail.body}
              </pre>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {detail.patch.trim() ? (
          <>
            {detail.patchTruncated && (
              <div className="border-b border-[var(--gt-border)] px-4 py-1.5 text-[10.5px] text-amber-400">
                Patch truncated — this commit's diff exceeds the 2&nbsp;MB display cap.
              </div>
            )}
            <DiffView
              diff={detail.patch}
              scope="commit"
              iid={0}
              showViewed={false}
              allowStructural={false}
            />
          </>
        ) : (
          <div className="p-6 text-[12px] text-zinc-600">
            No textual diff for this commit{detail.files.length ? ' (binary or merge)' : ''}.
          </div>
        )}
      </div>
    </div>
  )
}
