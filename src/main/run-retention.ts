import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { readJsonState, updateJsonState, writeFileAtomic, writeJsonAtomic } from './atomic-write'
import { resolvedWorktreesDir } from './settings'
import { promisify } from 'node:util'
import { terminalConfigDir } from './config-dir'

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

export type WorktreeStoreReport = {
  bytes: number
  thresholdBytes: number
  planned: StorageEntry[]
  deleted: StorageEntry[]
  protectedRunning: StorageEntry[]
  /** Held back because the worktree still has uncommitted work. */
  protectedDirty: StorageEntry[]
}

export type TerminalStateSweepReport = {
  root: string
  dryRun: boolean
  totalBytes: number
  reclaimableBytes: number
  reclaimedBytes: number
  worktrees: WorktreeStoreReport
  /** `<projectsDir>/.worktrees` — where agent/lane worktrees land (ticket 69 P8). */
  agentWorktrees: WorktreeStoreReport & { dir: string }
  /** Temp/lock/quarantine files the write path left behind. */
  leftovers: {
    bytes: number
    planned: StorageEntry[]
    deleted: StorageEntry[]
  }
  logs: {
    bytes: number
    maxBytes: number
    planned: StorageEntry[]
    rotated: StorageEntry[]
  }
  checkpoints: {
    bytes: number
    thresholdBytes: number
    /** Whole shadow repos aged out — the only prune checkpoints.ts ever had. */
    stores: {
      maxAgeMs: number
      planned: StorageEntry[]
      deleted: StorageEntry[]
    }
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
  /**
   * Age budget for worktrees. A finished worktree older than this is
   * reclaimable even when the store is under its size budget — the size-only
   * policy let 4.3 GB of old mirrors sit untouched until someone noticed.
   * Absent → age is not a reason to delete anything.
   */
  worktreeMaxAgeMs?: number
  /** `<projectsDir>/.worktrees`. Absent → that store is not swept at all. */
  agentWorktreesDir?: string
  /** Rotate cron.log / monitor.log above this size. */
  logMaxBytes?: number
  /** Drop a whole checkpoint shadow repo untouched for longer than this. */
  checkpointMaxAgeMs?: number
  /** Injectable so tests don't need real git repos. Defaults to `git status`. */
  isDirty?: (worktreePath: string) => Promise<boolean>
}

export type ScratchClearReport = {
  path: string
  bytes: number
  deleted: boolean
}

const GiB = 1024 * 1024 * 1024
const DEFAULT_CRON_WORKTREES_MAX_BYTES = GiB
const DEFAULT_CHECKPOINT_GC_MIN_BYTES = 256 * 1024 * 1024
const DEFAULT_LOG_MAX_BYTES = 2 * 1024 * 1024
// Deliberately conservative: a month is long past the point where anyone
// revisits a finished run's worktree, and the running/dirty guards still apply
// on top. Retention deletes user data — the default should feel boring.
const DEFAULT_WORKTREE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// Checkpoints are the undo button for agent turns, so this is deliberately
// slacker than the worktree budget: a quarter without a single checkpoint means
// nobody is going to roll that workspace back.
const DEFAULT_CHECKPOINT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

export function terminalConfigRoot(): string {
  return terminalConfigDir()
}

/**
 * `<projectsDir>/.worktrees`, or '' if settings can't be read.
 *
 * '' disables that half of the sweep, which is the right failure mode: without
 * a trustworthy root, deleting nothing beats deleting the wrong tree.
 */
function safeAgentWorktreesDir(): string {
  try {
    const dir = resolvedWorktreesDir()
    return dir && existsSync(dir) ? dir : ''
  } catch {
    return ''
  }
}

async function safeChildren(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

// One sweep walks the same subtrees several times over — the store total, then
// each child of that store, then the grand total at the end. On a 6.6 GB config
// dir that turned a scan into minutes of lstat churn. A sweep is a point-in-time
// snapshot anyway, so memoising every level makes the repeat walks free.
// Scoped per sweep, never module-global: a stale size would misreport a budget.
type SizeCache = Map<string, number>

// Walking a directory's children one `await` at a time serialises the whole
// tree behind single-file latency — the dominant cost on a config dir with
// hundreds of thousands of files. Children go out in bounded batches instead:
// enough concurrency to keep the syscall queue busy, capped so a deep tree
// can't open an unbounded number of handles.
const WALK_CONCURRENCY = 32

async function sizeOfPath(path: string, cache?: SizeCache): Promise<number> {
  const hit = cache?.get(path)
  if (hit !== undefined) return hit
  let total = 0
  try {
    const st = await lstat(path)
    if (!st.isDirectory() || st.isSymbolicLink()) {
      total = st.size
    } else {
      const children = await safeChildren(path)
      for (let i = 0; i < children.length; i += WALK_CONCURRENCY) {
        const batch = children.slice(i, i + WALK_CONCURRENCY)
        const sizes = await Promise.all(batch.map((c) => sizeOfPath(join(path, c), cache)))
        for (const n of sizes) total += n
      }
    }
  } catch {
    total = 0
  }
  cache?.set(path, total)
  return total
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

async function immediateDirs(dir: string, cache?: SizeCache): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (const child of await safeChildren(dir)) {
    const path = join(dir, child)
    try {
      const st = await lstat(path)
      if (!st.isDirectory() || st.isSymbolicLink()) continue
    } catch {
      continue
    }
    out.push({ path, bytes: await sizeOfPath(path, cache) })
  }
  return out
}

/**
 * Worktrees belonging to a run that is still `running`.
 *
 * Read from BOTH run stores: `cron-runs` (the launchd runner) and `agent-runs`
 * (in-app agent runs, which are what fill `<projectsDir>/.worktrees`). Missing
 * either one would let the sweep delete a worktree out from under a live run.
 */
async function runningWorktrees(root: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (const store of ['cron-runs', 'agent-runs']) {
    const runsDir = join(root, store)
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
  }
  return out
}

/** Leaf worktree dirs. `.worktrees` nests one level (`<repo>/<branch>`). */
async function worktreeCandidates(
  dir: string,
  nested: boolean,
  cache?: SizeCache,
): Promise<StorageEntry[]> {
  if (!nested) return immediateDirs(dir, cache)
  const out: StorageEntry[] = []
  for (const repo of await immediateDirs(dir, cache))
    out.push(...(await immediateDirs(repo.path, cache)))
  return out
}

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await lstat(path)).mtimeMs
  } catch {
    return Date.now()
  }
}

