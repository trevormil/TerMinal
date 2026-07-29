import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

// The sweep walks ~/.config/TerMinal, which can hold hundreds of thousands of
// files (worktrees, checkpoint stores). Everything below is async fs on
// purpose: a sync walk runs on the Electron main process and blocks EVERY IPC
// for its duration — the whole app visibly hangs.
const execFileAsync = promisify(execFile)

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

async function safeChildren(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function sizeOfPath(path: string): Promise<number> {
  try {
    const st = await lstat(path)
    if (!st.isDirectory() || st.isSymbolicLink()) return st.size
    let total = 0
    for (const child of await safeChildren(path)) total += await sizeOfPath(join(path, child))
    return total
  } catch {
    return 0
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

async function immediateDirs(dir: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (const child of await safeChildren(dir)) {
    const path = join(dir, child)
    try {
      const st = await lstat(path)
      if (!st.isDirectory() || st.isSymbolicLink()) continue
    } catch {
      continue
    }
    out.push({ path, bytes: await sizeOfPath(path) })
  }
  return out
}

async function runningWorktrees(root: string): Promise<Set<string>> {
  const runsDir = join(root, 'cron-runs')
  const out = new Set<string>()
  for (const file of await safeChildren(runsDir)) {
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

async function planWorktrees(
  root: string,
  thresholdBytes: number,
): Promise<{ bytes: number; planned: StorageEntry[]; protectedRunning: StorageEntry[] }> {
  const dir = join(root, 'cron-worktrees')
  const bytes = await sizeOfPath(dir)
  const protectedPaths = await runningWorktrees(root)
  const planned: StorageEntry[] = []
  const protectedRunning: StorageEntry[] = []

  if (bytes <= thresholdBytes) return { bytes, planned, protectedRunning }

  let projected = bytes
  for (const entry of (await immediateDirs(dir)).sort((a, b) => a.bytes - b.bytes)) {
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

async function findCheckpointTmpObjects(dir: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (const child of await safeChildren(dir)) {
    const path = join(dir, child)
    try {
      const st = await lstat(path)
      if (st.isDirectory() && !st.isSymbolicLink())
        out.push(...(await findCheckpointTmpObjects(path)))
      else if (st.isFile() && basename(path).startsWith('tmp_obj_'))
        out.push({ path, bytes: st.size })
    } catch {
      // Best-effort cleanup list.
    }
  }
  return out
}

async function checkpointRepos(dir: string, thresholdBytes: number): Promise<StorageEntry[]> {
  if ((await sizeOfPath(dir)) < thresholdBytes) return []
  return (await immediateDirs(dir)).filter((entry) => existsSync(join(entry.path, 'objects')))
}

async function removeEntry(root: string, entry: StorageEntry): Promise<boolean> {
  if (!isInside(root, entry.path)) return false
  await rm(entry.path, { recursive: true, force: true })
  return !existsSync(entry.path)
}

/**
 * The cron-worktrees entries are REGISTERED git worktrees, not loose dirs — so
 * deleting the directory leaves `.git/worktrees/<name>` behind and git keeps
 * treating the branch as checked out (it then refuses to reuse or delete it).
 * Resolve each one's owning repo BEFORE removal so we can prune afterwards.
 */
export async function worktreeOwnerRepo(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    return stdout.trim()
  } catch {
    return '' // not a worktree (or already broken) — nothing to prune
  }
}

async function pruneWorktreeOwners(gitDirs: Set<string>): Promise<void> {
  for (const gitDir of gitDirs) {
    if (!gitDir) continue
    try {
      await execFileAsync('git', ['--git-dir', gitDir, 'worktree', 'prune'], {
        timeout: 30_000,
      })
    } catch {
      // Best-effort: a stale registration is untidy, not dangerous.
    }
  }
}

async function gitGc(repo: StorageEntry): Promise<CheckpointGcEntry> {
  try {
    await execFileAsync('git', ['--git-dir', repo.path, 'gc', '--prune=now'], {
      timeout: 120_000,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    })
    return { path: repo.path, bytes: await sizeOfPath(repo.path) }
  } catch (e) {
    return { ...repo, error: (e as Error).message }
  }
}

export async function sweepTerminalState(
  root = terminalConfigRoot(),
  options: TerminalStateSweepOptions = {},
): Promise<TerminalStateSweepReport> {
  const dryRun = options.dryRun ?? true
  const cronWorktreesMaxBytes = options.cronWorktreesMaxBytes ?? DEFAULT_CRON_WORKTREES_MAX_BYTES
  const checkpointGcMinBytes = options.checkpointGcMinBytes ?? DEFAULT_CHECKPOINT_GC_MIN_BYTES
  const checkpointDir = join(root, 'checkpoints')
  const scratchDir = join(root, 'scratch')
  const worktrees = await planWorktrees(root, cronWorktreesMaxBytes)
  const tmpObjects = await findCheckpointTmpObjects(checkpointDir)
  const gcRepos = await checkpointRepos(checkpointDir, checkpointGcMinBytes)
  const deletedWorktrees: StorageEntry[] = []
  const deletedTmpObjects: StorageEntry[] = []
  const completedGc: CheckpointGcEntry[] = []

  if (!dryRun) {
    // Resolve owners first — once the directory is gone, the link back to the
    // repo that registered it is gone too.
    const owners = new Set<string>()
    for (const entry of worktrees.planned) owners.add(await worktreeOwnerRepo(entry.path))
    for (const entry of worktrees.planned) {
      if (await removeEntry(root, entry)) deletedWorktrees.push(entry)
    }
    if (deletedWorktrees.length) await pruneWorktreeOwners(owners)
    for (const entry of tmpObjects) {
      if (await removeEntry(root, entry)) deletedTmpObjects.push(entry)
    }
    for (const repo of gcRepos) completedGc.push(await gitGc(repo))
  }

  const reclaimableBytes =
    worktrees.planned.reduce((sum, item) => sum + item.bytes, 0) +
    tmpObjects.reduce((sum, item) => sum + item.bytes, 0)

  return {
    root,
    dryRun,
    totalBytes: await sizeOfPath(root),
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
      bytes: await sizeOfPath(checkpointDir),
      thresholdBytes: checkpointGcMinBytes,
      gc: { planned: gcRepos, completed: completedGc },
      tmpObjects: { planned: tmpObjects, deleted: deletedTmpObjects },
    },
    scratch: {
      bytes: await sizeOfPath(scratchDir),
      clearable: existsSync(scratchDir),
    },
  }
}

export async function clearTerminalScratch(
  root = terminalConfigRoot(),
): Promise<ScratchClearReport> {
  const scratchDir = join(root, 'scratch')
  const bytes = await sizeOfPath(scratchDir)
  if (!existsSync(scratchDir)) return { path: scratchDir, bytes: 0, deleted: false }
  mkdirSync(root, { recursive: true })
  await rm(scratchDir, { recursive: true, force: true })
  return { path: scratchDir, bytes, deleted: !existsSync(scratchDir) }
}
