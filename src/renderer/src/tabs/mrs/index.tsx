import { useEffect, useState } from 'react'
import { GitPullRequest, TriangleAlert, GitBranch, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '../../components/ui'
import { MrDetailView } from '../../components/MrDetail'
import { PrAgentActions } from '../../components/PrAgentActions'
import { MrMergeButton } from '../../components/MrMergeButton'
import { verdictTone, testTone, stateTone } from '../../lib/badges'
import type { Tab, Mr, TabContext } from '../../lib/types'

// Three buckets, Tickets-style. Default-collapsed groups match the "closed +
// icebox collapsed" UX of the Tickets tab.
type GroupId = 'open' | 'merged' | 'closed'
const GROUPS: { id: GroupId; label: string; match: (state: string) => boolean }[] = [
  { id: 'open', label: 'Open', match: (s) => s === 'opened' },
  { id: 'merged', label: 'Merged', match: (s) => s === 'merged' },
  { id: 'closed', label: 'Closed', match: (s) => s !== 'opened' && s !== 'merged' },
]
const DEFAULT_COLLAPSED: GroupId[] = ['merged', 'closed']

function MrRow({
  m,
  sym,
  onOpen,
  onMerged,
}: {
  m: Mr
  sym: string
  onOpen: (iid: number) => void
  onMerged: () => void
}) {
  return (
    <div
      onClick={() => onOpen(m.iid)}
      className="cursor-pointer rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 transition-colors hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
    >
      <div className="flex items-start gap-2">
        <span className="font-mono text-[12px] text-zinc-500">{sym}{m.iid}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-zinc-100">
            {m.draft && <span className="mr-1 text-amber-400">[draft]</span>}
            {m.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
            <Badge tone={stateTone(m.state)}>{m.state}</Badge>
            {m.review && <Badge tone={verdictTone(m.review.verdict)}>{m.review.verdict}</Badge>}
            {m.review && <Badge tone={testTone(m.review.testStatus)}>tests {m.review.testStatus}</Badge>}
            {m.review?.overall != null && <span className="text-zinc-400">score {m.review.overall}</span>}
            {m.review?.stale && (
              <Badge tone="warn">
                <TriangleAlert size={9} strokeWidth={2.5} />
                stale
              </Badge>
            )}
            <span className="inline-flex items-center gap-0.5 text-zinc-600">
              <GitBranch size={11} strokeWidth={2} />
              {m.sourceBranch}
            </span>
            {m.author && <span className="text-zinc-600">· @{m.author}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <PrAgentActions pr={m} sym={sym} />
          {m.state === 'opened' && <MrMergeButton iid={m.iid} sym={sym} onMerged={onMerged} />}
          <button
            onClick={() => window.gt.openExternal(m.webUrl)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
          >
            open
            <ArrowUpRight size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}

function GroupedMrList({
  mrs,
  error,
  label,
  sym,
  cli,
  collapsed,
  onToggle,
  onOpen,
  onMerged,
}: {
  mrs: Mr[] | null
  error?: string
  label: string
  sym: string
  cli: string
  collapsed: Set<GroupId>
  onToggle: (id: GroupId) => void
  onOpen: (iid: number) => void
  onMerged: () => void
}) {
  if (mrs === null) return <div className="p-6 text-[12px] text-zinc-600">Loading {label}s from {cli}…</div>
  if (error)
    return (
      <div className="p-6 text-[12px] text-amber-400">
        {error}.
        <span className="mt-1 block text-zinc-600">
          {label}s come from <span className="font-mono">{cli}</span> — check it's installed and{' '}
          <span className="font-mono">{cli} auth status</span> is logged in for this host.
        </span>
      </div>
    )
  if (mrs.length === 0)
    return <div className="p-6 text-[12px] text-zinc-600">No {label}s for this repo.</div>

  const groups = GROUPS.map((g) => ({ ...g, items: mrs.filter((m) => g.match(m.state)) })).filter(
    (g) => g.items.length > 0,
  )

  return (
    <div className="space-y-4 p-4">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.id)
        return (
          <div key={g.id}>
            <button
              onClick={() => onToggle(g.id)}
              className="mb-1.5 flex w-full items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 hover:text-zinc-300"
            >
              {isCollapsed ? <ChevronRight size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
              {g.label}
              <span className="text-zinc-700">·</span>
              <span className="tabular-nums text-zinc-600">{g.items.length}</span>
            </button>
            {!isCollapsed && (
              <div className="space-y-2">
                {g.items.map((m) => (
                  <MrRow key={m.iid} m={m} sym={sym} onOpen={onOpen} onMerged={onMerged} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MrsTab({ ctx }: { ctx: TabContext }) {
  const [mrs, setMrs] = useState<Mr[] | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [selectedMrIid, setSelectedMrIid] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<GroupId>>(() => new Set(DEFAULT_COLLAPSED))

  const hasRemote = !!ctx.repoPath
  const label = ctx.forgeLabel
  const sym = ctx.forgeSym
  const cli = ctx.forgeKind === 'github' ? 'gh' : 'glab'
  const fullName = label === 'PR' ? 'Pull Requests' : 'Merge Requests'
  const openCount = mrs ? mrs.filter((m) => m.state === 'opened').length : 0
  const toggleGroup = (id: GroupId) =>
    setCollapsed((c) => {
      const n = new Set(c)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const refresh = () =>
    window.gt.listMrs().then((r) => {
      setMrs(r.mrs)
      setError(r.error)
    })
  useEffect(() => {
    setMrs(null)
    setError(undefined)
    setSelectedMrIid(null)
    if (!hasRemote) {
      setMrs([]) // no forge remote → nothing to fetch (e.g. a local-only repo)
      return
    }
    refresh()
  }, [ctx.sessionId, ctx.repoPath]) // eslint-disable-line react-hooks/exhaustive-deps

  if (selectedMrIid !== null)
    return (
      <MrDetailView
        iid={selectedMrIid}
        repoLabel={ctx.repoPath || 'repo'}
        label={label}
        sym={sym}
        onBack={() => setSelectedMrIid(null)}
        onMerged={() => {
          setSelectedMrIid(null)
          refresh()
        }}
      />
    )

  return (
    <div className="flex h-full flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <GitPullRequest size={14} strokeWidth={2} className="text-zinc-400" />
        <span className="text-[12px] font-semibold text-zinc-200">{fullName}</span>
        <span className="text-[11px] text-zinc-600">{ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}</span>
        {hasRemote && mrs && (
          <span className="ml-auto text-[11px] text-zinc-500">
            <span className="tabular-nums text-zinc-300">{openCount}</span> open · {mrs.length} total
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasRemote ? (
          <div className="p-6 text-[12px] leading-relaxed text-zinc-600">
            This repo has no forge remote — MRs come from a GitLab/GitHub{' '}
            <span className="font-mono">origin</span>. Local-only repos (like this one) have none.
          </div>
        ) : (
          <GroupedMrList
            mrs={mrs}
            error={error}
            label={label}
            sym={sym}
            cli={cli}
            collapsed={collapsed}
            onToggle={toggleGroup}
            onOpen={setSelectedMrIid}
            onMerged={refresh}
          />
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'mrs',
  title: 'MRs',
  icon: GitPullRequest,
  order: 2,
  // Always available for a git repo; shows a "no forge remote" state when the
  // repo is local-only (glab needs an origin remote to list MRs).
  appliesTo: (ctx) => !!ctx.repoRoot,
  Component: MrsTab,
}
export default tab
