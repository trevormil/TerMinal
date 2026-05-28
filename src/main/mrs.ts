import { execFile } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoForCwd } from './repo'
import {
  prDir,
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

// Live MRs for the repo via glab (run in the repo so it auto-detects the
// project + host), each enriched with its harness review/test verdict.
export function listMrs(repoRoot: string): Promise<Mr[]> {
  return new Promise((resolve) => {
    execFile(
      'glab',
      ['mr', 'list', '-F', 'json', '-P', '50'],
      { cwd: repoRoot, timeout: 12_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) return resolve([])
        let arr: any[]
        try {
          arr = JSON.parse(stdout)
        } catch {
          return resolve([])
        }
        if (!Array.isArray(arr)) return resolve([])
        const repo = repoForCwd(repoRoot)
        const mrs = arr.map((m): Mr => {
          const iid = m.iid ?? m.IID ?? m.number
          return {
            iid: Number(iid),
            title: m.title || '',
            state: (m.state || '').toLowerCase(),
            author: m.author?.username || m.author?.name || '',
            webUrl: m.web_url || m.webUrl || '',
            sourceBranch: m.source_branch || m.sourceBranch || '',
            draft: !!(m.draft ?? m.work_in_progress),
            review: repo ? reviewForPrDir(prDir(repo.host, repo.path, iid)) : null,
          }
        })
        resolve(mrs)
      },
    )
  })
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
        let reviewMd = ''
        let reviewMeta: Review | null = null
        let findings: Finding[] = []
        let suggestions: Finding[] = []
        let artifactShortSha = ''
        if (repo) {
          const dir = prDir(repo.host, repo.path, iid)
          reviewMeta = reviewForPrDir(dir)
          reviewMd = reviewBodyForPrDir(dir)
          artifactShortSha = newestArtifactShortSha(dir)
          // harness stores either bare arrays or { findings: [...] } / { suggestions: [...] }
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

// Full MR diff. Prefers the harness-cached <short>.diff.patch (fast, exact same
// review-base→head as the reviewed artifact); falls back to live `glab mr diff`.
export function getMrDiff(repoRoot: string, iid: number): Promise<string> {
  const repo = repoForCwd(repoRoot)
  if (repo) {
    const dir = prDir(repo.host, repo.path, iid)
    const short = newestArtifactShortSha(dir)
    if (short) {
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
