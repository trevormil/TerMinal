// GitHub-native PR review surface: CI checks, conversation lineage, review
// actions, approvals.
//
// GitHub-FIRST by construction. Every exported entry point resolves the forge
// first and returns `{ supported: false }` off GitHub, so a GitLab workspace
// gets one quiet line instead of a broken panel. GitLab parity is a bonus, not
// a requirement — nothing here degrades the existing MR behaviour.
//
// All network I/O is a `gh` subprocess from MAIN, matching forge.ts (which owns
// the `gh` seam, including the per-repo env and the test injection point). The
// split is deliberate:
//
//   - GraphQL, one round trip: the conversation. Comments, review submissions,
//     inline threads, force-push/commit markers and `reviewDecision` all hang
//     off one `pullRequest` node, and fetching them as five REST calls is five
//     times the latency for the same bytes.
//   - REST: check runs. The rollup GraphQL exposes has no timestamps, so it
//     cannot answer "how long did this take" — `commits/{sha}/check-runs` can.
//
// Shaping is pure and tested against fixture JSON; the subprocess boundary is
// injected through forge's `setForgeRunForTests`.

import { repoForCwd } from './repo'
import { forgeFor, run } from './forge'
import type {
  GithubUnsupported,
  PrActionResult,
  PrChecks,
  PrCheckRun,
  PrChecksSummaries,
  PrChecksSummary,
  PrComment,
  PrConversation,
  PrMarker,
  PrReviewEvent,
  PrReviewSubmission,
  PrReviewThread,
  PrReviewer,
} from '../shared/types/github-review'

export type * from '../shared/types/github-review'

// ── pure shaping ────────────────────────────────────────────────────────────

function parseJson<T>(text: string): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Conclusions that mean a human has to do something. */
const FAILING = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'])
/** Conclusions that are neither a pass nor a problem. */
const NEUTRAL = new Set(['skipped', 'neutral', 'stale'])

function durationOf(started: string, completed: string): number | null {
  if (!started || !completed) return null
  const a = Date.parse(started)
  const b = Date.parse(completed)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return b - a
}

/** A legacy commit status's `state` in check-run vocabulary. */
function statusStateToRun(state: string): { status: string; conclusion: string } {
  const s = state.toLowerCase()
  if (s === 'success') return { status: 'completed', conclusion: 'success' }
  if (s === 'failure' || s === 'error') return { status: 'completed', conclusion: 'failure' }
  return { status: 'in_progress', conclusion: '' }
}

/** failure first, then still-running, then everything settled. */
function rank(r: PrCheckRun): number {
  if (FAILING.has(r.conclusion)) return 0
  if (r.status !== 'completed') return 1
  return 2
}

/**
 * Merge `commits/{sha}/check-runs` and `commits/{sha}/status` into one list,
 * failures first.
 *
 * Both payloads are optional and independently fallible — a repo may have only
 * Actions, only legacy statuses, or a rate-limited call for one of them. Each
 * side degrades on its own; neither can throw.
 */
