import { test, expect, describe } from 'bun:test'
import { applySweepFinals } from './bg-sweep'
import type { BgTask } from './bg-tasks'

const task = (id: string, status: BgTask['status']): BgTask => ({
  id,
  repo: 'r',
  repoRoot: '/r',
  prompt: 'p',
  engine: 'codex',
  worktree: '/w',
  branch: 'b',
  status,
  startedAt: 1,
  logFile: '/l',
  label: id,
})

describe('applySweepFinals', () => {
  test('finalizes a still-running task and leaves a concurrently-spawned one untouched', () => {
    // Fresh disk read taken AFTER a new task was spawned mid-sweep.
    const fresh = [task('a', 'running'), task('new', 'running')]
    const finals = new Map([['a', { status: 'done' as const, endedAt: 99, mrUrl: 'http://pr/1' }]])
    const { tasks, changed } = applySweepFinals(fresh, finals)
    expect(changed).toBe(true)
    expect(tasks.find((t) => t.id === 'a')).toMatchObject({ status: 'done', endedAt: 99, mrUrl: 'http://pr/1' })
    // The task that appeared during the await must survive, still running.
    expect(tasks.find((t) => t.id === 'new')).toMatchObject({ status: 'running' })
  })

  test('does NOT re-finalize a task canceled while the sweep was awaiting', () => {
    const fresh = [task('a', 'canceled')]
    const finals = new Map([['a', { status: 'failed' as const, endedAt: 99 }]])
    const { tasks, changed } = applySweepFinals(fresh, finals)
    expect(changed).toBe(false)
    expect(tasks[0].status).toBe('canceled') // writer's state wins
  })

  test('a finalized task no longer on disk is simply dropped (no resurrection)', () => {
    const fresh: BgTask[] = []
    const finals = new Map([['gone', { status: 'failed' as const }]])
    const { tasks, changed } = applySweepFinals(fresh, finals)
    expect(changed).toBe(false)
    expect(tasks).toEqual([])
  })
})
