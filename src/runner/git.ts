// ---- git / quoting ---------------------------------------------------------
import { execFileSync } from 'node:child_process'

export const git = (repo: string, args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export const shq = (s: unknown): string => `'${String(s).replace(/'/g, "'\\''")}'`

export function defaultBase(repo: string): string {
  try {
    return git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(
      /^origin\//,
      '',
    )
  } catch {}
  try {
    return git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return 'main'
  }
}