export function shapeCheckRuns(checkRunsJson: string, combinedStatusJson: string): PrCheckRun[] {
  const out: PrCheckRun[] = []

  const runs = arr(parseJson<{ check_runs?: unknown }>(checkRunsJson)?.check_runs)
  for (const raw of runs) {
    const c = raw as Record<string, unknown>
    const startedAt = str(c.started_at)
    const completedAt = str(c.completed_at)
    out.push({
      id: `check:${c.id ?? str(c.name)}`,
      name: str(c.name),
      status: str(c.status) || 'queued',
      conclusion: str(c.conclusion),
      startedAt,
      completedAt,
      durationMs: durationOf(startedAt, completedAt),
      detailsUrl: str(c.details_url) || str(c.html_url),
      source: 'check-run',
    })
  }

  const statuses = arr(parseJson<{ statuses?: unknown }>(combinedStatusJson)?.statuses)
  for (const raw of statuses) {
    const s = raw as Record<string, unknown>
    const startedAt = str(s.created_at)
    const completedAt = str(s.updated_at)
    const mapped = statusStateToRun(str(s.state))
    out.push({
      id: `status:${str(s.context)}`,
      name: str(s.context),
      ...mapped,
      startedAt,
      completedAt: mapped.status === 'completed' ? completedAt : '',
      durationMs: mapped.status === 'completed' ? durationOf(startedAt, completedAt) : null,
      detailsUrl: str(s.target_url),
      source: 'status',
    })
  }

  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function summaryOf(counts: {
  passed: number
  failed: number
  pending: number
  other: number
}): PrChecksSummary {
  const total = counts.passed + counts.failed + counts.pending + counts.other
  const state: PrChecksSummary['state'] = !total
    ? 'none'
    : counts.failed
      ? 'failed'
      : counts.pending
        ? 'pending'
        : 'success'
  return { ...counts, total, state }
}

/** Roll a shaped check list into the counts the chip renders. */
export function summarizeChecks(runs: PrCheckRun[]): PrChecksSummary {
  let passed = 0
  let failed = 0
  let pending = 0
  let other = 0
  for (const r of runs) {
    if (FAILING.has(r.conclusion)) failed++
    else if (r.status !== 'completed') pending++
    else if (r.conclusion === 'success') passed++
    else if (NEUTRAL.has(r.conclusion)) other++
    else other++
  }
  return summaryOf({ passed, failed, pending, other })
}

/**
 * Per-PR check summaries from one `gh pr list --json number,statusCheckRollup`.
 *
 * One call for the whole list instead of one per row: the list view renders
 * dozens of PRs and a per-row fetch is a rate-limit incident waiting to happen.
 * The rollup shouts its enums (`SUCCESS`), unlike REST (`success`).
 */
export function summariesFromPrList(json: string): Record<number, PrChecksSummary> {
  const items = parseJson<unknown>(json)
  if (!Array.isArray(items)) return {}
  const byIid: Record<number, PrChecksSummary> = {}
  for (const raw of items) {
    const pr = raw as Record<string, unknown>
    const iid = Number(pr.number)
    if (!Number.isFinite(iid)) continue
    let passed = 0
    let failed = 0
    let pending = 0
    let other = 0
    for (const c of arr(pr.statusCheckRollup)) {
      const node = c as Record<string, unknown>
      // A CheckRun carries status+conclusion; a StatusContext carries `state`.
      const conclusion = (str(node.conclusion) || str(node.state)).toLowerCase()
      const status = str(node.status).toLowerCase()
      if (FAILING.has(conclusion) || conclusion === 'error') failed++
      else if (!conclusion || (status && status !== 'completed')) pending++
      else if (conclusion === 'success') passed++
      else other++
    }
    byIid[iid] = summaryOf({ passed, failed, pending, other })
  }
  return byIid
}

/** The one round trip that backs the whole conversation panel. */
export const CONVERSATION_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewDecision
      reviewRequests(first:25){nodes{requestedReviewer{
        ... on User{login avatarUrl}
        ... on Team{name}
      }}}
      comments(first:100){nodes{
        id databaseId body createdAt url author{login avatarUrl}
      }}
      reviews(first:100){nodes{
        id state body createdAt url author{login avatarUrl}
      }}
      reviewThreads(first:100){nodes{
        id isResolved isOutdated path line diffSide
        comments(first:100){nodes{id databaseId body createdAt url author{login avatarUrl}}}
      }}
      timelineItems(last:60,itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT,PULL_REQUEST_COMMIT]){nodes{
        __typename
        ... on HeadRefForcePushedEvent{
          createdAt actor{login}
          beforeCommit{abbreviatedOid} afterCommit{abbreviatedOid}
        }
        ... on PullRequestCommit{commit{
          abbreviatedOid messageHeadline committedDate author{name user{login}}
        }}
      }}
    }
  }
}`

type ShapedConversation = Extract<PrConversation, { supported: true }>

function shapeComment(raw: unknown): PrComment {
  const c = raw as Record<string, unknown>
  const author = (c.author || {}) as Record<string, unknown>
  const dbId = Number(c.databaseId)
  return {
    id: str(c.id),
    databaseId: Number.isFinite(dbId) && dbId > 0 ? dbId : null,
    login: str(author.login),
    avatarUrl: str(author.avatarUrl),
    body: str(c.body),
    createdAt: str(c.createdAt),
    url: str(c.url),
  }
}

/** A submitted review has an opinion; a PENDING one is an unsent draft. */
const SUBMITTED = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'])

function shapeReviewers(pr: Record<string, unknown>, reviews: PrReviewSubmission[]): PrReviewer[] {
  // Latest submitted opinion per author wins: a reviewer who commented and then
  // requested changes stands at CHANGES_REQUESTED, and rendering the earlier
  // COMMENTED next to it would misreport the gate.
  const latest = new Map<string, PrReviewer>()
  for (const r of reviews) {
    if (!r.login || !SUBMITTED.has(r.state)) continue
    latest.set(r.login, { login: r.login, avatarUrl: r.avatarUrl, state: r.state })
  }
  const out = [...latest.values()]
  for (const raw of arr((pr.reviewRequests as Record<string, unknown>)?.nodes)) {
    const rr = (raw as Record<string, unknown>)?.requestedReviewer as Record<string, unknown> | null
    if (!rr) continue
    // A Team has `name`, not `login`. Without this a requested team renders as
    // an empty avatar row that looks like a data bug.
    const login = str(rr.login) || str(rr.name)
    if (!login || latest.has(login)) continue
    out.push({ login, avatarUrl: str(rr.avatarUrl), state: 'REQUESTED' })
  }
  return out
}

function shapeMarkers(pr: Record<string, unknown>): PrMarker[] {
  const out: PrMarker[] = []
  for (const raw of arr((pr.timelineItems as Record<string, unknown>)?.nodes)) {
    const n = raw as Record<string, unknown>
    if (n.__typename === 'PullRequestCommit') {
      const commit = (n.commit || {}) as Record<string, unknown>
      const author = (commit.author || {}) as Record<string, unknown>
      const user = (author.user || {}) as Record<string, unknown>
      out.push({
        kind: 'commit',
        actor: str(user.login) || str(author.name),
        createdAt: str(commit.committedDate),
        detail: str(commit.messageHeadline),
        oid: str(commit.abbreviatedOid),
      })
    } else if (n.__typename === 'HeadRefForcePushedEvent') {
      const before = str((n.beforeCommit as Record<string, unknown>)?.abbreviatedOid)
      const after = str((n.afterCommit as Record<string, unknown>)?.abbreviatedOid)
      out.push({
        kind: 'force-push',
        actor: str((n.actor as Record<string, unknown>)?.login),
        createdAt: str(n.createdAt),
        detail: `${before} → ${after}`,
        oid: after,
      })
    }
  }
  return out
}

/** Shape the GraphQL response. An error payload shapes to empty, never a throw. */
export function shapeConversation(json: string): ShapedConversation {
  const empty: ShapedConversation = {
    supported: true,
    reviewDecision: '',
    reviewers: [],
    comments: [],
    reviews: [],
    threads: [],
    markers: [],
  }
  const root = parseJson<Record<string, unknown>>(json)
  const repo = (root?.data as Record<string, unknown>)?.repository as
    Record<string, unknown> | undefined
  const pr = repo?.pullRequest as Record<string, unknown> | undefined
  if (!pr) return empty

  const reviews: PrReviewSubmission[] = arr((pr.reviews as Record<string, unknown>)?.nodes)
    .map((raw) => {
      const c = shapeComment(raw)
      return {
        id: c.id,
        login: c.login,
        avatarUrl: c.avatarUrl,
        state: str((raw as Record<string, unknown>).state),
        body: c.body,
        createdAt: c.createdAt,
        url: c.url,
      }
    })
    .filter((r) => SUBMITTED.has(r.state))

  const threads: PrReviewThread[] = arr((pr.reviewThreads as Record<string, unknown>)?.nodes).map(
    (raw) => {
      const t = raw as Record<string, unknown>
      const comments = arr((t.comments as Record<string, unknown>)?.nodes).map(shapeComment)
      // `Number(null)` is 0 — an unanchored (outdated) thread would claim line 0.
      // `Number(null)` is 0 — an unanchored (outdated) thread would claim line 0.
      const line = typeof t.line === 'number' && Number.isFinite(t.line) ? t.line : null
      return {
        id: str(t.id),
        path: str(t.path),
        line,
        diffSide: str(t.diffSide),
        resolved: !!t.isResolved,
        outdated: !!t.isOutdated,
        comments,
        replyToId: comments[0]?.databaseId ?? null,
      }
    },
  )

  return {
    supported: true,
    reviewDecision: str(pr.reviewDecision),
    reviewers: shapeReviewers(pr, reviews),
    comments: arr((pr.comments as Record<string, unknown>)?.nodes).map(shapeComment),
    reviews,
    threads,
    markers: shapeMarkers(pr),
  }
}

/**
 * `gh pr review` argv for one submission.
 *
 * The body is a separate argv entry, never interpolated: a review body starting
 * with `--` is prose, and folding it into `--body=<text>` would hand the CLI a
 * flag the reviewer typed by accident.
 */
export function reviewCliArgs(iid: number, event: PrReviewEvent, body: string): string[] {
  const flag =
    event === 'approve'
      ? '--approve'
      : event === 'request-changes'
        ? '--request-changes'
        : '--comment'
  const args = ['pr', 'review', String(iid), flag]
  // gh rejects an empty --body; a bodyless approve is the common case.
  if (body.trim()) args.push('--body', body)
  return args
}

// ── gh boundary ─────────────────────────────────────────────────────────────

/** owner/name for a GitHub repo, or null when this workspace is not one. */
function githubRepoPath(repoRoot: string): string | null {
  if (!repoRoot) return null
  if (forgeFor(repoRoot).kind !== 'github') return null
  const path = repoForCwd(repoRoot)?.path || ''
  return /^[^/]+\/[^/]+$/.test(path) ? path : null
}

const NOT_GITHUB: GithubUnsupported = {
  supported: false,
  reason: 'GitHub-only for now',
}

/** Whether the review surface applies to this workspace at all. */
export function isGithubRepo(repoRoot: string): boolean {
  return githubRepoPath(repoRoot) !== null
}

async function gh(
  repoRoot: string,
  args: string[],
  opts?: { timeout?: number; maxBuffer?: number },
): Promise<{ ok: boolean; stdout: string; error: string }> {
  const r = await run('gh', args, repoRoot, { maxBuffer: 8 * 1024 * 1024, ...opts })
  if (r.err && !r.stdout)
    return { ok: false, stdout: '', error: (r.stderr || r.err.message || 'gh failed').trim() }
  return { ok: true, stdout: r.stdout, error: '' }
}

/** Head sha of the PR — the ref every check hangs off. */
async function headSha(repoRoot: string, iid: number): Promise<string> {
  const r = await gh(repoRoot, ['pr', 'view', String(iid), '--json', 'headRefOid'])
  return str(parseJson<{ headRefOid?: unknown }>(r.stdout)?.headRefOid)
}

/** Full check list for a PR head, failures first. */
export async function prChecks(repoRoot: string, iid: number): Promise<PrChecks> {
  const path = githubRepoPath(repoRoot)
  if (!path) return NOT_GITHUB
  const sha = await headSha(repoRoot, iid)
  if (!sha) return { supported: true, sha: '', runs: [], summary: summarizeChecks([]) }
  const [runs, statuses] = await Promise.all([
    gh(repoRoot, ['api', `repos/${path}/commits/${sha}/check-runs?per_page=100`]),
    gh(repoRoot, ['api', `repos/${path}/commits/${sha}/status?per_page=100`]),
  ])
  const shaped = shapeCheckRuns(runs.stdout, statuses.stdout)
  return { supported: true, sha, runs: shaped, summary: summarizeChecks(shaped) }
}

/** Checks roll-up for every PR in the repo, in one call. */
export async function prChecksSummaries(repoRoot: string): Promise<PrChecksSummaries> {
  if (!githubRepoPath(repoRoot)) return NOT_GITHUB
  const r = await gh(repoRoot, [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    '100',
    '--json',
    'number,statusCheckRollup',
  ])
  return { supported: true, byIid: summariesFromPrList(r.stdout) }
}

/** Timeline, threads, approvals — one GraphQL round trip. */
export async function prConversation(repoRoot: string, iid: number): Promise<PrConversation> {
  const path = githubRepoPath(repoRoot)
  if (!path) return NOT_GITHUB
  const [owner, name] = path.split('/')
  const r = await gh(
    repoRoot,
    [
      'api',
      'graphql',
      '-f',
      `query=${CONVERSATION_QUERY}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
      '-F',
      `number=${iid}`,
    ],
    { timeout: 20_000 },
  )
  return shapeConversation(r.stdout)
}

