import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  GitCommitHorizontal,
  MessageSquare,
  ScanSearch,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/display'
import type { BadgeTone } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { ReplyBox, ReviewActions, CommentBox } from './ReviewActions'
import type {
  PrComment,
  PrConversation,
  PrMarker,
  PrReviewSubmission,
  PrReviewThread,
  PrReviewer,
} from '../../lib/types'

// The PR's conversation lineage: issue comments, review submissions, inline
// review threads (resolved ones collapsed), and cheap commit / force-push
// markers — all from one GraphQL round trip in main.

/** GitHub's SHOUTED enums are data, not labels; render them as sentence case. */
function humanState(state: string): string {
  const s = state.replace(/_/g, ' ').toLowerCase()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function toneForState(state: string): BadgeTone {
  if (state === 'APPROVED') return 'ok'
  if (state === 'CHANGES_REQUESTED') return 'bad'
  if (state === 'REQUESTED') return 'warn'
  return 'mute'
}

const toneVariant = (tone: BadgeTone): 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' =>
  tone === 'ok' || tone === 'green'
    ? 'success'
    : tone === 'warn' || tone === 'yellow'
      ? 'warning'
      : tone === 'bad' || tone === 'red'
        ? 'destructive'
        : tone === 'blue'
          ? 'info'
          : tone === 'accent'
            ? 'default'
            : 'secondary'

function fmtWhen(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Avatar({ login, avatarUrl }: { login: string; avatarUrl: string }) {
  if (!avatarUrl)
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] uppercase text-[var(--gt-text-muted)]">
        {login.slice(0, 2)}
      </span>
    )
  return (
    <img
      src={avatarUrl}
      alt=""
      width={20}
      height={20}
      className="h-5 w-5 shrink-0 rounded-full bg-white/10"
    />
  )
}

/** Who approved, who blocked, who is still owed a review. */
export function ApprovalsRow({
  reviewDecision,
  reviewers,
}: {
  reviewDecision: string
  reviewers: PrReviewer[]
}) {
  if (!reviewDecision && !reviewers.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
      {reviewDecision && (
        <Badge variant={toneVariant(toneForState(reviewDecision))}>{humanState(reviewDecision)}</Badge>
      )}
      {reviewers.map((r) => (
        <span key={`${r.login}:${r.state}`} className="inline-flex items-center gap-1.5">
          <Avatar login={r.login} avatarUrl={r.avatarUrl} />
          <span className="text-[11.5px] text-muted-foreground">{r.login}</span>
          <Badge variant={toneVariant(toneForState(r.state))}>{humanState(r.state)}</Badge>
        </span>
      ))}
    </div>
  )
}

function Body({ body }: { body: string }) {
  if (!body.trim()) return null
  return (
    <div className="mt-1">
      <Markdown className="text-[12px] text-[var(--gt-text-soft)]">{body}</Markdown>
    </div>
  )
}

function CommentCard({ c, badge }: { c: PrComment; badge?: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Avatar login={c.login} avatarUrl={c.avatarUrl} />
        <span className="text-[11.5px] font-medium text-[var(--gt-text-soft)]">{c.login}</span>
        {badge}
        <span className="ml-auto text-[10.5px] text-[var(--gt-text-faint)]">
          {fmtWhen(c.createdAt)}
        </span>
      </div>
      <Body body={c.body} />
    </div>
  )
}

function ReviewCard({ r }: { r: PrReviewSubmission }) {
  return (
    <CommentCard
      c={{ ...r, databaseId: null }}
      badge={<Badge variant={toneVariant(toneForState(r.state))}>{humanState(r.state)}</Badge>}
    />
  )
}

