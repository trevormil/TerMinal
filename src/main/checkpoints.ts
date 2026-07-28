import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseUnifiedRanges } from '../shared/diff-ranges'

// Per-turn workspace checkpoints — "one click rolls back to before the agent
// did that", the thing that makes letting an agent run unattended feel safe.
//
// Implemented as a SHADOW git repo: a separate --git-dir pointed at the real
// working tree. That gives real history, diffs, and restore for free while
// never touching the user's own .git — no stray commits, no index mutation, no
// interference with their branch. `git add -A` still honours the work tree's
// .gitignore, so build output stays out.

export type Checkpoint = { sha: string; at: number; label: string }

const DEFAULT_ROOT = join(homedir(), '.config', 'TerMinal', 'checkpoints')
const execFileAsync = promisify(execFile)
const checkpointInFlight = new Set<string>()

function checkpointRoot(): string {
  return process.env.TERMINAL_CHECKPOINT_ROOT || DEFAULT_ROOT
}

/** One shadow repo per workspace, keyed by a hash of its absolute path. */
export function checkpointDir(repoRoot: string): string {
  return join(
    checkpointRoot(),
    `${createHash('sha256').update(repoRoot).digest('hex').slice(0, 16)}.git`,
  )
}

function git(repoRoot: string, args: string[], timeoutMs = 20000): string {
  return execFileSync(
    'git',
    ['--git-dir', checkpointDir(repoRoot), '--work-tree', repoRoot, ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      // Never let the user's identity/hooks/signing config affect the shadow repo.
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'TerMinal',
        GIT_AUTHOR_EMAIL: 'checkpoint@terminal.local',
        GIT_COMMITTER_NAME: 'TerMinal',
        GIT_COMMITTER_EMAIL: 'checkpoint@terminal.local',
      },
    },
  ).toString()
}

async function gitAsync(repoRoot: string, args: string[], timeoutMs = 20000): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['--git-dir', checkpointDir(repoRoot), '--work-tree', repoRoot, ...args],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'TerMinal',
        GIT_AUTHOR_EMAIL: 'checkpoint@terminal.local',
        GIT_COMMITTER_NAME: 'TerMinal',
        GIT_COMMITTER_EMAIL: 'checkpoint@terminal.local',
      },
    },
  )
  return stdout.toString()
}

async function ensureRepoAsync(repoRoot: string): Promise<boolean> {
  const dir = checkpointDir(repoRoot)
  if (existsSync(dir)) return true
  try {
    mkdirSync(checkpointRoot(), { recursive: true })
    await execFileAsync('git', ['init', '--bare', '--quiet', dir], { timeout: 20000 })
    await gitAsync(repoRoot, ['config', 'core.bare', 'false'])
    return true
  } catch {
    return false
  }
}

/**
 * Snapshot the working tree. Returns the new commit's sha, or '' when nothing
 * changed since the last checkpoint (so an idle turn doesn't spam history).
 */
export async function createCheckpoint(
  repoRoot: string,
  label: string,
): Promise<{ ok: boolean; sha: string }> {
  if (!repoRoot) return { ok: false, sha: '' }
  if (checkpointInFlight.has(repoRoot)) return { ok: true, sha: '' }
  checkpointInFlight.add(repoRoot)
  try {
    if (!(await ensureRepoAsync(repoRoot))) return { ok: false, sha: '' }
    await gitAsync(repoRoot, ['add', '-A'])
    // --allow-empty is deliberately NOT passed: an unchanged tree should not
    // create a checkpoint. git commit exits non-zero in that case.
    try {
      await gitAsync(repoRoot, ['commit', '-m', label.slice(0, 200), '--quiet'])
    } catch {
      return { ok: true, sha: '' } // nothing to snapshot — not an error
    }
    return { ok: true, sha: (await gitAsync(repoRoot, ['rev-parse', 'HEAD'])).trim() }
  } catch {
    return { ok: false, sha: '' }
  } finally {
    checkpointInFlight.delete(repoRoot)
  }
}

/** Parse `git log --format=%H%x00%at%x00%s` into checkpoints (pure, testable). */
export function parseCheckpointLog(out: string): Checkpoint[] {
  const list: Checkpoint[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [sha, at, ...rest] = line.split('\0')
    if (!sha || !at) continue
    list.push({ sha, at: Number(at) * 1000, label: rest.join('\0') })
  }
  return list
}