/**
 * Decide which worktrees in one store are reclaimable.
 *
 * Two independent triggers, and a worktree only has to fail one of them:
 * the store is over its size budget (smallest-first until back under), or the
 * worktree itself is older than the age budget. Running and dirty worktrees are
 * excluded before either trigger is considered — a reclaim must never touch work
 * in progress or uncommitted changes.
 */
async function planWorktreeStore(
  dir: string,
  opts: {
    thresholdBytes: number
    maxAgeMs?: number
    running: Set<string>
    isDirty?: (p: string) => Promise<boolean>
    nested?: boolean
    cache?: SizeCache
  },
): Promise<Omit<WorktreeStoreReport, 'deleted' | 'thresholdBytes'>> {
  const bytes = await sizeOfPath(dir, opts.cache)
  const planned: StorageEntry[] = []
  const protectedRunning: StorageEntry[] = []
  const protectedDirty: StorageEntry[] = []

  const candidates: StorageEntry[] = []
  for (const entry of await worktreeCandidates(dir, !!opts.nested, opts.cache)) {
    if (opts.running.has(resolve(entry.path))) {
      protectedRunning.push(entry)
      continue
    }
    if (opts.isDirty && (await opts.isDirty(entry.path))) {
      protectedDirty.push(entry)
      continue
    }
    candidates.push(entry)
  }

  const now = Date.now()
  const overSize = bytes > opts.thresholdBytes
  let projected = bytes
  for (const entry of candidates.sort((a, b) => a.bytes - b.bytes)) {
    const tooOld = opts.maxAgeMs !== undefined && now - (await mtimeOf(entry.path)) > opts.maxAgeMs
    const overBudget = overSize && projected > opts.thresholdBytes
    if (!tooOld && !overBudget) continue
    planned.push(entry)
    projected -= entry.bytes
  }
  return { bytes, planned, protectedRunning, protectedDirty }
}

