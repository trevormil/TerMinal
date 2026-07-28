import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearTerminalScratch, inMemoryWorkingSet, sweepTerminalState } from './run-retention'

const r = (id: string, startedAt: number) => ({ id, startedAt })

describe('inMemoryWorkingSet — bounds RAM, never deletes', () => {
  test('keeps the most recent N by startedAt (ascending order)', () => {
    const runs = [r('a', 1), r('b', 3), r('c', 2), r('d', 5), r('e', 4)]
    // most recent two are d(5) and e(4); returned ascending → [e, d]
    expect(inMemoryWorkingSet(runs, 2).map((x) => x.id)).toEqual(['e', 'd'])
  })
  test('keep >= length returns everything (sorted ascending by startedAt)', () => {
    const runs = [r('b', 3), r('a', 1), r('c', 2)]
    expect(inMemoryWorkingSet(runs, 10).map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })
  test('keep <= 0 loads ALL (unbounded retention)', () => {
    const runs = [r('a', 1), r('b', 2), r('c', 3)]
    expect(inMemoryWorkingSet(runs, 0)).toHaveLength(3)
    expect(inMemoryWorkingSet(runs, -1)).toHaveLength(3)
  })
  test('does not mutate the input array (no deletion side effects)', () => {
    const runs = [r('a', 3), r('b', 1)]
    const before = runs.map((x) => x.id)
    inMemoryWorkingSet(runs, 1)
    expect(runs.map((x) => x.id)).toEqual(before)
  })
})

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-retention-'))
  roots.push(root)
  return root
}

function writeBytes(path: string, bytes: number): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 'x'))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('sweepTerminalState', () => {
  test('dry-run reports reclaimable worktrees without deleting them', () => {
    const root = tempRoot()
    const worktree = join(root, 'cron-worktrees', 'done-run')
    writeBytes(join(worktree, 'big.bin'), 10)
    mkdirSync(join(root, 'cron-runs'), { recursive: true })
    writeFileSync(
      join(root, 'cron-runs', 'done.json'),
      JSON.stringify({ id: 'done', status: 'done', worktree }),
    )

    const report = sweepTerminalState(root, {
      dryRun: true,
      cronWorktreesMaxBytes: 1,
      checkpointGcMinBytes: 1,
    })

    expect(report.dryRun).toBe(true)
    expect(report.reclaimableBytes).toBeGreaterThanOrEqual(10)
    expect(report.worktrees.planned).toHaveLength(1)
    expect(report.worktrees.deleted).toHaveLength(0)
    expect(existsSync(worktree)).toBe(true)
  })

  test('reclaim deletes eligible cron worktrees but never running worktrees', () => {
    const root = tempRoot()
    const doneWorktree = join(root, 'cron-worktrees', 'done-run')
    const runningWorktree = join(root, 'cron-worktrees', 'running-run')
    writeBytes(join(doneWorktree, 'big.bin'), 10)
    writeBytes(join(runningWorktree, 'big.bin'), 10)
    mkdirSync(join(root, 'cron-runs'), { recursive: true })
    writeFileSync(
      join(root, 'cron-runs', 'done.json'),
      JSON.stringify({ id: 'done', status: 'done', worktree: doneWorktree }),
    )
    writeFileSync(
      join(root, 'cron-runs', 'running.json'),
      JSON.stringify({ id: 'running', status: 'running', worktree: runningWorktree }),
    )

    const report = sweepTerminalState(root, {
      dryRun: false,
      cronWorktreesMaxBytes: 1,
      checkpointGcMinBytes: 1,
    })

    expect(report.worktrees.deleted.map((item) => item.path)).toEqual([doneWorktree])
    expect(report.worktrees.protectedRunning.map((item) => item.path)).toEqual([runningWorktree])
    expect(existsSync(doneWorktree)).toBe(false)
    expect(existsSync(runningWorktree)).toBe(true)
  })

  test('checkpoint pass removes interrupted git tmp objects only on reclaim', () => {
    const root = tempRoot()
    const tmpObject = join(root, 'checkpoints', 'repo.git', 'objects', '5e', 'tmp_obj_UcUQ2g')
    writeBytes(tmpObject, 7)

    const dry = sweepTerminalState(root, {
      dryRun: true,
      cronWorktreesMaxBytes: 1,
      checkpointGcMinBytes: 1,
    })
    expect(dry.checkpoints.tmpObjects.planned).toHaveLength(1)
    expect(existsSync(tmpObject)).toBe(true)

    const report = sweepTerminalState(root, {
      dryRun: false,
      cronWorktreesMaxBytes: 1,
      checkpointGcMinBytes: 1,
    })
    expect(report.checkpoints.tmpObjects.deleted.map((item) => item.path)).toEqual([tmpObject])
    expect(existsSync(tmpObject)).toBe(false)
  })

  test('reports scratch size without clearing it as part of reclaim', () => {
    const root = tempRoot()
    const scratchFile = join(root, 'scratch', 'keep.txt')
    writeBytes(scratchFile, 5)

    const report = sweepTerminalState(root, {
      dryRun: false,
      cronWorktreesMaxBytes: 1,
      checkpointGcMinBytes: 1,
    })

    expect(report.scratch.bytes).toBe(5)
    expect(report.scratch.clearable).toBe(true)
    expect(existsSync(scratchFile)).toBe(true)
  })

  test('clearTerminalScratch is a separate explicit delete action', () => {
    const root = tempRoot()
    const scratchFile = join(root, 'scratch', 'keep.txt')
    writeBytes(scratchFile, 5)

    const report = clearTerminalScratch(root)

    expect(report.bytes).toBe(5)
    expect(report.deleted).toBe(true)
    expect(existsSync(join(root, 'scratch'))).toBe(false)
  })
})
