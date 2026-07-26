import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Per-turn workspace checkpoints — "one click rolls back to before the agent
// did that", the thing that makes letting an agent run unattended feel safe.
//
// Implemented as a SHADOW git repo: a separate --git-dir pointed at the real
// working tree. That gives real history, diffs, and restore for free while
// never touching the user's own .git — no stray commits, no index mutation, no
// interference with their branch. `git add -A` still honours the work tree's
// .gitignore, so build output stays out.

export type Checkpoint = { sha: string; at: number; label: string }

const ROOT = join(homedir(), '.config', 'TerMinal', 'checkpoints')

/** One shadow repo per workspace, keyed by a hash of its absolute path. */
export function checkpointDir(repoRoot: string): string {
  return join(ROOT, `${createHash('sha256').update(repoRoot).digest('hex').slice(0, 16)}.git`)
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

function ensureRepo(repoRoot: string): boolean {
  const dir = checkpointDir(repoRoot)
  if (existsSync(dir)) return true
  try {
    mkdirSync(ROOT, { recursive: true })
    execFileSync('git', ['init', '--bare', '--quiet', dir], { stdio: 'ignore', timeout: 20000 })
    // A bare repo has no work tree by default; we supply one per command.
    git(repoRoot, ['config', 'core.bare', 'false'])
    return true
  } catch {
    return false
  }
}

/**
 * Snapshot the working tree. Returns the new commit's sha, or '' when nothing
 * changed since the last checkpoint (so an idle turn doesn't spam history).
 */
export function createCheckpoint(repoRoot: string, label: string): { ok: boolean; sha: string } {
  if (!repoRoot || !ensureRepo(repoRoot)) return { ok: false, sha: '' }
  try {
    git(repoRoot, ['add', '-A'])
    // --allow-empty is deliberately NOT passed: an unchanged tree should not
    // create a checkpoint. git commit exits non-zero in that case.
    try {
      git(repoRoot, ['commit', '-m', label.slice(0, 200), '--quiet'])
    } catch {
      return { ok: true, sha: '' } // nothing to snapshot — not an error
    }
    return { ok: true, sha: git(repoRoot, ['rev-parse', 'HEAD']).trim() }
  } catch {
    return { ok: false, sha: '' }
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

/**
 * Restore the working tree to a checkpoint.
 *
 * A checkpoint is taken FIRST, so restoring is itself undoable — rolling back
 * can never be the thing that loses work.
 */
export function restoreCheckpoint(
  repoRoot: string,
  sha: string,
): { ok: boolean; error?: string; backup?: string } {
  if (!repoRoot || !sha) return { ok: false, error: 'no checkpoint given' }
  if (!existsSync(checkpointDir(repoRoot)))
    return { ok: false, error: 'no checkpoints for this workspace' }
  try {
    // Capture the pre-restore state. When nothing has changed since the last
    // checkpoint there's no new commit — HEAD already *is* that state, so
    // return it rather than '' (the caller's undo must always have a target).
    const fresh = createCheckpoint(repoRoot, `before restoring ${sha.slice(0, 8)}`).sha
    const backup = fresh || git(repoRoot, ['rev-parse', 'HEAD']).trim()

    // read-tree --reset -u makes the INDEX and the working tree match the
    // target. Plain `checkout <sha> -- .` restores file contents but leaves
    // index entries for files added afterwards, so those files survive as
    // tracked — and `clean` then won't remove them. That was the bug.
    git(repoRoot, ['read-tree', '--reset', '-u', sha])
    // Anything still untracked (created since, and never checkpointed) goes too.
    git(repoRoot, ['clean', '-fd'])
    return { ok: true, backup }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
