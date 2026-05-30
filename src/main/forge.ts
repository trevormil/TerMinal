import { execFile } from 'node:child_process'
import { repoForCwd } from './repo'
import { readSettings, type ForgePref } from './settings'

// The single seam between the app and the user's code-forge CLI. GitHub repos
// drive `gh` (+ "PR"/"#" vocabulary); everything else drives `glab` (+ "MR"/"!").
// All fetchers return one normalized shape so the rest of the app (review
// enrichment, renderer) is forge-agnostic.

export type ForgeKind = 'github' | 'gitlab'
export type ForgeMeta = { kind: ForgeKind; cli: 'gh' | 'glab'; label: 'PR' | 'MR'; sym: '#' | '!' }

export type RawMr = {
  iid: number
  title: string
  state: string // normalized: opened | merged | closed | locked
  author: string
  webUrl: string
  sourceBranch: string
  draft: boolean
  headShort: string // 7-char head sha, for review-artifact staleness
  labels: string[] // forge labels (gh + glab). The 'auto-mergeable' label is the project-template convention for low-risk PRs (docs/tickets/reports only).
}
export type RawMrDetail = RawMr & { description: string; targetBranch: string }
export type CiJob = { id: number; name: string; stage: string; status: string; webUrl: string }
export type CiInfo = { status: string; webUrl: string; jobs: CiJob[] }
export type ListResult = { items: RawMr[]; error?: string }

// --- pure forge selection ----------------------------------------------------

export function forgeKindForHost(host: string, pref: ForgePref): ForgeKind {
  if (pref === 'github') return 'github'
  if (pref === 'gitlab') return 'gitlab'
  return /(^|\.)github\.com$/i.test(host) ? 'github' : 'gitlab'
}

export function forgeMeta(kind: ForgeKind): ForgeMeta {
  return kind === 'github'
    ? { kind, cli: 'gh', label: 'PR', sym: '#' }
    : { kind, cli: 'glab', label: 'MR', sym: '!' }
}

export function forgeFor(repoRoot: string): ForgeMeta {
  const host = repoForCwd(repoRoot)?.host || ''
  return forgeMeta(forgeKindForHost(host, readSettings().forge))
}

/** Short, accurate reason for an empty list (CLI missing vs auth vs other). */
export function forgeErrorReason(cli: string, err: Error | null, stderr?: string): string | undefined {
  if (!err) return undefined
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return `${cli} not found on PATH`
  const msg = `${stderr || ''} ${err.message || ''}`.toLowerCase()
  if (/401|unauthor|\bauth\b|token|not logged in|login/.test(msg))
    return `${cli} not authenticated for this host`
  return (stderr || err.message || `${cli} error`).trim().split('\n')[0] || `${cli} error`
}

// --- pure normalizers (exported for tests) -----------------------------------

const normState = (s: string): string => {
  const v = (s || '').toLowerCase()
  return v === 'open' ? 'opened' : v // gh uses OPEN; gitlab uses opened
}

export function ghToRaw(m: any): RawMr {
  return {
    iid: Number(m.number),
    title: m.title || '',
    state: normState(m.state),
    author: m.author?.login || m.author?.name || '',
    webUrl: m.url || '',
    sourceBranch: m.headRefName || '',
    draft: !!m.isDraft,
    headShort: String(m.headRefOid || '').slice(0, 7),
    labels: normLabels(m.labels),
  }
}

export function glabToRaw(m: any): RawMr {
  const iid = m.iid ?? m.IID ?? m.number
  return {
    iid: Number(iid),
    title: m.title || '',
    state: normState(m.state),
    author: m.author?.username || m.author?.name || '',
    webUrl: m.web_url || m.webUrl || '',
    sourceBranch: m.source_branch || m.sourceBranch || '',
    draft: !!(m.draft ?? m.work_in_progress),
    headShort: String(m.sha || m.diff_refs?.head_sha || '').slice(0, 7),
    labels: normLabels(m.labels),
  }
}

export function parseList(kind: ForgeKind, stdout: string): RawMr[] {
  let arr: any
  try {
    arr = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr.map(kind === 'github' ? ghToRaw : glabToRaw)
}

/** gh `bucket` (+ state fallback) → the same status vocabulary as GitLab jobs. */
export function ghBucketToStatus(bucket: string, state?: string): string {
  switch ((bucket || '').toLowerCase()) {
    case 'pass':
      return 'success'
    case 'fail':
      return 'failed'
    case 'pending':
      return 'running'
    case 'skipping':
      return 'skipped'
    case 'cancel':
      return 'canceled'
  }
  const s = (state || '').toLowerCase()
  if (s === 'success') return 'success'
  if (s === 'failure' || s === 'error') return 'failed'
  return s || 'pending'
}

export function overallStatus(statuses: string[]): string {
  if (statuses.some((s) => s === 'failed')) return 'failed'
  if (statuses.some((s) => s === 'running' || s === 'pending')) return 'running'
  if (statuses.length && statuses.every((s) => ['success', 'skipped', 'canceled'].includes(s)))
    return 'success'
  return 'pending'
}

// --- CLI execution -----------------------------------------------------------

export type RunResult = { err: Error | null; stdout: string; stderr: string }
export function run(
  cli: string,
  args: string[],
  cwd: string,
  opts?: { timeout?: number; maxBuffer?: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cli,
      args,
      { cwd, timeout: opts?.timeout ?? 12_000, maxBuffer: opts?.maxBuffer ?? 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }),
    )
  })
}

const GH_LIST_FIELDS = 'number,title,state,author,headRefName,isDraft,url,headRefOid,labels'

