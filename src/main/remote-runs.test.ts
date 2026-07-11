import { test, expect, describe } from 'bun:test'
import { collectRemoteRuns, type RemoteRunHost } from './remote-runs'
import type { UnifiedRun } from './cron-runs'

const run = (id: string): UnifiedRun => ({
  id,
  source: 'cron',
  agentId: 'a',
  agentTitle: 'A',
  engine: 'codex',
  status: 'done',
  startedAt: 1,
  repoRoot: '/r',
  repoLabel: 'r',
  branch: 'main',
  worktree: '/w',
})

describe('collectRemoteRuns', () => {
  test('stamps hostId/hostLabel onto each run', async () => {
    const hosts: RemoteRunHost[] = [{ id: 'alpha', label: 'Alpha' }]
    const { runs, errors } = await collectRemoteRuns(hosts, async () => [run('r1'), run('r2')])
    expect(errors).toEqual([])
    expect(runs).toHaveLength(2)
    expect(runs.every((r) => r.hostId === 'alpha' && r.hostLabel === 'Alpha')).toBe(true)
  })

  test('a failing host yields an error, not a rejected promise (best-effort)', async () => {
    const hosts: RemoteRunHost[] = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'bravo', label: 'Bravo' },
    ]
    const { runs, errors } = await collectRemoteRuns(hosts, async (h) => {
      if (h.id === 'bravo') throw new Error('ssh: connect timeout')
      return [run('r1')]
    })
    expect(runs).toHaveLength(1)
    expect(runs[0].hostId).toBe('alpha')
    expect(errors).toEqual([{ hostId: 'bravo', label: 'Bravo', error: 'ssh: connect timeout' }])
  })

  test('no hosts → empty result', async () => {
    const { runs, errors } = await collectRemoteRuns([], async () => [run('x')])
    expect(runs).toEqual([])
    expect(errors).toEqual([])
  })
})