// ── write actions (user-initiated only) ─────────────────────────────────────
// Nothing below runs on a timer, on load, or from an agent. Each is reached
// only by a click in the review box, which is what keeps the app from ever
// approving its own work.

export async function submitReview(
  repoRoot: string,
  iid: number,
  event: PrReviewEvent,
  body: string,
): Promise<PrActionResult> {
  if (!githubRepoPath(repoRoot)) return { ok: false, error: NOT_GITHUB.reason }
  if (event !== 'approve' && !body.trim())
    return { ok: false, error: 'A comment or change request needs a body.' }
  const r = await gh(repoRoot, reviewCliArgs(iid, event, body), { timeout: 30_000 })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export async function addComment(
  repoRoot: string,
  iid: number,
  body: string,
): Promise<PrActionResult> {
  if (!githubRepoPath(repoRoot)) return { ok: false, error: NOT_GITHUB.reason }
  if (!body.trim()) return { ok: false, error: 'A comment needs a body.' }
  const r = await gh(repoRoot, ['pr', 'comment', String(iid), '--body', body], { timeout: 30_000 })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/**
 * Reply inside an existing inline review thread.
 *
 * REST rather than GraphQL: `POST pulls/{n}/comments` with `in_reply_to` is the
 * only spelling that lands the reply in the same thread — a fresh review
 * comment at the same path/line starts a second thread beside it.
 */
export async function replyToThread(
  repoRoot: string,
  iid: number,
  replyToId: number,
  body: string,
): Promise<PrActionResult> {
  const path = githubRepoPath(repoRoot)
  if (!path) return { ok: false, error: NOT_GITHUB.reason }
  if (!body.trim()) return { ok: false, error: 'A reply needs a body.' }
  if (!Number.isFinite(replyToId) || replyToId <= 0)
    return { ok: false, error: 'This thread has no comment to reply to.' }
  const r = await gh(
    repoRoot,
    [
      'api',
      '--method',
      'POST',
      `repos/${path}/pulls/${iid}/comments`,
      '-f',
      `body=${body}`,
      '-F',
      `in_reply_to=${replyToId}`,
    ],
    { timeout: 30_000 },
  )
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
