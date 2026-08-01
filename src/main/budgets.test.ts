import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// budgets → hitl → events → electron. The gate is plain arithmetic over two
// files; it should not need a browser process to test.
void mock.module('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    show(): void {}
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

// Ticket 111. Every other guard in this area fails CLOSED; the budget gate was
// the one that failed OPEN, and it is the only one where guessing wrong spends
// real money. `catch { return DEFAULTS }` reads a torn budgets.json as
// "dailyTotalUsd: 0" — which is a real, valid configuration meaning "no cap" —
// so an unparseable file and a deliberately-uncapped account are indistinguishable.
//
// The distinction that matters is ABSENT (no cap configured — proceed, that is a
// real choice) vs PRESENT-BUT-UNREADABLE (refuse, we do not know the cap).

let dir: string
const prev = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-budgets-'))
  process.env.TERMINAL_CONFIG_DIR = dir
})
afterEach(() => {
  if (prev === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = prev
  rmSync(dir, { recursive: true, force: true })
})

const budgetsFile = (): string => join(dir, 'budgets.json')

async function budgets(): Promise<typeof import('./budgets')> {
  // Re-imported per test so nothing can cache a path from a previous temp dir.
  return import('./budgets')
}

describe('readBudgetsState distinguishes absent from unreadable (ticket 111)', () => {
  test('absent → not corrupt, defaults apply', async () => {
    const { readBudgetsState } = await budgets()
    const state = readBudgetsState()
    expect(state.corrupt).toBe(false)
    expect(state.budgets.dailyTotalUsd).toBe(0)
  })

  test('valid → not corrupt, values come through', async () => {
    writeFileSync(budgetsFile(), JSON.stringify({ dailyTotalUsd: 20 }))
    const { readBudgetsState } = await budgets()
    const state = readBudgetsState()
    expect(state.corrupt).toBe(false)
    expect(state.budgets.dailyTotalUsd).toBe(20)
    // Fields absent from the file still fall back to defaults.
    expect(state.budgets.warnAt.length).toBeGreaterThan(0)
  })

  test('a torn write → corrupt, and the cap is NOT reported as 0', async () => {
    // Exactly what a truncating writer leaves behind mid-crash.
    writeFileSync(budgetsFile(), '{"dailyTotalUsd": 20, "perAge')
    const { readBudgetsState } = await budgets()
    const state = readBudgetsState()
    expect(state.corrupt).toBe(true)
  })

  test('a parseable file of the wrong shape is corruption too', async () => {
    writeFileSync(budgetsFile(), '[]')
    const { readBudgetsState } = await budgets()
    expect(readBudgetsState().corrupt).toBe(true)
  })
})

describe('gateSpawn fails closed on unreadable budgets (ticket 111)', () => {
  test('absent budgets.json allows the spawn — no cap configured is a real config', async () => {
    const { gateSpawn } = await budgets()
    expect(gateSpawn('some-agent').decision).toBe('allow')
  })

  test('corrupt budgets.json REFUSES the spawn', async () => {
    writeFileSync(budgetsFile(), '{"dailyTotalUsd": 20, "perAge')
    const { gateSpawn } = await budgets()
    const d = gateSpawn('some-agent')
    expect(d.decision).toBe('refuse')
    expect(d.reason).toMatch(/unreadable|corrupt/i)
  })

  test('the refusal does not quarantine the file — a read must not destroy state', async () => {
    writeFileSync(budgetsFile(), '{"dailyTotalUsd": 20, "perAge')
    const { gateSpawn } = await budgets()
    gateSpawn('some-agent')
    expect(readdirSync(dir).filter((n) => n.includes('.corrupt-'))).toEqual([])
    expect(readFileSync(budgetsFile(), 'utf8')).toContain('perAge')
  })
})

describe('writeBudgets is atomic and locked (ticket 110)', () => {
  test('a write leaves no temp file behind', async () => {
    const { setDailyCap } = await budgets()
    setDailyCap(20)
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(budgetsFile(), 'utf8')).dailyTotalUsd).toBe(20)
  })

  test('writing over a corrupt file quarantines rather than overwrites', async () => {
    writeFileSync(budgetsFile(), '{"dailyTotalUsd": 20, "perAge')
    const { setDailyCap } = await budgets()
    expect(() => setDailyCap(5)).toThrow()
    const quarantined = readdirSync(dir).filter((n) => n.includes('.corrupt-'))
    expect(quarantined.length).toBe(1)
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toContain('perAge')
  })
})
