import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { existingProjectAreaPaths, projectAreaPathForRead } from './project-layout'
import { resolvedHarnessDir } from './settings'

// Reads code-review/test artifacts from two locations:
//   in-repo v2 (project-template): <repoRoot>/.TerMinal/reviews/<iid>/<short_sha>.md
//   in-repo v1 (legacy):           <repoRoot>/.reviews/<iid>/<short_sha>.md
//   optional harness store:      <harnessDir>/prs/<host>/<owner>/<repo>/<iid>/<short_sha>.md (+ meta.json commit list)
// In-repo wins when present; the harness store is opt-in (Settings → harnessDir, '' = off).

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

/** Derive the categorical tier from the canonical 0-5 risk score. */
export function riskTierFromScore(score: number): 'high' | 'medium' | 'low' {
  if (score >= 4) return 'high'
  if (score >= 2) return 'medium'
  return 'low'
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
  join(projectAreaPathForRead(repoRoot, 'reviews'), String(iid))

function hasArtifacts(dir: string): boolean {
  if (!existsSync(dir)) return false
  return safeReaddir(dir).some((n) => /^[0-9a-f]{7,40}\.md$/.test(n)) || existsSync(join(dir, 'meta.json'))
}

/** The PR's artifact dir: prefer in-repo project reviews, else harness prs/. */
export function resolveReviewDir(
  repoRoot: string,
  host: string,
  repoPath: string,
  iid: number | string,
): string | null {
  if (repoRoot) {
    for (const base of existingProjectAreaPaths(repoRoot, 'reviews')) {
      const d = join(base, String(iid))
      if (hasArtifacts(d)) return d
    }
  }
  const h = harnessPrDir(host, repoPath, iid)
  if (h && hasArtifacts(h)) return h
  return null
}

// The /digest artifact (<sha>.chunks.json) for an MR — independent of whether a
// review .md exists (a UI-run digest has no .md). Prefers an exact head-sha match,
// else the newest chunks.json across the in-repo + harness dirs.
export function readDigest(
  repoRoot: string,
  host: string,
  repoPath: string,
  iid: number | string,
  preferShort?: string,
): any | null {
  const dirs: string[] = []
  if (repoRoot) for (const base of existingProjectAreaPaths(repoRoot, 'reviews')) dirs.push(join(base, String(iid)))
  const h = harnessPrDir(host, repoPath, iid)
  if (h) dirs.push(h)

  let exact: string | null = null
  let newest: { file: string; mtime: number } | null = null
  for (const dir of dirs) {
    for (const n of safeReaddir(dir)) {
      const m = n.match(/^([0-9a-f]{7,40})\.chunks\.json$/)
      if (!m) continue
      const p = join(dir, n)
      if (preferShort && (m[1].startsWith(preferShort) || preferShort.startsWith(m[1]))) exact = p
      try {
        const mt = statSync(p).mtimeMs
        if (!newest || mt > newest.mtime) newest = { file: p, mtime: mt }
      } catch {
        /* skip */
      }
    }
  }
  const file = exact ?? newest?.file
  return file ? readJsonSafe<any>(file, null) : null
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
        riskScore: null,
        riskTier: 'unscored',
      }
    }
    return null
  }
  const md = readFileSync(a.file, 'utf8')
  const ov = fmField(md, 'overall')
  // risk_score (0-5) is canonical; derive the tier from it. Fall back to the
  // legacy risk_tier field for artifacts written before risk_score existed.
  const rsRaw = fmField(md, 'risk_score')
  const rs = rsRaw != null && rsRaw !== '' && !isNaN(Number(rsRaw)) ? Number(rsRaw) : null
  const rt = (fmField(md, 'risk_tier') || '').toLowerCase()
  const riskTier: Review['riskTier'] =
    rs != null
      ? riskTierFromScore(rs)
      : rt === 'high' || rt === 'medium' || rt === 'low'
        ? rt
        : 'unscored'
  return {
    number: a.number,
    overall: ov ? Number(ov) : null,
    verdict: fmField(md, 'verdict') || 'none',
    testStatus: fmField(md, 'test_status') || 'none',
    stale: a.stale,
    commitsBehind: a.commitsBehind,
    riskScore: rs,
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
    for (const rdir of existingProjectAreaPaths(repoRoot, 'reviews')) {
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
