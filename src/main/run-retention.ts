import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

// Run retention policy (pure -- no electron/fs, so it's unit-testable).
//
// Run logs on disk are NEVER auto-deleted (storage cheap; user prunes
// manually when space tight). This only bounds in-memory working set so
// large on-disk archive doesn't bloat process RAM. The most recent `keep`
// runs (by startedAt) hold in memory. `keep <= 0` loads all. Returns a new
// ascending-sorted array; never mutates input, never deletes.
export function inMemoryWorkingSet<T extends { startedAt: number }>(metas: T[], keep: number): T[] {
  const sorted = [...metas].sort((a, b) => a.startedAt - b.startedAt)
  return keep > 0 && sorted.length > keep ? sorted.slice(-keep) : sorted
}

export type StorageEntry = {
  path: string
  bytes: number
}

export type CheckpointGcEntry = StorageEntry & {
  error?: string
}

export type TerminalStateSweepReport = {
  root: string
  dryRun: boolean
  totalBytes: number
  reclaimableBytes: number
  reclaimedBytes: number
  worktrees: {
    bytes: number
    thresholdBytes: number
    planned: StorageEntry[]
    deleted: StorageEntry[]
    protectedRunning: StorageEntry[]
  }
  checkpoints: {
    bytes: number
    thresholdBytes: number
    gc: {
      planned: StorageEntry[]
      completed: CheckpointGcEntry[]
    }
    tmpObjects: {
      planned: StorageEntry[]
      deleted: StorageEntry[]
    }
  }
  scratch: {
    bytes: number
    clearable: boolean
  }
}

export type TerminalStateSweepOptions = {
  dryRun?: boolean
  cronWorktreesMaxBytes?: number
  checkpointGcMinBytes?: number
}

export type ScratchClearReport = {
  path: string
  bytes: number
  deleted: boolean
}

const GiB = 1024 * 1024 * 1024
const DEFAULT_CRON_WORKTREES_MAX_BYTES = GiB
const DEFAULT_CHECKPOINT_GC_MIN_BYTES = 256 * 1024 * 1024

export function terminalConfigRoot(): string {
  return join(homedir(), '.config', 'TerMinal')
}

