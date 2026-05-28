import { execFile } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoForCwd } from './repo'
import { emitActivity } from './events'
import {
  resolveReviewDir,
  reviewForPrDir,
  reviewBodyForPrDir,
  newestArtifactShortSha,
  readJsonSafe,
  type Review,
} from './review'

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
  artifactShortSha: string
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
}

// `error` distinguishes a genuinely-empty list from a glab failure, so the UI
// can show an accurate empty state instead of a misleading "not authenticated".
export type MrListResult = { mrs: Mr[]; error?: string }

/** Classify a glab failure into a short, accurate reason for the empty state. */
export function glabErrorReason(err: Error | null, stderr?: string): string | undefined {
  if (!err) return undefined
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'glab not found on PATH'
  const msg = `${stderr || ''} ${err.message || ''}`.toLowerCase()
  if (/401|unauthor|\bauth\b|token|not logged in|login/.test(msg))
    return 'glab not authenticated for this host'
  return (stderr || err.message || 'glab error').trim().split('\n')[0] || 'glab error'
}

// Live MRs for the repo via glab (run in the repo so it auto-detects the
// project + host), each enriched with its harness review/test verdict.
export function listMrs(repoRoot: string): Promise<MrListResult> {
  return new Promise((resolve) => {
    execFile(
      'glab',
      ['mr', 'list', '-F', 'json', '-P', '50'],
      { cwd: repoRoot, timeout: 12_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) return resolve({ mrs: [], error: glabErrorReason(err, stderr) })
        if (!stdout) return resolve({ mrs: [] })
        let arr: any[]
        try {
          arr = JSON.parse(stdout)
        } catch {
          return resolve({ mrs: [] })
        }
        if (!Array.isArray(arr)) return resolve({ mrs: [] })
        const repo = repoForCwd(repoRoot)
        const mrs = arr.map((m): Mr => {
          const iid = m.iid ?? m.IID ?? m.number
          const headShort = String(m.sha || m.diff_refs?.head_sha || '').slice(0, 7)
          const dir = repo ? resolveReviewDir(repoRoot, repo.host, repo.path, iid) : null
          return {
            iid: Number(iid),
            title: m.title || '',
            state: (m.state || '').toLowerCase(),
            author: m.author?.username || m.author?.name || '',
            webUrl: m.web_url || m.webUrl || '',
            sourceBranch: m.source_branch || m.sourceBranch || '',
            draft: !!(m.draft ?? m.work_in_progress),
            review: dir ? reviewForPrDir(dir, headShort) : null,
          }
        })
        resolve({ mrs })
      },
    )
  })
}

export type MrSummary = { open: number; approve: number; changes: number; needsReview: number }
// Cached (60s) MR counts for the cockpit widget — glab is slow to call per poll.
// Keyed per-repo so several sessions on different repos don't evict each other.
const summaryCache = new Map<string, { ts: number; mrs: Mr[] }>()
export async function mrSummary(repoRoot: string): Promise<MrSummary> {
  const now = Date.now()
  let mrs: Mr[]
  const hit = summaryCache.get(repoRoot)
  if (hit && now - hit.ts < 60_000) {
    mrs = hit.mrs
  } else {
    mrs = (await listMrs(repoRoot)).mrs
    summaryCache.set(repoRoot, { ts: now, mrs })
  }
  const opened = mrs.filter((m) => m.state === 'opened')
  const approve = opened.filter((m) => m.review?.verdict === 'approve').length
  const changes = opened.filter(
    (m) => m.review?.verdict === 'request-changes' || m.review?.verdict === 'blocked',
  ).length
  return { open: opened.length, approve, changes, needsReview: opened.length - approve - changes }
}