/** `git status --porcelain` — non-empty means uncommitted work worth keeping. */
async function gitWorktreeDirty(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'status', '--porcelain'], {
      encoding: 'utf8',
      timeout: 15_000,
    })
    return stdout.trim().length > 0
  } catch {
    // Not a git worktree (or git is unhappy). Treat as clean: the caller's age
    // and running guards still apply, and refusing forever would defeat the GC.
    return false
  }
}

// --- write-path leftovers ----------------------------------------------------

const LEFTOVER_MIN_AGE_MS = 60 * 60 * 1000 // a .tmp/.lock younger than this may be live
const QUARANTINE_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000 // a .corrupt-* IS the lost data

/**
 * `*.tmp`, `*.lock`, `*.bak.*` and `*.corrupt-*` left beside state files.
 *
 * Age gates are the whole safety story here: a fresh `.lock` may be held by a
 * live writer, and a recent `.corrupt-*` is the ONLY surviving copy of whatever
 * was quarantined, so it gets a month before it is fair game.
 */
async function planLeftovers(root: string): Promise<StorageEntry[]> {
  const now = Date.now()
  const out: StorageEntry[] = []
  for (const child of await safeChildren(root)) {
    const isQuarantine = /\.corrupt-\d+$/.test(child)
    const isTemp = /\.tmp$/.test(child) || /\.lock$/.test(child) || /\.bak\.\d+$/.test(child)
    if (!isQuarantine && !isTemp) continue
    const path = join(root, child)
    try {
      const st = await lstat(path)
      if (!st.isFile()) continue
      const minAge = isQuarantine ? QUARANTINE_MIN_AGE_MS : LEFTOVER_MIN_AGE_MS
      if (now - st.mtimeMs < minAge) continue
      out.push({ path, bytes: st.size })
    } catch {
      // Vanished mid-scan.
    }
  }
  return out
}

// --- log rotation ------------------------------------------------------------

export type LogRotateResult = { path: string; rotated: boolean; bytes: number }

/**
 * Cap an append-only log, keeping the TAIL.
 *
 * The recent end is the part anyone debugs with, so the file is replaced by its
 * last `maxBytes` (cut at a line boundary) and the previous contents move to a
 * single `.1` sibling. One generation only: an unbounded rotation chain is just
 * the same disk leak with more filenames.
 */
export function rotateLogFile(file: string, maxBytes: number): LogRotateResult {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { path: file, rotated: false, bytes: 0 }
  }
  const bytes = Buffer.byteLength(raw)
  if (bytes <= maxBytes) return { path: file, rotated: false, bytes }
  let tail = raw.slice(-maxBytes)
  const nl = tail.indexOf('\n')
  if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1)
  writeFileAtomic(`${file}.1`, raw)
  writeFileAtomic(file, tail)
  return { path: file, rotated: true, bytes: bytes - Buffer.byteLength(tail) }
}

// --- hitl archival -----------------------------------------------------------

export type HitlArchiveResult = { archived: number; kept: number; archivePath: string | null }

/**
 * Move long-settled HITL items out of the live inbox into a dated archive.
 *
 * hitl.json is read and rewritten whole on every filing, so it has to stay
 * small — 3.2 MB / 53k lines was already the shape of the freeze fixed in #195.
 * Only READ items past the window move; an open item is somebody's outstanding
 * blocker and is never archived, however old. A corrupt inbox throws rather than
 * being "archived" into oblivion.
 */