function safeChildren(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function sizeOfPath(path: string): number {
  try {
    const st = lstatSync(path)
    if (!st.isDirectory() || st.isSymbolicLink()) return st.size
    let total = 0
    for (const child of safeChildren(path)) total += sizeOfPath(join(path, child))
    return total
  } catch {
    return 0
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function immediateDirs(dir: string): StorageEntry[] {
  return safeChildren(dir)
    .map((child) => join(dir, child))
    .filter((path) => {
      try {
        const st = lstatSync(path)
        return st.isDirectory() && !st.isSymbolicLink()
      } catch {
        return false
      }
    })
    .map((path) => ({ path, bytes: sizeOfPath(path) }))
}

function runningWorktrees(root: string): Set<string> {
  const runsDir = join(root, 'cron-runs')
  const out = new Set<string>()
  for (const file of safeChildren(runsDir)) {
    if (!file.endsWith('.json')) continue
    try {
      const run = JSON.parse(readFileSync(join(runsDir, file), 'utf8')) as {
        status?: string
        worktree?: string
      }
      if (run.status !== 'running' || !run.worktree) continue
      out.add(resolve(isAbsolute(run.worktree) ? run.worktree : join(root, run.worktree)))
    } catch {
      // Ignore malformed historical run records.
    }
  }
  return out
}

function planWorktrees(
  root: string,
  thresholdBytes: number,
): { bytes: number; planned: StorageEntry[]; protectedRunning: StorageEntry[] } {
  const dir = join(root, 'cron-worktrees')
  const bytes = sizeOfPath(dir)
  const protectedPaths = runningWorktrees(root)
  const planned: StorageEntry[] = []
  const protectedRunning: StorageEntry[] = []

  if (bytes <= thresholdBytes) return { bytes, planned, protectedRunning }

  let projected = bytes
  for (const entry of immediateDirs(dir).sort((a, b) => a.bytes - b.bytes)) {
    if (protectedPaths.has(resolve(entry.path))) {
      protectedRunning.push(entry)
      continue
    }
    if (projected <= thresholdBytes) break
    planned.push(entry)
    projected -= entry.bytes
  }
  return { bytes, planned, protectedRunning }
}

function findCheckpointTmpObjects(dir: string): StorageEntry[] {
  const out: StorageEntry[] = []
  for (const child of safeChildren(dir)) {
    const path = join(dir, child)
    try {
      const st = lstatSync(path)
      if (st.isDirectory() && !st.isSymbolicLink()) out.push(...findCheckpointTmpObjects(path))
      else if (st.isFile() && basename(path).startsWith('tmp_obj_'))
        out.push({ path, bytes: st.size })
    } catch {
      // Best-effort cleanup list.
    }
  }
  return out
}

function checkpointRepos(dir: string, thresholdBytes: number): StorageEntry[] {
  if (sizeOfPath(dir) < thresholdBytes) return []
  return immediateDirs(dir).filter((entry) => existsSync(join(entry.path, 'objects')))
}

function removeEntry(root: string, entry: StorageEntry): boolean {
  if (!isInside(root, entry.path)) return false
  rmSync(entry.path, { recursive: true, force: true })
  return !existsSync(entry.path)
}

/**
 * The cron-worktrees entries are REGISTERED git worktrees, not loose dirs — so
 * deleting the directory leaves `.git/worktrees/<name>` behind and git keeps
 * treating the branch as checked out (it then refuses to reuse or delete it).
 * Resolve each one's owning repo BEFORE removal so we can prune afterwards.
 */
export function worktreeOwnerRepo(worktreePath: string): string {
  try {
    return execFileSync('git', ['-C', worktreePath, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim()
  } catch {
    return '' // not a worktree (or already broken) — nothing to prune
  }
}

function pruneWorktreeOwners(gitDirs: Set<string>): void {
  for (const gitDir of gitDirs) {
    if (!gitDir) continue
    try {
      execFileSync('git', ['--git-dir', gitDir, 'worktree', 'prune'], {
        stdio: 'ignore',
        timeout: 30_000,
      })
    } catch {
      // Best-effort: a stale registration is untidy, not dangerous.
    }
  }
}

function gitGc(repo: StorageEntry): CheckpointGcEntry {
  try {
    execFileSync('git', ['--git-dir', repo.path, 'gc', '--prune=now'], {
      stdio: 'ignore',
      timeout: 120_000,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    })
    return { path: repo.path, bytes: sizeOfPath(repo.path) }
  } catch (e) {
    return { ...repo, error: (e as Error).message }
  }
}

export function sweepTerminalState(
  root = terminalConfigRoot(),
  options: TerminalStateSweepOptions = {},
): TerminalStateSweepReport {
  const dryRun = options.dryRun ?? true
  const cronWorktreesMaxBytes = options.cronWorktreesMaxBytes ?? DEFAULT_CRON_WORKTREES_MAX_BYTES
  const checkpointGcMinBytes = options.checkpointGcMinBytes ?? DEFAULT_CHECKPOINT_GC_MIN_BYTES
  const checkpointDir = join(root, 'checkpoints')
  const scratchDir = join(root, 'scratch')
  const worktrees = planWorktrees(root, cronWorktreesMaxBytes)
  const tmpObjects = findCheckpointTmpObjects(checkpointDir)
  const gcRepos = checkpointRepos(checkpointDir, checkpointGcMinBytes)
  const deletedWorktrees: StorageEntry[] = []
  const deletedTmpObjects: StorageEntry[] = []
  const completedGc: CheckpointGcEntry[] = []

  if (!dryRun) {
    // Resolve owners first — once the directory is gone, the link back to the
    // repo that registered it is gone too.
    const owners = new Set(worktrees.planned.map((entry) => worktreeOwnerRepo(entry.path)))
    for (const entry of worktrees.planned) {
      if (removeEntry(root, entry)) deletedWorktrees.push(entry)
    }
    if (deletedWorktrees.length) pruneWorktreeOwners(owners)
    for (const entry of tmpObjects) {
      if (removeEntry(root, entry)) deletedTmpObjects.push(entry)
    }
    for (const repo of gcRepos) completedGc.push(gitGc(repo))
  }

  const reclaimableBytes =
    worktrees.planned.reduce((sum, item) => sum + item.bytes, 0) +
    tmpObjects.reduce((sum, item) => sum + item.bytes, 0)

  return {
    root,
    dryRun,
    totalBytes: sizeOfPath(root),
    reclaimableBytes,
    reclaimedBytes:
      deletedWorktrees.reduce((sum, item) => sum + item.bytes, 0) +
      deletedTmpObjects.reduce((sum, item) => sum + item.bytes, 0),
    worktrees: {
      bytes: worktrees.bytes,
      thresholdBytes: cronWorktreesMaxBytes,
      planned: worktrees.planned,
      deleted: deletedWorktrees,
      protectedRunning: worktrees.protectedRunning,
    },
    checkpoints: {
      bytes: sizeOfPath(checkpointDir),
      thresholdBytes: checkpointGcMinBytes,
      gc: { planned: gcRepos, completed: completedGc },
      tmpObjects: { planned: tmpObjects, deleted: deletedTmpObjects },
    },
    scratch: {
      bytes: sizeOfPath(scratchDir),
      clearable: existsSync(scratchDir),
    },
  }
}

export function clearTerminalScratch(root = terminalConfigRoot()): ScratchClearReport {
  const scratchDir = join(root, 'scratch')
  const bytes = sizeOfPath(scratchDir)
  if (!existsSync(scratchDir)) return { path: scratchDir, bytes: 0, deleted: false }
  mkdirSync(root, { recursive: true })
  rmSync(scratchDir, { recursive: true, force: true })
  return { path: scratchDir, bytes, deleted: !existsSync(scratchDir) }
}