// Labels normalizer — gh returns [{name,color,...}], glab returns strings or
// [{name,...}]. Coerce to a flat string[] either way.
function normLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x === 'string') out.push(x)
    else if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string')
      out.push((x as Record<string, string>).name)
  }
  return out
}
const GH_VIEW_FIELDS = `${GH_LIST_FIELDS},baseRefName,body`

// Fetch all lifecycle states (open + merged + closed) so the UI can browse past
// MRs and their review artifacts, not just open ones. The renderer filters by
// state client-side (default: open), so this single call backs every filter.
export async function listRaw(repoRoot: string): Promise<ListResult> {
  const f = forgeFor(repoRoot)
  if (f.kind === 'github') {
    const r = await run('gh', ['pr', 'list', '--state', 'all', '--limit', '100', '--json', GH_LIST_FIELDS], repoRoot)
    if (r.err) return { items: [], error: forgeErrorReason('gh', r.err, r.stderr) }
    return { items: parseList('github', r.stdout) }
  }
  const r = await run('glab', ['mr', 'list', '--all', '-F', 'json', '-P', '100'], repoRoot)
  if (r.err) return { items: [], error: forgeErrorReason('glab', r.err, r.stderr) }
  return { items: parseList('gitlab', r.stdout) }
}

export async function detailRaw(repoRoot: string, iid: number): Promise<RawMrDetail | null> {
  const f = forgeFor(repoRoot)
  if (f.kind === 'github') {
    const r = await run('gh', ['pr', 'view', String(iid), '--json', GH_VIEW_FIELDS], repoRoot)
    if (r.err || !r.stdout) return null
    let m: any
    try {
      m = JSON.parse(r.stdout)
    } catch {
      return null
    }
    return { ...ghToRaw(m), description: m.body || '', targetBranch: m.baseRefName || '' }
  }
  const r = await run('glab', ['mr', 'view', String(iid), '-F', 'json'], repoRoot)
  if (r.err || !r.stdout) return null
  let m: any
  try {
    m = JSON.parse(r.stdout)
  } catch {
    return null
  }
  const raw = glabToRaw(m)
  if (!raw.iid) raw.iid = iid
  return { ...raw, description: m.description || '', targetBranch: m.target_branch || '' }
}

/** Pick a non-interactive merge method GitHub actually allows for this repo. */
async function ghMergeMethod(repoRoot: string): Promise<string> {
  const repo = repoForCwd(repoRoot)
  if (!repo) return '--merge'
  const r = await run('gh', ['api', `repos/${repo.path}`], repoRoot)
  if (r.err || !r.stdout) return '--merge'
  try {
    const j = JSON.parse(r.stdout)
    if (j.allow_merge_commit) return '--merge'
    if (j.allow_squash_merge) return '--squash'
    if (j.allow_rebase_merge) return '--rebase'
  } catch {
    /* default */
  }
  return '--merge'
}

export async function merge(repoRoot: string, iid: number): Promise<{ ok: boolean; error?: string }> {
  const f = forgeFor(repoRoot)
  if (f.kind === 'github') {
    const method = await ghMergeMethod(repoRoot)
    const r = await run('gh', ['pr', 'merge', String(iid), method], repoRoot, { timeout: 60_000 })
    if (r.err) return { ok: false, error: (r.stderr || r.err.message || 'merge failed').trim() }
    return { ok: true }
  }
  const r = await run('glab', ['mr', 'merge', String(iid), '--yes'], repoRoot, { timeout: 60_000 })
  if (r.err) return { ok: false, error: (r.stderr || r.err.message || 'merge failed').trim() }
  return { ok: true }
}

async function glabCi(repoRoot: string, iid: number): Promise<CiInfo | null> {
  const repo = repoForCwd(repoRoot)
  if (!repo) return null
  const proj = encodeURIComponent(repo.path)
  const api = async <T>(path: string): Promise<T | null> => {
    const r = await run('glab', ['api', path], repoRoot, { maxBuffer: 8 * 1024 * 1024 })
    if (r.err || !r.stdout) return null
    try {
      return JSON.parse(r.stdout) as T
    } catch {
      return null
    }
  }
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
}

async function ghCi(repoRoot: string, iid: number): Promise<CiInfo | null> {
  // `gh pr checks` exits non-zero when checks are failing/pending — it still
  // prints the JSON to stdout, so parse regardless of exit code.
  const r = await run(
    'gh',
    ['pr', 'checks', String(iid), '--json', 'name,state,bucket,link'],
    repoRoot,
    { maxBuffer: 8 * 1024 * 1024 },
  )
  if (!r.stdout) return null
  let arr: any
  try {
    arr = JSON.parse(r.stdout)
  } catch {
    return null
  }
  if (!Array.isArray(arr) || !arr.length) return null
  const jobs: CiJob[] = arr.map((c, i) => ({
    id: i,
    name: c.name || '',
    stage: 'checks', // gh has no stage concept — flatten under one group
    status: ghBucketToStatus(c.bucket, c.state),
    webUrl: c.link || '',
  }))
  return { status: overallStatus(jobs.map((j) => j.status)), webUrl: '', jobs }
}

export function ci(repoRoot: string, iid: number): Promise<CiInfo | null> {
  return forgeFor(repoRoot).kind === 'github' ? ghCi(repoRoot, iid) : glabCi(repoRoot, iid)
}

export async function diff(repoRoot: string, iid: number): Promise<string> {
  const f = forgeFor(repoRoot)
  const args = f.kind === 'github' ? ['pr', 'diff', String(iid)] : ['mr', 'diff', String(iid)]
  const r = await run(f.cli, args, repoRoot, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 })
  return r.err ? '' : r.stdout
}
