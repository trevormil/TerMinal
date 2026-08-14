import { describe, expect, test } from 'bun:test'
import { SCORECARD_WINDOW, scoreAgentRuns } from './agent-scorecard'
import type { ScorecardRun } from './agent-scorecard'

const run = (over: Partial<ScorecardRun> & { id: string }): ScorecardRun => ({
  agentId: 'a',
  agentTitle: 'Agent A',
  status: 'done',
  startedAt: 1000,
  ...over,
})

describe('scoreAgentRuns', () => {
  test('success rate counts settled runs only — running runs are excluded', () => {
    const s = scoreAgentRuns([
      run({ id: '1', status: 'done' }),
      run({ id: '2', status: 'done' }),
      run({ id: '3', status: 'failed' }),
      run({ id: '4', status: 'running' }),
    ])
    expect(s.total).toBe(4)
    expect(s.done).toBe(2)
    expect(s.failed).toBe(1)
    expect(s.running).toBe(1)
    // 2/3 settled, not 2/4
    expect(s.successRate).toBe(67)
  })

  test('canceled and interrupted runs count as unsuccessful settled runs', () => {
    const s = scoreAgentRuns([
      run({ id: '1', status: 'done' }),
      run({ id: '2', status: 'canceled' }),
      run({ id: '3', status: 'interrupted' }),
    ])
    expect(s.successRate).toBe(33)
    expect(s.failed).toBe(2)
  })

  test('no settled runs yields a null success rate rather than a misleading 0%', () => {
    const s = scoreAgentRuns([run({ id: '1', status: 'running' })])
    expect(s.successRate).toBeNull()
  })

  test('averages cost and duration over only the runs that report them', () => {
    const s = scoreAgentRuns([
      run({ id: '1', startedAt: 0, endedAt: 2000, costUsd: 0.1 }),
      run({ id: '2', startedAt: 0, endedAt: 4000, costUsd: 0.3 }),
      // no cost, no end — must not drag either average toward zero
      run({ id: '3', startedAt: 0, status: 'running' }),
    ])
    expect(s.avgCostUsd).toBeCloseTo(0.2, 10)
    expect(s.totalCostUsd).toBeCloseTo(0.4, 10)
    expect(s.avgDurationMs).toBe(3000)
  })

  test('leaves averages undefined when nothing reports cost or duration', () => {
    const s = scoreAgentRuns([run({ id: '1', status: 'running' })])
    expect(s.avgCostUsd).toBeUndefined()
    expect(s.avgDurationMs).toBeUndefined()
  })

  test('breaks down evaluation verdicts and ranks the failing checks', () => {
    const s = scoreAgentRuns([
      run({
        id: '1',
        evaluation: {
          status: 'fail',
          checks: [
            { id: 'tc', title: 'typecheck', status: 'fail' },
            { id: 'fmt', title: 'format', status: 'pass' },
          ],
        },
      }),
      run({
        id: '2',
        evaluation: {
          status: 'incomplete',
          checks: [
            { id: 'tc', title: 'typecheck', status: 'fail' },
            { id: 'test', title: 'tests', status: 'fail' },
          ],
        },
      }),
      run({ id: '3', evaluation: { status: 'pass', checks: [] } }),
      run({ id: '4' }),
    ])
    expect(s.evaluated).toBe(3)
    expect(s.evalPass).toBe(1)
    expect(s.evalFail).toBe(1)
    expect(s.evalIncomplete).toBe(1)
    expect(s.failingChecks).toEqual([
      { id: 'tc', title: 'typecheck', count: 2 },
      { id: 'test', title: 'tests', count: 1 },
    ])
  })

  test('considers only the most recent SCORECARD_WINDOW runs', () => {
    // 40 runs: the 35 newest are done, the 5 oldest failed. A 30-run window
    // must not see any of the old failures.
    const runs: ScorecardRun[] = []
    for (let i = 0; i < 40; i++) {
      runs.push(run({ id: String(i), startedAt: i, status: i < 5 ? 'failed' : 'done' }))
    }
    const s = scoreAgentRuns(runs)
    expect(SCORECARD_WINDOW).toBe(30)
    expect(s.total).toBe(30)
    expect(s.failed).toBe(0)
    expect(s.successRate).toBe(100)
  })

  test('reports the newest run regardless of input order', () => {
    const s = scoreAgentRuns([
      run({ id: 'old', startedAt: 10, status: 'done' }),
      run({ id: 'new', startedAt: 99, status: 'failed' }),
    ])
    expect(s.lastRunAt).toBe(99)
    expect(s.lastStatus).toBe('failed')
  })

  test('an empty run list is a zeroed scorecard, not a throw', () => {
    const s = scoreAgentRuns([])
    expect(s.total).toBe(0)
    expect(s.successRate).toBeNull()
    expect(s.failingChecks).toEqual([])
  })
})
