import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { difftOnPath } from './forge'
import { structuralDiffFromContent, type StructuralDiffResult } from './structural'

// Structural (difft) diff for one file's LOCAL working-tree change vs HEAD —
// the local counterpart to mrs.getStructuralDiff. old = the file at HEAD (null
// if untracked/newly-added), new = the working-tree file (null if deleted).
// Matches getWorkingDiff's working-tree-vs-HEAD scope; no caching (the working
// tree isn't content-addressable, and difft on two small blobs is cheap).
export async function getWorkingStructuralDiff(
  repoRoot: string,
  path: string,
  width?: number,
): Promise<StructuralDiffResult> {
  if (!repoRoot || !path || path.split('/').includes('..')) {
    return { ok: false, reason: 'error', message: 'invalid path' }
  }
  if (!(await difftOnPath())) return { ok: false, reason: 'difft-missing' }
  let head: string | null
  try {
    head = execFileSync('git', ['-C', repoRoot, 'show', `HEAD:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    head = null // not in HEAD → untracked / newly added
  }
  let work: string | null
  try {
    work = readFileSync(join(repoRoot, path), 'utf8')
  } catch {
    work = null // gone from the working tree → deleted
  }
  return structuralDiffFromContent(head, work, width, path)
}
