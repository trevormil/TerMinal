import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// cron-runs transitively imports events.ts, which imports electron. Same stub
// the neighbouring cron-runs.test.ts uses.
mock.module('electron', () => ({
  Notification: class {
    static isSupported() {
      return false
    }
    show() {}
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

const { readOutcomeSummary, writeOutcomeSummary } = await import('./run-summarizer')

// readCronRuns memoizes its listing for 3s and the cache is not keyed by
// directory, so each test gets a fresh module instance — same trick the
// neighbouring cron-runs.test.ts uses.
type CronRunsModule = typeof import('./cron-runs')
let sweepCronRunSummaries: CronRunsModule['sweepCronRunSummaries']
let loadN = 0

// Both stores are redirected to temp dirs — nothing here reads or writes the
// operator's real ~/.config/TerMinal.
let runsDir = ''
let summariesDir = ''
const realRuns = process.env.TERMINAL_CRON_RUNS_DIR
const realSummaries = process.env.TERMINAL_RUN_SUMMARIES_DIR

beforeEach(async () => {
  runsDir = mkdtempSync(join(tmpdir(), 'tm-cron-runs-'))
  summariesDir = mkdtempSync(join(tmpdir(), 'tm-cron-summaries-'))
  process.env.TERMINAL_CRON_RUNS_DIR = runsDir
  process.env.TERMINAL_RUN_SUMMARIES_DIR = summariesDir
  const mod = (await import(`./cron-runs.ts?t=${loadN++}`)) as CronRunsModule
  sweepCronRunSummaries = mod.sweepCronRunSummaries
})

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true })
  rmSync(summariesDir, { recursive: true, force: true })
  for (const [k, v] of [
    ['TERMINAL_CRON_RUNS_DIR', realRuns],
    ['TERMINAL_RUN_SUMMARIES_DIR', realSummaries],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const NOW = 1_800_000_000_000
const LONG_LOG = 'building the thing\n'.repeat(200)

function seedRun(id: string, over: Record<string, unknown> = {}): void {
  writeFileSync(
    join(runsDir, `${id}.json`),
    JSON.stringify({
      id,
      scheduleId: 's1',
      agentId: 'a1',
      agentTitle: 'Nightly audit',
      engine: 'codex',
      status: 'done',
      startedAt: NOW - 60_000,
      endedAt: NOW - 30_000,
      branch: 'main',
      repoLabel: 'TerMinal',
      worktree: '/tmp/wt',
      ...over,
    }),
  )
  writeFileSync(join(runsDir, `${id}.log`), LONG_LOG)
}

describe('sweepCronRunSummaries', () => {
  test('summarizes a recently settled cron run', async () => {
    seedRun('run-a')
    const res = sweepCronRunSummaries({
      now: NOW,
      call: async () => 'Audited 12 files, 0 findings.',
    })
    expect(res.queued).toBe(1)
    await Bun.sleep(15)
    expect(readOutcomeSummary('run-a')).toBe('Audited 12 files, 0 findings.')
  })

  test('skips a run that is still running', () => {
    seedRun('run-a', { status: 'running', endedAt: undefined })
    expect(sweepCronRunSummaries({ now: NOW }).queued).toBe(0)
  })

  test('skips a run that already has a summary', () => {
    seedRun('run-a')
    writeOutcomeSummary('run-a', 'already summarized')
    expect(sweepCronRunSummaries({ now: NOW }).queued).toBe(0)
  })

  test('skips runs older than the 24h window', () => {
    seedRun('run-old', { endedAt: NOW - 25 * 60 * 60 * 1000, startedAt: NOW - 26 * 60 * 60 * 1000 })
    expect(sweepCronRunSummaries({ now: NOW }).queued).toBe(0)
  })

  test('caps how many runs one sweep queues', () => {
    for (let i = 0; i < 40; i++) seedRun(`run-${i}`)
    expect(sweepCronRunSummaries({ now: NOW }).queued).toBe(20)
  })

  test('an empty runs dir is a no-op, not a throw', () => {
    expect(sweepCronRunSummaries({ now: NOW }).queued).toBe(0)
  })
})
