// Local (pre-PR) changes as a diff source — the working-tree analog of the
// forge MR diff in ./mrs.ts. Same shapes (unified-diff string + per-file
// structural diff) so the renderer's DiffView can render local changes with no
// forge/PR involved. Ticket #15.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { difftOnPath } from './forge'
import { structuralDiffFromContent, type StructuralDiffResult } from './structural'

// 'branch'  → committed changes on this branch vs the base branch (what a PR
//             would contain): `git diff <mergeBase(base,HEAD)>..HEAD`.
// 'working' → uncommitted changes (staged + unstaged) vs HEAD: `git diff HEAD`.
export type LocalDiffMode = 'branch' | 'working'

function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

// True if <rev> resolves in this repo (branch exists, sha valid, etc.).
function revExists(repoRoot: string, rev: string): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', rev], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

// The branch to compare 'branch' mode against. Honor an explicit request, else
// fall back main → master → the first that exists.
export function resolveBaseBranch(repoRoot: string, requested?: string): string {
  if (requested && revExists(repoRoot, requested)) return requested
  if (revExists(repoRoot, 'main')) return 'main'
  if (revExists(repoRoot, 'master')) return 'master'
  return requested || 'main'
}

// Does <ref>:<path> exist? Distinguishes an added/deleted file (null side) from
// a genuinely empty file ('').
function pathAtRef(repoRoot: string, ref: string, path: string): string | null {
  try {
    execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${ref}:${path}`], { stdio: 'ignore' })
  } catch {
    return null
  }
  return git(repoRoot, ['show', `${ref}:${path}`])
}

// Unified diff for local changes, in the same format parse-diff already consumes
// for MR diffs. Empty string when there's nothing (or not a git repo).
export function localDiff(repoRoot: string, mode: LocalDiffMode, baseBranch?: string): string {
  if (!repoRoot) return ''
  if (mode === 'working') return git(repoRoot, ['diff', 'HEAD'])
  const base = resolveBaseBranch(repoRoot, baseBranch)
  const mergeBase = git(repoRoot, ['merge-base', base, 'HEAD']).trim() || base
  return git(repoRoot, ['diff', `${mergeBase}..HEAD`])
}

// Per-file structural (difft) diff of local changes. Old/new content comes from
// local git (base ref) and the working tree — no forge fetch. Not cached: the
// working tree mutates as the user edits, and single-file difft is cheap.
export async function localStructuralDiff(
  repoRoot: string,
  mode: LocalDiffMode,
  path: string,
  baseBranch?: string,
  width?: number,
): Promise<StructuralDiffResult> {
  if (!(await difftOnPath())) return { ok: false, reason: 'difft-missing' }
  if (!repoRoot) return { ok: false, reason: 'error', message: 'not a git repository' }

  let oldContent: string | null
  let newContent: string | null
  if (mode === 'working') {
    oldContent = pathAtRef(repoRoot, 'HEAD', path)
    const abs = join(repoRoot, path)
    newContent = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  } else {
    const base = resolveBaseBranch(repoRoot, baseBranch)
    const mergeBase = git(repoRoot, ['merge-base', base, 'HEAD']).trim() || base
    oldContent = pathAtRef(repoRoot, mergeBase, path)
    newContent = pathAtRef(repoRoot, 'HEAD', path)
  }
  return structuralDiffFromContent(oldContent, newContent, width, `local-${path}`)
}
