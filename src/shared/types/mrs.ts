export type CiJob = { id: number; name: string; stage: string; status: string; webUrl: string }

export type CiInfo = { status: string; webUrl: string; jobs: CiJob[] }

export type Finding = {
  id?: string
  severity?: string
  title?: string
  text?: string
  body?: string
  file?: string
  line?: number
  status?: string
  agent_fix_prompt?: string
  category?: string
} & Record<string, unknown>

export type MrDetail = {
  iid: number
  title: string
  description: string
  state: string
  author: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  draft: boolean
  reviewMd: string
  reviewMeta: Review | null
  findings: Finding[]
  suggestions: Finding[]
  /** Reviewer-captured screenshots (empty for the common non-visual review). */
  screenshots: Screenshot[]
  artifactShortSha: string
  headShort: string
}

export type Mr = {
  iid: number
  title: string
  state: string
  author: string
  webUrl: string
  sourceBranch: string
  draft: boolean
  review: Review | null
  labels: string[]
  /** Model(s) that wrote this MR, cross-referenced from the linked ticket's worked_by. */
  workedBy: string[]
}

// `error` distinguishes a genuinely-empty list from a CLI failure, so the UI
// can show an accurate empty state instead of a misleading "not authenticated".
export type MrListResult = { mrs: Mr[]; error?: string }

export type DigestDecision = {
  id: string
  title: string
  category: string
  files: string[]
  what: string | null
  why: string | null
  alternatives: string | null
  reversibility: 'low' | 'medium' | 'high'
}

export type DigestChunk = {
  id: string
  file: string
  old_path: string | null
  kind: string
  risk: 'green' | 'yellow' | 'red'
  risk_reason: string
  status: string
  added: number
  deleted: number
  green_label: string | null
  summary: string | null
  note: string | null
  confidence: string | null
  decision_signals: string[]
  hunks: {
    header: string
    old_start: number
    new_start: number
    mechanical: boolean
    label: string
  }[]
}

export type DigestArtifact = {
  pr: string | null
  short_sha: string | null
  generated: string
  generator: string
  joint: { member_mrs: string[] } | false
  brief: string | null
  blast_radius: string | null
  diagrams: { title: string; kind: string; mermaid: string }[]
  double_check: { file: string; why: string }[]
  decisions: DigestDecision[]
  stats: {
    files: number
    chunks: number
    green: number
    yellow: number
    red: number
    llm_chunks: number
    added: number
    deleted: number
    decisions?: number
  }
  chunks: DigestChunk[]
}

export type Review = {
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
  /** Canonical change blast-radius, 0-5, graded by the reviewer
   *  (artifact frontmatter `risk_score:`). null when the artifact predates
   *  the field or is tests-only. */
  riskScore: number | null
  /** Cross-PR triage classification — high/medium/low/unscored.
   *  Derived from `riskScore` (0-1 low, 2-3 medium, 4-5 high) when present;
   *  otherwise falls back to the legacy frontmatter `risk_tier:` field that
   *  bin/compute-verdict writes deterministically post-codex. */
  riskTier: 'high' | 'medium' | 'low' | 'unscored'
}

/** One reviewer-captured screenshot. Optional per review — the reviewer only
 *  records these when a visual/UX change makes an image materially help the
 *  reviewer or the human merger decide. Image bytes are embedded as a data URL
 *  so the renderer never needs filesystem access. */
export type Screenshot = {
  id: string
  caption: string
  /** before | after | diff | state — the role of this frame, when given. */
  kind?: 'before' | 'after' | 'diff' | 'state'
  /** Optional findings.json id this screenshot backs. */
  findingId?: string
  dataUrl: string
}

export type TddInfo = {
  ok: boolean
  repo: string
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
  ts: number
}

/** The `stack` field on a GitHub pull request object. Field names and shape are
 *  taken verbatim from the REST pulls docs — see the ticket's verified spec. */
export type PrStack = {
  base: { ref: string; sha: string }
  size: number
  position: number
  id: number
  number: number
}

/** A resolved stack: its layers in bottom-to-top order. This — NOT `PrStack`
 *  above — is what `gt.mrs.stacks` returns; the renderer has historically
 *  called it `PrStack` (see the alias in lib/types.ts), which is why the two
 *  shapes drifted apart unnoticed. */
export type Stack = {
  id: number
  size: number
  /** Base branch the whole stack lands on. */
  baseRef: string
  layers: { iid: number; position: number }[]
}

export type DigestRunState = {
  iid: number
  short: string
  status: DigestRunStatus
  startedAt: number
  endedAt?: number
  error?: string
}

export type DigestRunStatus = 'running' | 'done' | 'failed'