// Full MR detail: glab mr view + the harness review body/findings/suggestions
// for this iid.
export function getMr(repoRoot: string, iid: number): Promise<MrDetail | null> {
  return new Promise((resolve) => {
    execFile(
      'glab',
      ['mr', 'view', String(iid), '-F', 'json'],
      { cwd: repoRoot, timeout: 12_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        let m: any
        try {
          m = JSON.parse(stdout)
        } catch {
          return resolve(null)
        }
        const repo = repoForCwd(repoRoot)
        const headShort = String(m.sha || m.diff_refs?.head_sha || '').slice(0, 7)
        let reviewMd = ''
        let reviewMeta: Review | null = null
        let findings: Finding[] = []
        let suggestions: Finding[] = []
        let artifactShortSha = ''
        const dir = repo ? resolveReviewDir(repoRoot, repo.host, repo.path, iid) : null
        if (dir) {
          reviewMeta = reviewForPrDir(dir, headShort)
          reviewMd = reviewBodyForPrDir(dir)
          artifactShortSha = newestArtifactShortSha(dir)
          // stored as bare arrays or { findings: [...] } / { suggestions: [...] }
          const fRaw = readJsonSafe<any>(join(dir, 'findings.json'), [])
          findings = Array.isArray(fRaw) ? fRaw : Array.isArray(fRaw?.findings) ? fRaw.findings : []
          const sRaw = readJsonSafe<any>(join(dir, 'suggestions.json'), [])
          suggestions = Array.isArray(sRaw)
            ? sRaw
            : Array.isArray(sRaw?.suggestions)
              ? sRaw.suggestions
              : []
        }
        resolve({
          iid: Number(m.iid ?? iid),
          title: m.title || '',
          description: m.description || '',
          state: (m.state || '').toLowerCase(),
          author: m.author?.username || m.author?.name || '',
          webUrl: m.web_url || '',
          sourceBranch: m.source_branch || '',
          targetBranch: m.target_branch || '',
          draft: !!(m.draft ?? m.work_in_progress),
          reviewMd,
          reviewMeta,
          findings,
          suggestions,
          artifactShortSha,
        })
      },
    )
  })
}

// Merge an MR via glab. Human-initiated only (a button the user clicks) — this
// is the human satisfying the merge gate, not an agent auto-merging. Uses the
// project's default merge method; surfaces glab's error (e.g. pipeline must
// pass, conflicts, approvals) verbatim.
export function mergeMr(repoRoot: string, iid: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      'glab',
      ['mr', 'merge', String(iid), '--yes'],
      { cwd: repoRoot, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, _stdout, stderr) => {
        if (err) return resolve({ ok: false, error: (stderr || err.message || 'merge failed').trim() })
        const label = repoForCwd(repoRoot)?.path || repoRoot.split('/').pop() || ''
        emitActivity(
          { kind: 'pr-verdict', title: `Merged MR !${iid}`, detail: label, repo: label, repoRoot },
          { notify: true },
        )
        resolve({ ok: true })
      },
    )
  })
}

export type CiJob = { id: number; name: string; stage: string; status: string; webUrl: string }
export type CiInfo = { status: string; webUrl: string; jobs: CiJob[] }

// The forge's own CI pipeline for an MR's head — the actual lint/test/build/
// deploy jobs, separate from the harness review verdict. Two glab-api calls:
// the MR's head_pipeline, then that pipeline's jobs. Lazy-loaded (CI is slow).
export function getMrCi(repoRoot: string, iid: number): Promise<CiInfo | null> {
  const repo = repoForCwd(repoRoot)
  if (!repo) return Promise.resolve(null)
  const proj = encodeURIComponent(repo.path)
  const api = <T>(path: string) =>
    new Promise<T | null>((resolve) => {
      execFile(
        'glab',
        ['api', path],
        { cwd: repoRoot, timeout: 12_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err || !stdout) return resolve(null)
          try {
            resolve(JSON.parse(stdout) as T)
          } catch {
            resolve(null)
          }
        },
      )
    })
  return (async () => {
    const mr = await api<{ head_pipeline?: any; pipeline?: any }>(`projects/${proj}/merge_requests/${iid}`)
    const pl = mr?.head_pipeline || mr?.pipeline
    if (!pl?.id) return null
    const jobsRaw = await api<any[]>(`projects/${proj}/pipelines/${pl.id}/jobs?per_page=100`)
    const jobs: CiJob[] = Array.isArray(jobsRaw)
      ? jobsRaw.map((j) => ({
          id: j.id,
          name: j.name || '',
          stage: j.stage || '',
          status: j.status || '',
          webUrl: j.web_url || '',
        }))
      : []
    return { status: pl.status || '', webUrl: pl.web_url || '', jobs }
  })()
}

// Full MR diff. Prefers the harness-cached <short>.diff.patch (fast, exact same
// review-base→head as the reviewed artifact); falls back to live `glab mr diff`.
export function getMrDiff(repoRoot: string, iid: number): Promise<string> {
  const repo = repoForCwd(repoRoot)
  if (repo) {
    const dir = resolveReviewDir(repoRoot, repo.host, repo.path, iid)
    const short = dir ? newestArtifactShortSha(dir) : ''
    if (dir && short) {
      const f = join(dir, `${short}.diff.patch`)
      if (existsSync(f)) return Promise.resolve(readFileSync(f, 'utf8'))
    }
  }
  return new Promise((resolve) => {
    execFile(
      'glab',
      ['mr', 'diff', String(iid)],
      { cwd: repoRoot, timeout: 20_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => resolve(err ? '' : stdout || ''),
    )
  })
}
