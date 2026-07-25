import { test, expect, describe } from 'bun:test'
import { collectRemoteHitl, collectRemoteRuns, type RemoteRunHost } from './remote-runs'
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

  // A host that REJECTS was always handled. A host that simply never answers was
  // not: allSettled waits forever, so the caller's Promise.all never settles and
  // the view sits on "Loading…" indefinitely. Real cause: Tailscale SSH whose
  // auth had lapsed sat at an interactive "visit this URL" prompt that never
  // returned or failed.
  test('a host that never answers is dropped, not waited on forever', async () => {
    const hosts: RemoteRunHost[] = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'hung', label: 'Hung' },
    ]
    const { runs, errors } = await collectRemoteRuns(
      hosts,
      (h) => (h.id === 'hung' ? new Promise<UnifiedRun[]>(() => {}) : Promise.resolve([run('r1')])),
      { timeoutMs: 60 },
    )
    expect(runs).toHaveLength(1)
    expect(runs[0].hostId).toBe('alpha')
    expect(errors).toHaveLength(1)
    expect(errors[0].hostId).toBe('hung')
    expect(errors[0].error).toMatch(/timed out/i)
  })

  test('a slow-but-answering host still counts', async () => {
    const { runs, errors } = await collectRemoteRuns(
      [{ id: 'slow', label: 'Slow' }],
      () => new Promise((res) => setTimeout(() => res([run('r1')]), 10)),
      { timeoutMs: 500 },
    )
    expect(runs).toHaveLength(1)
    expect(errors).toEqual([])
  })
})

describe('collectRemoteHitl', () => {
  test('a hung host cannot stall the Inbox', async () => {
    const hosts: RemoteRunHost[] = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'hung', label: 'Hung' },
    ]
    const { items, errors } = await collectRemoteHitl(
      hosts,
      (h) =>
        h.id === 'hung' ? new Promise<never[]>(() => {}) : Promise.resolve([{ id: 'h1' } as never]),
      { timeoutMs: 60 },
    )
    expect(items).toHaveLength(1)
    expect(items[0].hostId).toBe('alpha')
    expect(errors[0].error).toMatch(/timed out/i)
  })
})
