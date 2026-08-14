// GitHub-native PR review surface: CI checks, conversation lineage, review
// actions, approvals.
//
// GitHub-first by construction. Every entry point returns a discriminated
// `supported` flag rather than throwing or returning an empty shape, so a
// GitLab (or remote/local-only) workspace renders one quiet "GitHub-only for
// now" line instead of an empty panel that looks like a fetch failure.

/** The forge is not GitHub (or the repo has no GitHub remote). */
export type GithubUnsupported = { supported: false; reason: string }

/** One CI check on the PR head — a GitHub check run or a legacy commit status. */
export type PrCheckRun = {
  /** Stable within one fetch; check-run id, or `status:<context>`. */
  id: string
  name: string
  /** queued | in_progress | completed | pending */
  status: string
  /** success | failure | neutral | cancelled | timed_out | action_required | skipped | stale | '' */
  conclusion: string
  startedAt: string
  completedAt: string
  /** Wall time, when both timestamps are present. */
  durationMs: number | null
  detailsUrl: string
  source: 'check-run' | 'status'
}

/** Roll-up counts for the list-row chip. */
export type PrChecksSummary = {
  passed: number
  failed: number
  pending: number
  /** Skipped / neutral / cancelled — counted but not alarming. */
  other: number
  total: number
  /** failed > pending > success > none. */
  state: 'failed' | 'pending' | 'success' | 'none'
}

export type PrChecks =
  { supported: true; sha: string; runs: PrCheckRun[]; summary: PrChecksSummary } | GithubUnsupported

/** Checks roll-up for every PR in the list, from one `gh pr list` call. */
export type PrChecksSummaries =
  { supported: true; byIid: Record<number, PrChecksSummary> } | GithubUnsupported

export type PrActor = { login: string; avatarUrl: string }

/** A reviewer's current standing on the PR. */
export type PrReviewer = PrActor & {
  /** APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | REQUESTED */
  state: string
}

export type PrComment = PrActor & {
  id: string
  /** REST id — needed to reply in-thread. Null when GitHub omits it. */
  databaseId: number | null
  body: string
  createdAt: string
  url: string
}

/** A review submission (approve / request changes / comment). */
export type PrReviewSubmission = PrActor & {
  id: string
  /** APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING */
  state: string
  body: string
  createdAt: string
  url: string
}

/** An inline review thread, anchored to a file and line. */
export type PrReviewThread = {
  id: string
  path: string
  line: number | null
  /** LEFT | RIGHT */
  diffSide: string
  resolved: boolean
  outdated: boolean
  comments: PrComment[]
  /** databaseId of the thread's first comment — the `in_reply_to` target. */
  replyToId: number | null
}

/** A cheap lineage marker: a commit landed, or the branch was force-pushed. */
export type PrMarker = {
  kind: 'commit' | 'force-push'
  actor: string
  createdAt: string
  /** Commit headline, or `<before> → <after>` for a force-push. */
  detail: string
  oid: string
}

export type PrConversation =
  | {
      supported: true
      /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' */
      reviewDecision: string
      reviewers: PrReviewer[]
      comments: PrComment[]
      reviews: PrReviewSubmission[]
      threads: PrReviewThread[]
      markers: PrMarker[]
    }
  | GithubUnsupported

/** The three things a human can submit from the review box. */
export type PrReviewEvent = 'approve' | 'request-changes' | 'comment'

export type PrActionResult = { ok: true } | { ok: false; error: string }
