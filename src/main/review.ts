import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolvedHarnessDir } from './settings'

// Reads code-review/test artifacts from two locations:
//   in-repo (project-template):  <repoRoot>/.reviews/<iid>/<short_sha>.md  (+ findings/suggestions.json, no meta.json)
//   optional harness store:      <harnessDir>/prs/<host>/<owner>/<repo>/<iid>/<short_sha>.md (+ meta.json commit list)
// In-repo wins when present; the harness store is opt-in (Settings → harnessDir, '' = off).

export type Review = {
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
  /** Cross-PR triage classification — high/medium/low/unscored.
   *  Read from the artifact frontmatter `risk_tier:` field that
   *  bin/compute-verdict writes deterministically post-codex. */
  riskTier: 'high' | 'medium' | 'low' | 'unscored'
}

export function fmField(md: string, key: string): string | null {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return null
  const m = fm[1].match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))
  return m ? m[1].trim() : null
}

export function readJsonSafe<T = unknown>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

const safeReaddir = (d: string): string[] => {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}
const harnessPrDir = (host: string, repoPath: string, iid: number | string) => {
  const h = resolvedHarnessDir()
  return h ? join(h, 'prs', host, ...repoPath.split('/'), String(iid)) : ''
}
const inRepoReviewDir = (repoRoot: string, iid: number | string) =>
  join(repoRoot, '.reviews', String(iid))

function hasArtifacts(dir: string): boolean {
  if (!existsSync(dir)) return false
  return safeReaddir(dir).some((n) => /^[0-9a-f]{7,40}\.md$/.test(n)) || existsSync(join(dir, 'meta.json'))
}

/** The PR's artifact dir: prefer in-repo .reviews/<iid>, else harness prs/. */
export function resolveReviewDir(
  repoRoot: string,
  host: string,
  repoPath: string,
  iid: number | string,
): string | null {
  if (repoRoot) {
    const d = inRepoReviewDir(repoRoot, iid)
    if (hasArtifacts(d)) return d
  }
  const h = harnessPrDir(host, repoPath, iid)
  if (h && hasArtifacts(h)) return h
  return null
}

function newestBareShaMd(dir: string): string | null {
  let best: { p: string; mtime: number } | null = null
  for (const n of safeReaddir(dir)) {
    if (!/^[0-9a-f]{7,40}\.md$/.test(n)) continue
    const p = join(dir, n)
    try {
      const m = statSync(p).mtimeMs
      if (!best || m > best.mtime) best = { p, mtime: m }
    } catch {
      /* skip */
    }
  }
  return best?.p ?? null
}

// Resolve the artifact .md to read + staleness for a dir, handling both the
// meta.json (harness, commit-ordered) and in-repo (mtime, headShort) cases.
type Picked = { file: string; stale: boolean; commitsBehind: number; number: number }
function pickArtifact(dir: string, headShort?: string): Picked | null {
  const metaP = join(dir, 'meta.json')
  if (existsSync(metaP)) {
    let meta: any
    try {
      meta = JSON.parse(readFileSync(metaP, 'utf8'))
    } catch {
      return null
    }
    const commits: string[] = (meta.commits || []).map((c: any) =>
      typeof c === 'string' ? c : c.sha || c.short || '',
    )
    const shortOf = (s: string) => s.slice(0, 7)
    const number = Number(meta.number) || 0
    for (let i = 0; i < commits.length; i++) {
      const file = [`${commits[i]}.md`, `${shortOf(commits[i])}.md`]
        .map((c) => join(dir, c))
        .find((p) => existsSync(p))
      if (file) return { file, stale: i > 0, commitsBehind: i, number }
    }
    // commits rewritten (force-push) — fall back to newest by mtime, mark stale
    const fb = newestBareShaMd(dir)
    return fb ? { file: fb, stale: true, commitsBehind: commits.length, number } : null
  }
  // in-repo: no meta.json — newest artifact by mtime; stale vs the MR head sha
  const fb = newestBareShaMd(dir)
  if (!fb) return null
  const sha = fb.match(/\/([0-9a-f]{7,40})\.md$/)?.[1].slice(0, 7) || ''
  const stale = !!(headShort && sha && !headShort.startsWith(sha) && !sha.startsWith(headShort))
  return { file: fb, stale, commitsBehind: stale ? 1 : 0, number: Number(dir.split('/').pop()) || 0 }
}

/** Review/test state for a PR dir, or null if no artifact. headShort enables
 *  staleness detection for in-repo reviews (compare to the MR's current head). */
export function reviewForPrDir(dir: string, headShort?: string): Review | null {
  const a = pickArtifact(dir, headShort)
  if (!a) {
    // dir tracked (has meta) but no artifact generated yet
    if (existsSync(join(dir, 'meta.json'))) {
      const meta = readJsonSafe<any>(join(dir, 'meta.json'), {})
      return {
        number: Number(meta.number) || 0,
        overall: null,
        verdict: 'none',
        testStatus: 'none',
        stale: false,
        commitsBehind: 0,
        riskTier: 'unscored',
      }
    }
    return null
  }
  const md = readFileSync(a.file, 'utf8')
  const ov = fmField(md, 'overall')
  const rt = (fmField(md, 'risk_tier') || '').toLowerCase()
  const riskTier: Review['riskTier'] =
    rt === 'high' || rt === 'medium' || rt === 'low' ? rt : 'unscored'
  return {
    number: a.number,
    overall: ov ? Number(ov) : null,
    verdict: fmField(md, 'verdict') || 'none',
    testStatus: fmField(md, 'test_status') || 'none',
    stale: a.stale,
    commitsBehind: a.commitsBehind,
    riskTier,
  }
}

export function reviewBodyForPrDir(dir: string): string {
  const a = pickArtifact(dir)
  if (!a) return ''
  return readFileSync(a.file, 'utf8')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .trim()
}

export function newestArtifactShortSha(dir: string): string {
  const a = pickArtifact(dir)
  if (!a) return ''
  return a.file.match(/\/([0-9a-f]{7,40})\.md$/)?.[1].slice(0, 7) || ''
}

/** Newest reviewed PR dir for a repo (for the TDD widget): in-repo first. */
export function newestReviewDirForRepo(repoRoot: string, host: string, repoPath: string): string | null {
  if (repoRoot) {
    const rdir = join(repoRoot, '.reviews')
    if (existsSync(rdir)) {
      let best: { dir: string; mtime: number } | null = null
      for (const n of safeReaddir(rdir)) {
        const f = newestBareShaMd(join(rdir, n))
        if (!f) continue
        try {
          const m = statSync(f).mtimeMs
          if (!best || m > best.mtime) best = { dir: join(rdir, n), mtime: m }
        } catch {
          /* skip */
        }
      }
      if (best) return best.dir
    }
  }
  const harness = resolvedHarnessDir()
  if (!harness) return null
  const repoDir = join(harness, 'prs', host, ...repoPath.split('/'))
  if (!existsSync(repoDir)) return null
  let best: { dir: string; mtime: number } | null = null
  for (const n of safeReaddir(repoDir)) {
    const meta = join(repoDir, n, 'meta.json')
    try {
      if (existsSync(meta)) {
        const m = statSync(meta).mtimeMs
        if (!best || m > best.mtime) best = { dir: join(repoDir, n), mtime: m }
      }
    } catch {
      /* skip */
    }
  }
  return best?.dir ?? null
}
