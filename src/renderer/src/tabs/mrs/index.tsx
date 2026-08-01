import { useEffect, useState, type ReactNode } from 'react'
import {
  GitPullRequest,
  TriangleAlert,
  GitBranch,
  Layers,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Check,
  X,
} from 'lucide-react'
import { onNavigate } from '../../lib/nav'

// project-template convention: agents tag their docs/ticket/report PRs with
// this label so they're visually distinguishable from PRs that touch code.
const AUTO_MERGEABLE_LABEL = 'auto-mergeable'
import { Badge } from '../../components/ui'
import { MrDetailView } from '../../components/MrDetail'
import { PrAgentActions } from '../../components/PrAgentActions'
import { MrMergeButton } from '../../components/MrMergeButton'
import { stateTone } from '../../lib/badges'
import {
  applyRiskFilters,
  countByTier,
  isListMergeReady,
  RISK_TIERS,
  sortMrs,
  type MrSort,
  type RiskTier,
} from '../../lib/mrRisk'
import { StackMap } from '../../components/StackMap'
import type { Tab, Mr, TabContext, PrStack } from '../../lib/types'

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
  { id: 'open', label: 'Open', toneKey: 'opened', match: (s) => s === 'opened' },
  { id: 'merged', label: 'Merged', toneKey: 'merged', match: (s) => s === 'merged' },
  {
    id: 'closed',
    label: 'Closed',
    toneKey: 'closed',
    match: (s) => s !== 'opened' && s !== 'merged',
  },
]
const DEFAULT_COLLAPSED: GroupId[] = ['merged', 'closed']

const scoreColor = (n: number) =>
  n >= 85 ? 'var(--gt-green)' : n >= 70 ? '#d6a84a' : 'var(--gt-red)'
const riskColor = (tier?: string) =>
  tier === 'high' ? 'var(--gt-red)' : tier === 'medium' ? '#d6a84a' : 'var(--gt-green)'
const verdictColor = (v: string) =>
  v === 'approve'
    ? 'var(--gt-green)'
    : v === 'request-changes' || v === 'blocked'
      ? 'var(--gt-red)'
      : '#a1a1aa'
const testColor = (s: string) =>
  s === 'pass' ? 'var(--gt-green)' : s === 'fail' ? 'var(--gt-red)' : '#a1a1aa'

