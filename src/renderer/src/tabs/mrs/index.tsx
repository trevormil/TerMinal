import { useEffect, useState } from 'react'
import { GitPullRequest, TriangleAlert, GitBranch, ArrowUpRight } from 'lucide-react'
import { Badge } from '../../components/ui'
import { MrDetailView } from '../../components/MrDetail'
import { PrAgentActions } from '../../components/PrAgentActions'
import { MrMergeButton } from '../../components/MrMergeButton'
import { verdictTone, testTone, stateTone } from '../../lib/badges'
import type { Tab, Mr, TabContext } from '../../lib/types'

function MrList({
  mrs,
  error,
  onOpen,
  onMerged,
}: {
  mrs: Mr[] | null
  error?: string
  onOpen: (iid: number) => void
  onMerged: () => void
}) {
  if (mrs === null) return <div className="p-6 text-[12px] text-zinc-600">Loading MRs from glab…</div>
  if (error)
    return (
      <div className="p-6 text-[12px] text-amber-400">
        {error}.
        <span className="mt-1 block text-zinc-600">
          MRs come from <span className="font-mono">glab</span> — check it's installed and{' '}
          <span className="font-mono">glab auth status</span> is logged in for this host.
        </span>
      </div>
    )
  if (mrs.length === 0)
    return <div className="p-6 text-[12px] text-zinc-600">No open MRs for this repo.</div>
  return (
    <div className="space-y-2 p-4">
      {mrs.map((m) => (
        <div
          key={m.iid}
          onClick={() => onOpen(m.iid)}
          className="cursor-pointer rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 transition-colors hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
        >
          <div className="flex items-start gap-2">
            <span className="font-mono text-[12px] text-zinc-500">!{m.iid}</span>
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
              <PrAgentActions pr={m} />
              {m.state === 'opened' && <MrMergeButton iid={m.iid} onMerged={onMerged} />}
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
      ))}
    </div>
  )
}

function MrsTab({ ctx }: { ctx: TabContext }) {
  const [mrs, setMrs] = useState<Mr[] | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [selectedMrIid, setSelectedMrIid] = useState<number | null>(null)

  const hasRemote = !!ctx.repoPath
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
        onBack={() => setSelectedMrIid(null)}
        onMerged={() => {
          setSelectedMrIid(null)
          refresh()
        }}
      />
    )

  return (
    <div className="flex h-full flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <GitPullRequest size={14} strokeWidth={2} className="text-zinc-400" />
        <span className="text-[12px] font-semibold text-zinc-200">
          Merge Requests{hasRemote && mrs ? ` (${mrs.filter((m) => m.state === 'opened').length})` : ''}
        </span>
        <span className="text-[11px] text-zinc-600">{ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasRemote ? (
          <div className="p-6 text-[12px] leading-relaxed text-zinc-600">
            This repo has no forge remote — MRs come from a GitLab/GitHub{' '}
            <span className="font-mono">origin</span>. Local-only repos (like this one) have none.
          </div>
        ) : (
          <MrList mrs={mrs} error={error} onOpen={setSelectedMrIid} onMerged={refresh} />
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'mrs',
  title: 'MRs',
  icon: GitPullRequest,
  order: 1.2,
  // Always available for a git repo; shows a "no forge remote" state when the
  // repo is local-only (glab needs an origin remote to list MRs).
  appliesTo: (ctx) => !!ctx.repoRoot,
  Component: MrsTab,
}
export default tab
