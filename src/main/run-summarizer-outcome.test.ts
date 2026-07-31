import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OUTCOME_HOURLY_CAP,
  OUTCOME_MIN_LOG_CHARS,
  outcomeSummariesDir,
  queueRunOutcomeSummary,
  readOutcomeSummaries,
  readOutcomeSummary,
  shouldSummarizeRun,
  summarizeRunOutcome,
  writeOutcomeSummary,
} from './run-summarizer'

// TERMINAL_RUN_SUMMARIES_DIR is resolved per call — nothing here can reach the
// operator's real ~/.config/TerMinal.
let dir = ''
const realDir = process.env.TERMINAL_RUN_SUMMARIES_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-run-summaries-'))
  process.env.TERMINAL_RUN_SUMMARIES_DIR = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (realDir === undefined) delete process.env.TERMINAL_RUN_SUMMARIES_DIR
  else process.env.TERMINAL_RUN_SUMMARIES_DIR = realDir
})

const gate = (over: Record<string, unknown> = {}) =>
  shouldSummarizeRun({
    status: 'done',
    logChars: OUTCOME_MIN_LOG_CHARS + 1,
    alreadySummarized: false,
    summariesInWindow: 0,
    ...over,
  })

describe('outcomeSummariesDir', () => {
  test('resolves to the injected dir, not the real config dir', () => {
    expect(outcomeSummariesDir()).toBe(dir)
  })
})

describe('shouldSummarizeRun', () => {
  test('summarizes a settled run with a substantial log', () => {
    expect(gate().ok).toBe(true)
  })

  test('never summarizes a run that is still going', () => {
    expect(gate({ status: 'running' })).toMatchObject({ ok: false })
  })

  test('summarizes failed/canceled runs too — the Runs row wants an outcome either way', () => {
    expect(gate({ status: 'failed' }).ok).toBe(true)
    expect(gate({ status: 'canceled' }).ok).toBe(true)
    expect(gate({ status: 'interrupted' }).ok).toBe(true)
  })

  test('skips a log too short to be worth a model call', () => {
    expect(gate({ logChars: OUTCOME_MIN_LOG_CHARS - 1 })).toMatchObject({ ok: false })
    expect(gate({ logChars: 0 })).toMatchObject({ ok: false })
  })

  test('never re-summarizes — a run is summarized at most once', () => {
    expect(gate({ alreadySummarized: true })).toMatchObject({ ok: false })
  })

  test('stops at the hourly cost cap', () => {
    expect(gate({ summariesInWindow: OUTCOME_HOURLY_CAP - 1 }).ok).toBe(true)
    expect(gate({ summariesInWindow: OUTCOME_HOURLY_CAP })).toMatchObject({ ok: false })
    expect(gate({ summariesInWindow: OUTCOME_HOURLY_CAP + 99 })).toMatchObject({ ok: false })
  })

  test('every rejection explains itself', () => {
    for (const r of [
      gate({ status: 'running' }),
      gate({ logChars: 1 }),
      gate({ alreadySummarized: true }),
      gate({ summariesInWindow: OUTCOME_HOURLY_CAP }),
    ]) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('the outcome summary store', () => {
  test('round-trips a summary and reports undefined for an unknown run', () => {
    writeOutcomeSummary('run-1', 'Fixed the flaky drift test.')
    expect(readOutcomeSummary('run-1')).toBe('Fixed the flaky drift test.')
    expect(readOutcomeSummary('nope')).toBeUndefined()
  })

  test('bulk read returns a lookup keyed by run id', () => {
    writeOutcomeSummary('a', 'did a')
    writeOutcomeSummary('b', 'did b')
    const all = readOutcomeSummaries()
    expect(all.get('a')).toBe('did a')
    expect(all.get('b')).toBe('did b')
  })

  test('refuses run ids that would escape the store directory', () => {
    expect(writeOutcomeSummary('../../etc/passwd', 'nope')).toBe(false)
    expect(readOutcomeSummary('../../etc/passwd')).toBeUndefined()
  })

  test('an empty summary is not stored', () => {
    expect(writeOutcomeSummary('run-1', '   ')).toBe(false)
    expect(readOutcomeSummary('run-1')).toBeUndefined()
  })

  test('a missing store dir reads as empty, not a throw', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(readOutcomeSummaries().size).toBe(0)
    expect(readOutcomeSummary('a')).toBeUndefined()
  })
})

describe('summarizeRunOutcome', () => {
  const longLog = 'step\n'.repeat(400)

  test('stores the model summary, trimmed and length-capped', async () => {
    const text = await summarizeRunOutcome({
      runId: 'r1',
      rawLog: longLog,
      call: async () => '  Refactored the schedule router and added two tests.  ',
    })
    expect(text).toBe('Refactored the schedule router and added two tests.')
    expect(readOutcomeSummary('r1')).toBe('Refactored the schedule router and added two tests.')
  })

  test('a thrown model call yields no summary and no throw', async () => {
    const text = await summarizeRunOutcome({
      runId: 'r1',
      rawLog: longLog,
      call: async () => {
        throw new Error('claude CLI not installed')
      },
    })
    expect(text).toBeNull()
    expect(readOutcomeSummary('r1')).toBeUndefined()
  })

  test('an empty model response yields no summary', async () => {
    const text = await summarizeRunOutcome({ runId: 'r1', rawLog: longLog, call: async () => '' })
    expect(text).toBeNull()
    expect(readOutcomeSummary('r1')).toBeUndefined()
  })
})

describe('queueRunOutcomeSummary', () => {
  const longLog = 'step\n'.repeat(400)

  test('is fire-and-forget: returns synchronously and never throws', () => {
    expect(() =>
      queueRunOutcomeSummary({
        runId: 'r1',
        status: 'done',
        readLog: () => {
          throw new Error('log gone')
        },
      }),
    ).not.toThrow()
  })

  test('writes a summary for a gated-in run', async () => {
    queueRunOutcomeSummary({
      runId: 'r1',
      status: 'done',
      readLog: () => longLog,
      call: async () => 'Did the thing.',
    })
    await Bun.sleep(10)
    expect(readOutcomeSummary('r1')).toBe('Did the thing.')
  })

  test('does not call the model for a run that fails the gate', async () => {
    let called = 0
    queueRunOutcomeSummary({
      runId: 'r1',
      status: 'running',
      readLog: () => longLog,
      call: async () => {
        called++
        return 'nope'
      },
    })
    await Bun.sleep(10)
    expect(called).toBe(0)
    expect(readOutcomeSummary('r1')).toBeUndefined()
  })

  test('does not re-summarize a run that already has a summary', async () => {
    writeOutcomeSummary('r1', 'already here')
    let called = 0
    queueRunOutcomeSummary({
      runId: 'r1',
      status: 'done',
      readLog: () => longLog,
      call: async () => {
        called++
        return 'replacement'
      },
    })
    await Bun.sleep(10)
    expect(called).toBe(0)
    expect(readOutcomeSummary('r1')).toBe('already here')
  })
})