export function archiveResolvedHitl(
  file: string,
  opts: { olderThanMs: number; now?: number },
): HitlArchiveResult {
  const now = opts.now ?? Date.now()
  const cutoff = now - opts.olderThanMs
  let result: HitlArchiveResult = { archived: 0, kept: 0, archivePath: null }

  updateJsonState<HitlArchiveRecord[]>(
    file,
    () => [],
    (list) => {
      const settled = (h: HitlArchiveRecord): boolean =>
        (!!h.readAt || h.status === 'resolved') &&
        (h.resolvedAt ?? h.readAt ?? h.createdAt ?? now) < cutoff
      const stale = list.filter(settled)
      const keep = list.filter((h) => !settled(h))
      if (!stale.length) {
        result = { archived: 0, kept: list.length, archivePath: null }
        return undefined
      }
      const day = new Date(now).toISOString().slice(0, 10)
      const dest = join(dirname(file), 'hitl-archive', `hitl-${day}.json`)
      // Append to the day's archive rather than replacing it — a second sweep on
      // the same day must not drop the first sweep's items.
      const existing = readJsonState<HitlArchiveRecord[]>(dest, () => [], {
        accept: Array.isArray,
      })
      writeJsonAtomic(dest, [...existing.value, ...stale])
      result = { archived: stale.length, kept: keep.length, archivePath: dest }
      return keep
    },
    { accept: Array.isArray },
  )
  return result
}