// The two numbers a reviewer scans for, as prominent tiles.
function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="w-12 shrink-0 text-center">
      <div className="text-[18px] font-semibold leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-1 text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
    </div>
  )
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
  const r = m.review
  return (
    <div
      onClick={() => onOpen(m.iid)}
      className="cursor-pointer rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 transition-colors hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-zinc-500">
              {sym}
              {m.iid}
            </span>
            {m.draft && (
              <span className="text-[10px] uppercase tracking-wide text-amber-400">Draft</span>
            )}
            <span className="truncate text-[13px] text-zinc-100">{m.title}</span>
            {m.labels?.includes(AUTO_MERGEABLE_LABEL) && (
              <Sparkles
                size={12}
                strokeWidth={2.5}
                className="shrink-0 text-[var(--gt-green)]"
                aria-label="Auto-mergeable"
              />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-zinc-600">
            {r ? (
              <span className="font-medium" style={{ color: verdictColor(r.verdict) }}>
                {r.verdict}
              </span>
            ) : (
              <span>Not reviewed</span>
            )}
            {r && (
              <span
                className="inline-flex items-center gap-1"
                style={{ color: testColor(r.testStatus) }}
              >
                {r.testStatus === 'pass' ? (
                  <Check size={11} strokeWidth={2.5} />
                ) : r.testStatus === 'fail' ? (
                  <X size={11} strokeWidth={2.5} />
                ) : null}
                tests {r.testStatus}
              </span>
            )}
            {r?.stale && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <TriangleAlert size={10} strokeWidth={2.5} />
                Stale
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <GitBranch size={11} strokeWidth={2} />
              {m.sourceBranch}
            </span>
            {m.author && <span>@{m.author}</span>}
            {m.workedBy.length > 0 && (
              <span
                className="inline-flex items-center gap-1 text-zinc-500"
                title="Model(s) that wrote this MR"
              >
                ✍ {m.workedBy.join(', ')}
              </span>
            )}
          </div>
        </div>
        {r && (
          <div className="flex shrink-0 items-center gap-1">
            {r.overall != null && (
              <Stat value={String(r.overall)} label="score" color={scoreColor(r.overall)} />
            )}
            {r.riskTier && r.riskTier !== 'unscored' && (
              <Stat
                value={r.riskScore != null ? `${r.riskScore}/5` : r.riskTier}
                label="risk"
                color={riskColor(r.riskTier)}
              />
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <PrAgentActions pr={m} sym={sym} />
          {m.state === 'opened' && <MrMergeButton iid={m.iid} sym={sym} onMerged={onMerged} />}
          <button
            onClick={() => window.gt.openExternal(m.webUrl)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
          >
            Open
            <ArrowUpRight size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the open queue with native stacks kept together.
 *
 * A stacked PR belongs to exactly one stack, so each stack is emitted once — at
 * the position of its highest-ranked member under the active sort — with its
 * layers bottom-to-top inside a bordered group. Unstacked PRs render exactly as
 * before, which is also what every PR does when the preview has not rolled out.
 */
function renderOpenItems(
  items: Mr[],
  {
    stacks,
    sym,
    mrByIid,
    onOpen,
    onMerged,
  }: {
    stacks: PrStack[]
    sym: string
    mrByIid: Map<number, Mr>
    onOpen: (iid: number) => void
    onMerged: () => void
  },
) {
  const stackOf = new Map<number, PrStack>()
  for (const st of stacks) for (const l of st.layers) stackOf.set(l.iid, st)

  const out: ReactNode[] = []
  const emitted = new Set<number>()
  for (const m of items) {
    const st = stackOf.get(m.iid)
    if (!st) {
      out.push(<MrRow key={m.iid} m={m} sym={sym} onOpen={onOpen} onMerged={onMerged} />)
      continue
    }
    if (emitted.has(st.id)) continue
    emitted.add(st.id)
    // Bottom-to-top: the layer that lands on the base branch first is listed
    // first, which is the order you have to merge them in.
    const layers = [...st.layers].sort((a, b) => a.position - b.position)
    out.push(
      <div
        key={`stack-${st.id}`}
        className="rounded-xl border border-[var(--gt-accent)]/30 bg-[var(--gt-accent)]/[0.04] p-2"
      >
        <div className="mb-1.5 flex items-center gap-1.5 px-1">
          <Layers size={12} strokeWidth={2.2} className="text-[var(--gt-accent-light)]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
            Stack
          </span>
          <span className="text-[10.5px] tabular-nums text-zinc-600">
            {st.size} {st.size === 1 ? 'PR' : 'PRs'} → {st.baseRef}
          </span>
        </div>
        <div className="space-y-2">
          {layers.map((l) => {
            const layerMr = mrByIid.get(l.iid)
            if (!layerMr)
              return (
                <div
                  key={l.iid}
                  className="px-3 py-1.5 text-[11px] text-zinc-600"
                  title="This layer is not in the current list (closed, or filtered out)."
                >
                  {l.position}/{st.size} · {sym}
                  {l.iid} — not shown
                </div>
              )
            return (
              <div key={l.iid} className="flex items-start gap-2">
                <span className="mt-4 w-8 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">
                  {l.position}/{st.size}
                </span>
                <div className="min-w-0 flex-1">
                  <MrRow m={layerMr} sym={sym} onOpen={onOpen} onMerged={onMerged} />
                </div>
              </div>
            )
          })}
        </div>
      </div>,
    )
  }
  return out
}

function GroupedMrList({
  mrs,
  error,
  label,
  sym,
  cli,
  stacks,
  sort,
  tiers,
  readyOnly,
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
  stacks: PrStack[]
  sort: MrSort
  tiers: Set<RiskTier>
  readyOnly: boolean
  collapsed: Set<GroupId>
  onToggle: (id: GroupId) => void
  onOpen: (iid: number) => void
  onMerged: () => void
}) {
  if (mrs === null)
    return (
      <div className="p-6 text-[12px] text-zinc-600">
        Loading {label}s from {cli}…
      </div>
    )
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

  // Built from the full list only for the stack MAP (which legitimately shows
  // layers outside the current filter). The open-queue grouping uses a map of
  // the filtered open items instead — see renderOpenItems — so a merged PR can
  // never surface in the Open group with a live merge button.
  const mrByIid = new Map(mrs.map((m) => [m.iid, m]))
  // The open group is the review queue: it obeys the chips and the sort control
  // (risk-first by default). Merged/closed keep their original order — triage
  // filters make no sense once the decision has been made.
  const groups = GROUPS.map((g) => ({
    ...g,
    items:
      g.id === 'open'
        ? sortMrs(
            applyRiskFilters(
              mrs.filter((m) => g.match(m.state)),
              { tiers, readyOnly },
            ),
            sort,
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
                {g.id === 'open'
                  ? renderOpenItems(g.items, {
                      stacks,
                      sym,
                      mrByIid: new Map(g.items.map((m) => [m.iid, m])),
                      onOpen,
                      onMerged,
                    })
                  : g.items.map((m) => (
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
  const [tiers, setTiers] = useState<Set<RiskTier>>(() => new Set())
  const [readyOnly, setReadyOnly] = useState(false)
  const [sort, setSort] = useState<MrSort>('risk')
  // GitHub native stacks (preview). Absent everywhere it hasn't rolled out, in
  // which case this stays empty and the list renders exactly as before.
  const [stacks, setStacks] = useState<PrStack[]>([])
  // `gh stack merge` needs the official extension. Probe once so we never offer
  // a cascade the CLI cannot perform — otherwise the user finds out two clicks
  // past a confirm, with a raw "unknown command" in the error slot.
  const [canMergeStacks, setCanMergeStacks] = useState(false)

  const hasRemote = !!ctx.repoPath
  const label = ctx.forgeLabel
  const sym = ctx.forgeSym
  const cli = ctx.forgeKind === 'github' ? 'gh' : 'glab'
  const fullName = label === 'PR' ? 'Pull Requests' : 'Merge Requests'
  const openMrs = mrs ? mrs.filter((m) => m.state === 'opened') : []
  const openCount = openMrs.length
  const tierCounts = countByTier(openMrs)
  const readyCount = openMrs.filter(isListMergeReady).length
  const toggleTier = (t: RiskTier) =>
    setTiers((cur) => {
      const next = new Set(cur)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  const toggleGroup = (id: GroupId) =>
    setCollapsed((c) => {
      const n = new Set(c)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const refresh = () => {
    // Stacks are best-effort and strictly additive: any failure (old gh, preview
    // not rolled out, not authenticated) leaves the list untouched.
    window.gt.stacks
      .list(ctx.repoRoot, ctx.repoPath)
      .then((r) => setStacks(r.stacks || []))
      .catch(() => setStacks([]))
    window.gt.stacks
      .extension(ctx.repoRoot)
      .then(setCanMergeStacks)
      .catch(() => setCanMergeStacks(false))
    return window.gt.listMrs().then((r) => {
      setMrs(r.mrs)
      setError(r.error)
    })
  }
  useEffect(() => {
    setMrs(null)
    setError(undefined)
    setSelectedMrIid(null)
    setStacks([])
    setCanMergeStacks(false)
    if (!hasRemote) {
      setMrs([]) // no forge remote → nothing to fetch (e.g. a local-only repo)
      return
    }
    refresh()
  }, [ctx.sessionId, ctx.repoPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-tab nav: navigateTo('mrs', { iid }) opens straight to that MR/PR
  // (e.g. from the command palette).
  useEffect(
    () =>
      onNavigate((ev) => {
        if (ev.tabId !== 'mrs') return
        const iid = Number(ev.payload?.iid)
        if (Number.isFinite(iid) && iid > 0) setSelectedMrIid(iid)
      }),
    [],
  )

  if (selectedMrIid !== null)
    return (
      <MrDetailView
        iid={selectedMrIid}
        repoLabel={ctx.repoPath || 'repo'}
        repoRoot={ctx.repoRoot}
        stacks={stacks}
        canMergeStacks={canMergeStacks}
        mrs={mrs || []}
        onOpenMr={setSelectedMrIid}
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
        <span className="text-[11px] text-zinc-600">
          {ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}
        </span>
        {hasRemote && mrs && (
          <span className="ml-auto text-[11px] text-zinc-500">
            <span className="tabular-nums text-zinc-300">{openCount}</span> open · {mrs.length}{' '}
            total
          </span>
        )}
      </div>
      {hasRemote && openCount > 0 && (
        <div className="flex h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 px-4">
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-700">
            Risk
          </span>
          {RISK_TIERS.map((t) => {
            const on = tiers.has(t)
            const n = tierCounts[t]
            return (
              <button
                key={t}
                onClick={() => toggleTier(t)}
                disabled={n === 0 && !on}
                className={`h-6 rounded-md border px-1.5 text-[10.5px] font-semibold capitalize disabled:opacity-30 ${
                  on
                    ? 'border-transparent text-zinc-950'
                    : 'border-[var(--gt-border)] bg-black/25 text-zinc-400 hover:text-zinc-200'
                }`}
                style={on ? { background: riskColor(t) } : undefined}
              >
                {t}
                <span className={on ? 'ml-1 opacity-70' : 'ml-1 text-zinc-600'}>{n}</span>
              </button>
            )
          })}
          <button
            onClick={() => setReadyOnly((v) => !v)}
            title="Only PRs that clear the verdict and test axes of the merge bar. Findings are only loaded in the detail view — each row's badge says whether they were checked."
            className={`h-6 rounded-md border px-1.5 text-[10.5px] font-semibold ${
              readyOnly
                ? 'border-[var(--gt-green)]/60 bg-[var(--gt-green)]/20 text-[var(--gt-green)]'
                : 'border-[var(--gt-border)] bg-black/25 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Merge-ready
            <span className="ml-1 text-zinc-600">{readyCount}</span>
          </button>
          {(tiers.size > 0 || readyOnly) && (
            <button
              onClick={() => {
                setTiers(new Set())
                setReadyOnly(false)
              }}
              className="h-6 rounded-md border border-[var(--gt-border)] px-1.5 text-[10.5px] font-semibold text-zinc-500 hover:text-zinc-200"
            >
              Clear
            </button>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as MrSort)}
            className="ml-auto h-6 rounded-md border border-[var(--gt-border)] bg-black/25 px-1.5 text-[10.5px] font-semibold text-zinc-400 outline-none"
          >
            <option value="risk">Sort: risk first</option>
            <option value="number">Sort: newest</option>
          </select>
        </div>
      )}
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
            stacks={stacks}
            sort={sort}
            tiers={tiers}
            readyOnly={readyOnly}
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
