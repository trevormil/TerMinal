import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Ticket 91: the run store extracted from agents.ts. First direct tests of the
// startup-load semantics (orphan marking, live-run precedence) — untestable in
// place because agents.ts drags in the whole spawn runtime.
//
// loadPersistedRuns is once-per-process by design (the app calls it at
// startup), so the sandbox config dir is pinned BEFORE the module import and
// the load assertions all run against that one load.

const cfg = mkdtempSync(join(tmpdir(), 'tm-run-store-'))
const realDir = process.env.TERMINAL_CONFIG_DIR
process.env.TERMINAL_CONFIG_DIR = cfg

const runsDir = join(cfg, 'agent-runs')
mkdirSync(runsDir, { recursive: true })

const meta = (id: string, status: string, startedAt: number) => ({
  id,
  agentId: 'a',
  title: 'T',
  status,
  startedAt,
  repoRoot: '/tmp/x',
})

writeFileSync(join(runsDir, 'old-done.json'), JSON.stringify(meta('old-done', 'done', 1000)))
writeFileSync(join(runsDir, 'orphaned.json'), JSON.stringify(meta('orphaned', 'running', 2000)))
writeFileSync(join(runsDir, 'orphaned.log'), 'partial output')
writeFileSync(join(runsDir, 'corrupt.json'), '{nope')

const store = await import('./agent-run-store')

afterAll(() => {
  rmSync(cfg, { recursive: true, force: true })
  if (realDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realDir
})

describe('loadPersistedRuns', () => {
  test('runs still marked running were orphaned by a quit — loaded as interrupted, corrected on disk', () => {
    const list = store.listRuns()
    const orphan = list.find((r) => r.id === 'orphaned')
    expect(orphan?.status).toBe('interrupted')
    expect(orphan?.output).toBe('partial output')
    // The corrected status is persisted, not just in memory.
    expect(JSON.parse(readFileSync(join(runsDir, 'orphaned.json'), 'utf8')).status).toBe(
      'interrupted',
    )
  })

  test('corrupt metadata is skipped, not fatal', () => {
    expect(store.listRuns().find((r) => r.id === 'corrupt')).toBeUndefined()
  })

  test('listRuns sorts newest-first', () => {
    const ids = store.listRuns().map((r) => r.id)
    expect(ids.indexOf('orphaned')).toBeLessThan(ids.indexOf('old-done'))
  })
})

describe('live tracking + persistence', () => {
  test('trackRun/getRun roundtrip; persistRunMeta strips the output field', () => {
    const run = { ...meta('live-1', 'running', 3000), output: 'x'.repeat(50) }
    store.trackRun(run as never)
    expect(store.getRun('live-1')?.id).toBe('live-1')
    store.persistRunMeta(run as never)
    const onDisk = JSON.parse(readFileSync(join(runsDir, 'live-1.json'), 'utf8'))
    expect(onDisk.output).toBeUndefined()
    expect(onDisk.status).toBe('running')
  })

  test('appendRunLog accumulates and readAgentRunLog reads it back', () => {
    store.appendRunLog('live-1', 'hello ')
    store.appendRunLog('live-1', 'world')
    expect(store.readAgentRunLog('live-1')).toBe('hello world')
    expect(store.readAgentRunLog('never-existed')).toBe('')
  })

  test('the event seam delivers through whatever sink is bound', () => {
    const seen: [string, unknown][] = []
    store.onAgentEvent((ch, p) => seen.push([ch, p]))
    store.emitAgent('agent:status', { id: 'live-1' })
    expect(seen).toEqual([['agent:status', { id: 'live-1' }]])
  })
})