export function listCheckpoints(repoRoot: string, limit = 50): Checkpoint[] {
  if (!repoRoot || !existsSync(checkpointDir(repoRoot))) return []
  try {
    return parseCheckpointLog(git(repoRoot, ['log', `-${limit}`, '--format=%H%x00%at%x00%s']))
  } catch {
    return []
  }
}

/** A file's content at a checkpoint ('' when it didn't exist there). */
export function fileAtCheckpoint(
  repoRoot: string,
  sha: string,
  rel: string,
): { ok: boolean; content: string } {
  if (!repoRoot || !sha || !existsSync(checkpointDir(repoRoot))) return { ok: false, content: '' }
  if (!/^[0-9a-f]{4,40}$/i.test(sha) || rel.includes('..')) return { ok: false, content: '' }
  try {
    return { ok: true, content: git(repoRoot, ['show', `${sha}:${rel}`]) }
  } catch {
    // Absent from that checkpoint — an empty original is the correct base.
    return { ok: true, content: '' }
  }
}

/**
 * The line ranges a checkpoint touched, per file — what the agent's turn
 * wrote, for the AI-attribution gutter. Diffs the commit against its parent
 * (or the empty tree for the very first checkpoint).
 */
export function checkpointChangedRanges(
  repoRoot: string,
  sha: string,
): Record<string, { from: number; to: number }[]> {
  if (!repoRoot || !/^[0-9a-f]{4,40}$/i.test(sha) || !existsSync(checkpointDir(repoRoot))) return {}
  try {
    let base = ''
    try {
      base = git(repoRoot, ['rev-parse', `${sha}^`]).trim()
    } catch {
      // First checkpoint: git's well-known empty tree object.
      base = git(repoRoot, ['hash-object', '-t', 'tree', '/dev/null']).trim()
    }
    return parseUnifiedRanges(git(repoRoot, ['diff', '--unified=0', '--no-color', base, sha]))
  } catch {
    return {}
  }
}

export type ReviewBase = { ok: true; sha: string; content: string } | { ok: false }

/**
 * The baseline Review mode should diff the current buffer against.
 *
 * Checkpoints are POST-turn snapshots, so when the newest one touched this
 * file, its PARENT is the base that shows that turn's edits — picking the
 * newest itself would hide them behind any later local edit (or diff the
 * file against itself when there were none). When the last turn left the
 * file alone, the newest checkpoint is the right base for showing local
 * drift; when even that matches the buffer, checkpoints have nothing to
 * show and the caller falls back to HEAD.
 */
export function reviewBaseFor(repoRoot: string, rel: string, buffer: string): ReviewBase {
  const cps = listCheckpoints(repoRoot, 2)
  if (!cps.length) return { ok: false }
  const newest = fileAtCheckpoint(repoRoot, cps[0].sha, rel)
  if (!newest.ok) return { ok: false }
  if (cps.length > 1) {
    const prev = fileAtCheckpoint(repoRoot, cps[1].sha, rel)
    if (prev.ok && prev.content !== newest.content) {
      return { ok: true, sha: cps[1].sha, content: prev.content }
    }
  }
  if (newest.content !== buffer) return { ok: true, sha: cps[0].sha, content: newest.content }
  return { ok: false }
}

/**
 * Restore the working tree to a checkpoint.
 *
 * A checkpoint is taken FIRST, so restoring is itself undoable — rolling back
 * can never be the thing that loses work.
 */
export async function restoreCheckpoint(
  repoRoot: string,
  sha: string,
): Promise<{ ok: boolean; error?: string; backup?: string }> {
  if (!repoRoot || !sha) return { ok: false, error: 'no checkpoint given' }
  if (!existsSync(checkpointDir(repoRoot)))
    return { ok: false, error: 'no checkpoints for this workspace' }
  try {
    // Capture the pre-restore state. When nothing has changed since the last
    // checkpoint there's no new commit — HEAD already *is* that state, so
    // return it rather than '' (the caller's undo must always have a target).
    const fresh = (await createCheckpoint(repoRoot, `before restoring ${sha.slice(0, 8)}`)).sha
    const backup = fresh || (await gitAsync(repoRoot, ['rev-parse', 'HEAD'])).trim()

    // read-tree --reset -u makes the INDEX and the working tree match the
    // target. Plain `checkout <sha> -- .` restores file contents but leaves
    // index entries for files added afterwards, so those files survive as
    // tracked — and `clean` then won't remove them. That was the bug.
    await gitAsync(repoRoot, ['read-tree', '--reset', '-u', sha])
    // Anything still untracked (created since, and never checkpointed) goes too.
    await gitAsync(repoRoot, ['clean', '-fd'])
    return { ok: true, backup }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