type HitlArchiveRecord = {
  status?: string
  readAt?: number
  resolvedAt?: number
  createdAt?: number
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

/**
 * Whole shadow repos nobody has checkpointed into for `maxAgeMs`.
 *
 * Deliberately coarse: dropping an entire unused store is safe, whereas
 * truncating history inside a live one would rewrite the checkpoint shas that
 * run records point at.
 */
async function staleCheckpointStores(
  dir: string,
  maxAgeMs: number,
  cache?: SizeCache,
): Promise<StorageEntry[]> {
  const now = Date.now()
  const out: StorageEntry[] = []
  for (const entry of await immediateDirs(dir, cache)) {
    if (now - (await mtimeOf(entry.path)) > maxAgeMs) out.push(entry)
  }
  return out
}

async function checkpointRepos(
  dir: string,
  thresholdBytes: number,
  cache?: SizeCache,
): Promise<StorageEntry[]> {
  if ((await sizeOfPath(dir, cache)) < thresholdBytes) return []
  return (await immediateDirs(dir, cache)).filter((entry) =>
    existsSync(join(entry.path, 'objects')),
  )
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
  const logMaxBytes = options.logMaxBytes ?? DEFAULT_LOG_MAX_BYTES
  const worktreeMaxAgeMs = options.worktreeMaxAgeMs ?? DEFAULT_WORKTREE_MAX_AGE_MS
  // Resolved here rather than passed in, so the sweep covers `.worktrees`
  // (ticket 69 P8) without every caller having to know about it.
  const agentWorktreesDir = options.agentWorktreesDir ?? safeAgentWorktreesDir()
  const running = await runningWorktrees(root)
  const sizes: SizeCache = new Map()
  const isDirty = options.isDirty ?? gitWorktreeDirty

  const worktrees = await planWorktreeStore(join(root, 'cron-worktrees'), {
    thresholdBytes: cronWorktreesMaxBytes,
    maxAgeMs: worktreeMaxAgeMs,
    running,
    cache: sizes,
  })
  // `.worktrees` holds hand-checked-out branches, so unlike cron worktrees it
  // gets the dirty check. Size is not a trigger there — only age.
  const agentWorktrees = agentWorktreesDir
    ? await planWorktreeStore(agentWorktreesDir, {
        thresholdBytes: Number.POSITIVE_INFINITY,
        maxAgeMs: worktreeMaxAgeMs,
        running,
        isDirty,
        nested: true,
        cache: sizes,
      })
    : { bytes: 0, planned: [], protectedRunning: [], protectedDirty: [] }

  const leftovers = await planLeftovers(root)
  const logFiles = [join(root, 'monitor.log'), join(root, 'cron.log')]
  const plannedLogs: StorageEntry[] = []
  for (const path of logFiles) {
    const bytes = await sizeOfPath(path, sizes)
    if (bytes > logMaxBytes) plannedLogs.push({ path, bytes: bytes - logMaxBytes })
  }

  const checkpointMaxAgeMs = options.checkpointMaxAgeMs ?? DEFAULT_CHECKPOINT_MAX_AGE_MS
  const staleStores = await staleCheckpointStores(checkpointDir, checkpointMaxAgeMs, sizes)
  const stalePaths = new Set(staleStores.map((e) => resolve(e.path)))
  const tmpObjects = (await findCheckpointTmpObjects(checkpointDir)).filter(
    (e) => ![...stalePaths].some((p) => isInside(p, e.path)),
  )
  // No point gc-ing a store that is about to be deleted outright.
  const gcRepos = (await checkpointRepos(checkpointDir, checkpointGcMinBytes, sizes)).filter(
    (e) => !stalePaths.has(resolve(e.path)),
  )
  const deletedWorktrees: StorageEntry[] = []
  const deletedAgentWorktrees: StorageEntry[] = []
  const deletedTmpObjects: StorageEntry[] = []
  const deletedLeftovers: StorageEntry[] = []
  const deletedStores: StorageEntry[] = []
  const rotatedLogs: StorageEntry[] = []
  const completedGc: CheckpointGcEntry[] = []

  if (!dryRun) {
    // Resolve owners first — once the directory is gone, the link back to the
    // repo that registered it is gone too.
    const owners = new Set<string>()
    for (const entry of [...worktrees.planned, ...agentWorktrees.planned])
      owners.add(await worktreeOwnerRepo(entry.path))
    for (const entry of worktrees.planned) {
      if (await removeEntry(root, entry)) deletedWorktrees.push(entry)
    }
    for (const entry of agentWorktrees.planned) {
      if (await removeEntry(agentWorktreesDir, entry)) deletedAgentWorktrees.push(entry)
    }
    if (deletedWorktrees.length || deletedAgentWorktrees.length) await pruneWorktreeOwners(owners)
    for (const entry of tmpObjects) {
      if (await removeEntry(root, entry)) deletedTmpObjects.push(entry)
    }
    for (const entry of leftovers) {
      if (await removeEntry(root, entry)) deletedLeftovers.push(entry)
    }
    for (const entry of plannedLogs) {
      const res = rotateLogFile(entry.path, logMaxBytes)
      if (res.rotated) rotatedLogs.push({ path: res.path, bytes: res.bytes })
    }
    for (const entry of staleStores) {
      if (await removeEntry(root, entry)) deletedStores.push(entry)
    }
    for (const repo of gcRepos) completedGc.push(await gitGc(repo))
  }

  const sum = (items: StorageEntry[]): number => items.reduce((n, i) => n + i.bytes, 0)
  const reclaimableBytes =
    sum(worktrees.planned) +
    sum(agentWorktrees.planned) +
    sum(tmpObjects) +
    sum(leftovers) +
    sum(plannedLogs) +
    sum(staleStores)

  return {
    root,
    dryRun,
    totalBytes: await sizeOfPath(root, dryRun ? sizes : undefined),
    reclaimableBytes,
    reclaimedBytes:
      sum(deletedWorktrees) +
      sum(deletedAgentWorktrees) +
      sum(deletedTmpObjects) +
      sum(deletedLeftovers) +
      sum(deletedStores) +
      sum(rotatedLogs),
    worktrees: {
      ...worktrees,
      thresholdBytes: cronWorktreesMaxBytes,
      deleted: deletedWorktrees,
    },
    agentWorktrees: {
      ...agentWorktrees,
      dir: agentWorktreesDir,
      thresholdBytes: Number.POSITIVE_INFINITY,
      deleted: deletedAgentWorktrees,
    },
    leftovers: {
      bytes: sum(leftovers),
      planned: leftovers,
      deleted: deletedLeftovers,
    },
    logs: {
      bytes: sum(plannedLogs),
      maxBytes: logMaxBytes,
      planned: plannedLogs,
      rotated: rotatedLogs,
    },
    checkpoints: {
      bytes: await sizeOfPath(checkpointDir, dryRun ? sizes : undefined),
      thresholdBytes: checkpointGcMinBytes,
      stores: { maxAgeMs: checkpointMaxAgeMs, planned: staleStores, deleted: deletedStores },
      gc: { planned: gcRepos, completed: completedGc },
      tmpObjects: { planned: tmpObjects, deleted: deletedTmpObjects },
    },
    scratch: {
      bytes: await sizeOfPath(scratchDir, dryRun ? sizes : undefined),
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
