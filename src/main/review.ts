import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Shared reader for autopilot-harness review/test artifacts.
//   prs/<host>/<owner>/<repo>/<iid>/meta.json        (ordered commit list)
//   prs/<host>/<owner>/<repo>/<iid>/<short_sha>.md    (frontmatter: verdict, test_status, scores.overall)
export const HARNESS = join(homedir(), 'CompSci', 'gauntlet', 'autopilot-harness')

export type Review = {
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
}

export function fmField(md: string, key: string): string | null {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return null
  const m = fm[1].match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))
  return m ? m[1].trim() : null
}

export function prDir(host: string, repoPath: string, iid: number | string): string {
  return join(HARNESS, 'prs', host, ...repoPath.split('/'), String(iid))
}

/** Read the review/test state for one PR directory, or null if untracked. */
export function reviewForPrDir(dir: string): Review | null {
  if (!existsSync(join(dir, 'meta.json'))) return null
  let meta: any
  try {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
  const commits: string[] = (meta.commits || []).map((c: any) =>
    typeof c === 'string' ? c : c.sha || c.short || '',
  )
  const shortOf = (sha: string) => sha.slice(0, 7)

  let artifactIdx = -1
  for (let i = 0; i < commits.length; i++) {
    if ([`${commits[i]}.md`, `${shortOf(commits[i])}.md`].some((c) => existsSync(join(dir, c)))) {
      artifactIdx = i
      break
    }
  }

  let overall: number | null = null
  let verdict = 'none'
  let testStatus = 'none'
  if (artifactIdx >= 0) {
    const sha = commits[artifactIdx]
    const file = [`${sha}.md`, `${shortOf(sha)}.md`]
      .map((c) => join(dir, c))
      .find((p) => existsSync(p))!
    const md = readFileSync(file, 'utf8')
    const ov = fmField(md, 'overall')
    overall = ov ? Number(ov) : null
    verdict = fmField(md, 'verdict') || 'none'
    testStatus = fmField(md, 'test_status') || 'none'
  }
  return {
    number: Number(meta.number) || 0,
    overall,
    verdict,
    testStatus,
    stale: artifactIdx > 0 || artifactIdx === -1,
    commitsBehind: artifactIdx === -1 ? commits.length : artifactIdx,
  }
}

/** Newest tracked PR dir for a repo, by meta.json mtime. */
export function newestPrDirForRepo(host: string, repoPath: string): string | null {
  const repoDir = join(HARNESS, 'prs', host, ...repoPath.split('/'))
  if (!existsSync(repoDir)) return null
  let best: { dir: string; mtime: number } | null = null
  let nums: string[]
  try {
    nums = readdirSync(repoDir)
  } catch {
    return null
  }
  for (const n of nums) {
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
