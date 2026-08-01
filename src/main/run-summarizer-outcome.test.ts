import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OUTCOME_HOURLY_CAP,
  OUTCOME_MIN_LOG_CHARS,
  outcomeSummariesDir,
  pruneOutcomeSummaries,
  queueRunOutcomeSummary,
  readOutcomeSummaries,
  readOutcomeSummary,
  shouldSummarizeRun,
  summarizeRunOutcome,
  writeOutcomeSummary,
} from './run-summarizer'

// Resolved per call through configPath(); src/test-preload.ts also points the
// whole suite at a throwaway config dir, so nothing here can reach the
// operator's real ~/.config/TerMinal even if this block were forgotten.
let cfg = ''
let dir = ''
const realCfg = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  cfg = mkdtempSync(join(tmpdir(), 'tm-run-summaries-'))
  process.env.TERMINAL_CONFIG_DIR = cfg
  dir = join(cfg, 'run-summaries')
})

afterEach(() => {
  rmSync(cfg, { recursive: true, force: true })
  if (realCfg === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realCfg
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

  // Failed runs already get summarizeFailedRun() for their HITL entry. Ticket 81
  // required that path stay unchanged, so gating failures in here as well would
  // silently pay for a SECOND model call on the same log for every failure.
  test('does NOT summarize failed/canceled/interrupted runs — they would double-bill', () => {
    expect(gate({ status: 'failed' })).toMatchObject({ ok: false })
    expect(gate({ status: 'canceled' })).toMatchObject({ ok: false })
    expect(gate({ status: 'interrupted' })).toMatchObject({ ok: false })
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
      gate({ status: 'failed' }),
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
        call: async () => 'never reached',
      }),
    ).not.toThrow()
  })

  // "Fire-and-forget" is the whole safety property: a run completion must not
  // WAIT on a model call. not.toThrow() alone would still pass if the call were
  // awaited, so assert that queue() returns while the model is still in flight
  // and that it did not block for the model's duration.
  test('returns while the model call is still in flight, not merely without throwing', async () => {
    let resolved = false
    const t0 = Date.now()
    queueRunOutcomeSummary({
      runId: 'r1',
      status: 'done',
      readLog: () => longLog,
      call: async () => {
        await Bun.sleep(120)
        resolved = true
        return 'done later'
      },
    })
    const elapsed = Date.now() - t0
    // Returned promptly, with the model still running and nothing written yet.
    expect(elapsed).toBeLessThan(50)
    expect(resolved).toBe(false)
    expect(readOutcomeSummary('r1')).toBeUndefined()

    await Bun.sleep(200)
    expect(resolved).toBe(true)
    expect(readOutcomeSummary('r1')).toBe('done later')
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

// The cap is the cost control. Testing shouldSummarizeRun() alone proves the
// predicate, not the enforcement: the queue path used to check the on-disk count
// and then fire async, so a burst settling in one tick had every caller read the
// same count and every caller pass.
describe('the hourly cap under burst', () => {
  const longLog = 'step\n'.repeat(400)

  test('a single-tick burst of 80 runs never exceeds the cap', async () => {
    let called = 0
    for (let i = 0; i < 80; i++) {
      queueRunOutcomeSummary({
        runId: `burst-${i}`,
        status: 'done',
        readLog: () => longLog,
        call: async () => {
          called++
          return `summary ${i}`
        },
      })
    }
    await Bun.sleep(30)
    expect(called).toBe(OUTCOME_HOURLY_CAP)
    expect(readOutcomeSummaries().size).toBe(OUTCOME_HOURLY_CAP)
  })

  test('a run whose summary fails releases its slot for someone else', async () => {
    // Burn the whole cap on failing calls...
    for (let i = 0; i < OUTCOME_HOURLY_CAP; i++) {
      queueRunOutcomeSummary({
        runId: `fail-${i}`,
        status: 'done',
        readLog: () => longLog,
        call: async () => {
          throw new Error('model down')
        },
      })
    }
    await Bun.sleep(30)
    expect(readOutcomeSummaries().size).toBe(0)

    // ...and a later run can still be summarized, because the failures gave
    // their reservations back instead of holding the cap hostage for an hour.
    let called = false
    queueRunOutcomeSummary({
      runId: 'later',
      status: 'done',
      readLog: () => longLog,
      call: async () => {
        called = true
        return 'made it'
      },
    })
    await Bun.sleep(20)
    expect(called).toBe(true)
    expect(readOutcomeSummary('later')).toBe('made it')
  })

  test('an in-flight reservation blocks a duplicate queue for the same run', async () => {
    let called = 0
    const slow = async () => {
      called++
      await Bun.sleep(25)
      return 'first wins'
    }
    queueRunOutcomeSummary({ runId: 'dup', status: 'done', readLog: () => longLog, call: slow })
    queueRunOutcomeSummary({ runId: 'dup', status: 'done', readLog: () => longLog, call: slow })
    await Bun.sleep(60)
    expect(called).toBe(1)
    expect(readOutcomeSummary('dup')).toBe('first wins')
  })

  test('an in-flight reservation is invisible to readers until it is filled', async () => {
    queueRunOutcomeSummary({
      runId: 'pending',
      status: 'done',
      readLog: () => longLog,
      call: async () => {
        await Bun.sleep(25)
        return 'eventually'
      },
    })
    // Reserved on disk, but not yet a summary — the Runs row must not show a blank.
    expect(readOutcomeSummary('pending')).toBeUndefined()
    expect(readOutcomeSummaries().has('pending')).toBe(false)
    await Bun.sleep(50)
    expect(readOutcomeSummary('pending')).toBe('eventually')
  })
})

describe('pruneOutcomeSummaries', () => {
  test('drops summaries past the retention window and keeps recent ones', () => {
    writeOutcomeSummary('old', 'ancient')
    writeOutcomeSummary('new', 'fresh')
    const old = join(dir, 'old.txt')
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    utimesSync(old, past, past)

    const res = pruneOutcomeSummaries()
    expect(res.pruned).toBe(1)
    expect(readOutcomeSummary('old')).toBeUndefined()
    expect(readOutcomeSummary('new')).toBe('fresh')
  })

  test('a missing store is a no-op', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(pruneOutcomeSummaries().pruned).toBe(0)
  })
})

// Regression guard for the defect this whole store was rewritten around: a test
// that finalizes a run without injecting `call` reached the real cheapCall and
// shelled out to the operator's `claude` CLI after the test had returned.
describe('the default model route under the test runner', () => {
  test('refuses to shell out when no call is injected', async () => {
    const longLog = 'step\n'.repeat(400)
    // No `call` — exactly the shape that caused the incident.
    const text = await summarizeRunOutcome({ runId: 'unguarded', rawLog: longLog })
    expect(text).toBeNull()
    expect(readOutcomeSummary('unguarded')).toBeUndefined()
  })

  test('queueing without a call writes nothing and leaves no reservation behind', async () => {
    const longLog = 'step\n'.repeat(400)
    queueRunOutcomeSummary({ runId: 'unguarded2', status: 'done', readLog: () => longLog })
    await Bun.sleep(20)
    expect(readOutcomeSummary('unguarded2')).toBeUndefined()
    expect(readOutcomeSummaries().has('unguarded2')).toBe(false)
    // The slot was released, so a genuine summary can still be taken later.
    expect(existsSync(join(dir, 'unguarded2.txt'))).toBe(false)
  })
})
