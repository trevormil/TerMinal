import { describe, expect, test } from 'bun:test'
import { laneGate, MAX_LANES } from './lanes'

describe('laneGate', () => {
  const on = { experimentOn: true, acceptance: ['tests pass'] }

  test('a solo run is never gated — flag off, no acceptance, still fine', () => {
    expect(laneGate({ lanes: 1, experimentOn: false })).toEqual({ n: 1 })
    expect(laneGate({ experimentOn: false })).toEqual({ n: 1 })
    expect(laneGate({ lanes: 0, experimentOn: false, acceptance: [] })).toEqual({ n: 1 })
  })

  test('lanes > 1 is rejected while the experiment is off', () => {
    const r = laneGate({ lanes: 3, experimentOn: false, acceptance: ['tests pass'] })
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toContain('Experimental')
  })

  test('lanes > 1 is rejected when the ticket has no acceptance criteria', () => {
    for (const acceptance of [undefined, [], ['   ']]) {
      const r = laneGate({ lanes: 2, experimentOn: true, acceptance })
      expect(r).toHaveProperty('error')
      expect((r as { error: string }).error).toContain('acceptance criteria')
    }
  })

  test('the flag gate is reported before the acceptance gate', () => {
    const r = laneGate({ lanes: 2, experimentOn: false, acceptance: [] })
    expect((r as { error: string }).error).toContain('Experimental')
  })

  test('an allowed fan-out is capped at MAX_LANES', () => {
    expect(MAX_LANES).toBe(8)
    expect(laneGate({ lanes: 3, ...on })).toEqual({ n: 3 })
    expect(laneGate({ lanes: MAX_LANES, ...on })).toEqual({ n: MAX_LANES })
    expect(laneGate({ lanes: 50, ...on })).toEqual({ n: MAX_LANES })
    expect(laneGate({ lanes: 2.9, ...on })).toEqual({ n: 2 })
  })
})
