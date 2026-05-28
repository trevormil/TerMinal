import { execFile } from 'node:child_process'
import { repoForCwd } from './repo'
import { prDir, reviewForPrDir, type Review } from './review'

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