function ThreadCard({
  thread,
  repoRoot,
  iid,
  onDone,
}: {
  thread: PrReviewThread
  repoRoot: string
  iid: number
  onDone: () => void
}) {
  // A resolved thread is settled business — collapsed so the open ones read as
  // the actual work left.
  const [open, setOpen] = useState(!thread.resolved)
  return (
    <div className="border-b border-[var(--gt-border)]/50 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-white/5"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={2} className="text-[var(--gt-text-faint)]" />
        ) : (
          <ChevronRight size={12} strokeWidth={2} className="text-[var(--gt-text-faint)]" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--gt-text-muted)]">
          {thread.path || 'file'}
          {thread.line != null && `:${thread.line}`}
        </span>
        {thread.outdated && <Badge variant="secondary">Outdated</Badge>}
        {thread.resolved && <Badge variant="success">Resolved</Badge>}
        <span className="text-[10.5px] tabular-nums text-[var(--gt-text-faint)]">
          {thread.comments.length}
        </span>
      </button>
      {open && (
        <div className="pb-2 pl-4">
          {thread.comments.map((c) => (
            <CommentCard key={c.id} c={c} />
          ))}
          {thread.replyToId != null && (
            <div className="px-3">
              <ReplyBox
                repoRoot={repoRoot}
                iid={iid}
                replyToId={thread.replyToId}
                onDone={onDone}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MarkerRow({ m }: { m: PrMarker }) {
  const Icon = m.kind === 'force-push' ? Zap : GitCommitHorizontal
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[var(--gt-text-faint)]">
      <Icon size={11} strokeWidth={2} />
      <span>{m.actor}</span>
      <span>{m.kind === 'force-push' ? 'force-pushed' : 'committed'}</span>
      <span className="min-w-0 flex-1 truncate font-mono">{m.detail}</span>
      <span className="shrink-0">{fmtWhen(m.createdAt)}</span>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof MessageSquare
  title: string
  count: number
  children: React.ReactNode
}) {
  if (!count) return null
  return (
    <div className="border-b border-[var(--gt-border)]">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <Icon size={12} strokeWidth={2.25} className="text-[var(--gt-text-faint)]" />
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--gt-text-muted)]">
          {title}
        </span>
        <span className="text-[10.5px] tabular-nums text-[var(--gt-text-faint)]">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function ConversationPanel({ repoRoot, iid }: { repoRoot: string; iid: number }) {
  const [data, setData] = useState<PrConversation | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback((): void => {
    if (!repoRoot) return
    void window.gt.githubReview
      .conversation(repoRoot, iid)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [repoRoot, iid])

  useEffect(() => {
    setLoading(true)
    setData(null)
    reload()
  }, [reload])

  if (!repoRoot) return <Empty>Conversation needs a local repo.</Empty>
  if (loading) return <Empty>Loading conversation…</Empty>
  if (!data) return <Empty>Could not load the conversation from gh.</Empty>
  if (!data.supported) return <Empty>{data.reason}.</Empty>

  const nothing =
    !data.comments.length && !data.reviews.length && !data.threads.length && !data.markers.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ApprovalsRow reviewDecision={data.reviewDecision} reviewers={data.reviewers} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {nothing && <Empty>No conversation yet.</Empty>}
        <Section icon={ScanSearch} title="Reviews" count={data.reviews.length}>
          {data.reviews.map((r) => (
            <ReviewCard key={r.id} r={r} />
          ))}
        </Section>
        <Section icon={MessageSquare} title="Threads" count={data.threads.length}>
          {data.threads.map((t) => (
            <ThreadCard key={t.id} thread={t} repoRoot={repoRoot} iid={iid} onDone={reload} />
          ))}
        </Section>
        <Section icon={MessageSquare} title="Comments" count={data.comments.length}>
          {data.comments.map((c) => (
            <CommentCard key={c.id} c={c} />
          ))}
          <CommentBox repoRoot={repoRoot} iid={iid} onDone={reload} />
        </Section>
        <Section icon={GitCommitHorizontal} title="Lineage" count={data.markers.length}>
          {data.markers.map((m, i) => (
            <MarkerRow key={`${m.kind}:${m.oid}:${i}`} m={m} />
          ))}
        </Section>
        {nothing && <CommentBox repoRoot={repoRoot} iid={iid} onDone={reload} />}
      </div>
      <ReviewActions repoRoot={repoRoot} iid={iid} onDone={reload} />
    </div>
  )
}
