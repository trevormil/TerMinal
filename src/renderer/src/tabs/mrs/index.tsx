import { useEffect, useState } from 'react'
import { GitPullRequest, TriangleAlert, GitBranch, ArrowUpRight, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'

// project-template convention: agents tag their docs/ticket/report PRs with
// this label so they're visually distinguishable from PRs that touch code.
const AUTO_MERGEABLE_LABEL = 'auto-mergeable'
import { Badge } from '../../components/ui'
import { MrDetailView } from '../../components/MrDetail'
import { PrAgentActions } from '../../components/PrAgentActions'
import { MrMergeButton } from '../../components/MrMergeButton'
import { verdictTone, testTone, stateTone } from '../../lib/badges'
import type { Tab, Mr, TabContext } from '../../lib/types'

// Three buckets, Tickets-style. Default-collapsed groups match the "closed +
// icebox collapsed" UX of the Tickets tab. Each group's header reuses
// stateTone (yellow / green / red) for the colored Badge to match Tickets.
type GroupId = 'open' | 'merged' | 'closed'
const GROUPS: {
  id: GroupId
  label: string
  // tone-key: pick a representative state that stateTone() maps to the right color
  toneKey: string
  match: (state: string) => boolean
}[] = [
  { id: 'open', label: 'open', toneKey: 'opened', match: (s) => s === 'opened' },
  { id: 'merged', label: 'merged', toneKey: 'merged', match: (s) => s === 'merged' },
  { id: 'closed', label: 'closed', toneKey: 'closed', match: (s) => s !== 'opened' && s !== 'merged' },
]
const DEFAULT_COLLAPSED: GroupId[] = ['merged', 'closed']

// Tool → display + colored pill
const AUTHORSHIP_LABEL: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  aider: 'Aider',
  copilot: 'Copilot',
  human: 'Human',
  unknown: '?',
  mixed: 'Mixed',
}
const AUTHORSHIP_TONE: Record<string, 'green' | 'blue' | 'accent' | 'yellow' | 'mute' | 'red'> = {
  'claude-code': 'green',
  codex: 'blue',
  cursor: 'accent',
  aider: 'yellow',
  copilot: 'yellow',
  human: 'mute',
  unknown: 'mute',
  mixed: 'yellow',
}

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
  // Lazy-fetch authorship per row. ~30ms per MR via git log; cache in state so
  // it doesn't refetch every parent re-render.
  const [authorship, setAuthorship] = useState<{ dominant: string; total: number; byTool: Record<string, number> } | null>(null)
  useEffect(() => {
    let alive = true
    window.gt.mrAuthorship(m.iid).then((r) => {
      if (alive && r) setAuthorship(r)
    })
    return () => {
      alive = false
    }
  }, [m.iid])
  const subline = authorship
    ? Object.entries(authorship.byTool)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, n]) => `${AUTHORSHIP_LABEL[t] || t} ${n}`)
        .join(' · ')
    : ''

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
            {m.labels?.includes(AUTO_MERGEABLE_LABEL) && (
              <Badge tone="green">
                <Sparkles size={9} strokeWidth={2.5} className="mr-0.5" />
                auto-mergeable
              </Badge>
            )}
            {m.review && <Badge tone={verdictTone(m.review.verdict)}>{m.review.verdict}</Badge>}
            {m.review && <Badge tone={testTone(m.review.testStatus)}>tests {m.review.testStatus}</Badge>}
            {m.review?.riskTier && m.review.riskTier !== 'unscored' && (
              <Badge
                tone={
                  m.review.riskTier === 'high'
                    ? 'red'
                    : m.review.riskTier === 'medium'
                      ? 'yellow'
                      : 'green'
                }
              >
                {m.review.riskTier} risk
              </Badge>
            )}
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
            {authorship && (
              <span
                className="ml-1 inline-flex items-center gap-1"
                title={`Authorship: ${subline} (${authorship.total} commits)`}
              >
                <Badge tone={AUTHORSHIP_TONE[authorship.dominant] || 'mute'}>
                  {AUTHORSHIP_LABEL[authorship.dominant] || authorship.dominant}
                </Badge>
                <span className="font-mono text-[10px] text-zinc-600">{subline}</span>
              </span>
            )}
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

  // Sort opened MRs by risk first so high-risk reviews surface up top.
  // Other groups (closed/merged) keep their original order.
  const riskWeight = (r?: string) => (r === 'high' ? 0 : r === 'medium' ? 1 : r === 'low' ? 2 : 3)
  const groups = GROUPS.map((g) => ({
    ...g,
    items:
      g.id === 'open'
        ? [...mrs.filter((m) => g.match(m.state))].sort(
            (a, b) => riskWeight(a.review?.riskTier) - riskWeight(b.review?.riskTier),
          )
        : mrs.filter((m) => g.match(m.state)),
  })).filter((g) => g.items.length > 0)

  return (
    <div>
      {groups.map((g) => {
        const isOpen = !collapsed.has(g.id)
        return (
          <div key={g.id}>
            <button
              onClick={() => onToggle(g.id)}
              className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/60 bg-[var(--gt-bg)] px-3 py-1.5 text-left hover:bg-white/5"
            >
              {isOpen ? (
                <ChevronDown size={12} strokeWidth={2} className="text-zinc-500" />
              ) : (
                <ChevronRight size={12} strokeWidth={2} className="text-zinc-500" />
              )}
              <Badge tone={stateTone(g.toneKey)}>{g.label}</Badge>
              <span className="text-[11px] tabular-nums text-zinc-600">{g.items.length}</span>
            </button>
            {isOpen && (
              <div className="space-y-2 p-4">
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
