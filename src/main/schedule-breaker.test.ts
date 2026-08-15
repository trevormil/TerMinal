import { describe, expect, test } from 'bun:test'
import { applyBreaker } from './schedule-breaker'

const row = (id: string, enabled = true) => ({ id, title: id, enabled })

describe('applyBreaker', () => {
  test('a schedule the breaker tripped is disabled, with the reason', () => {
    const [a, b] = applyBreaker(
      [row('nightly'), row('hourly')],
      [{ id: 'nightly', reason: '3 consecutive failures', hostLabel: 'tm' }],
    )
    expect(a).toEqual({
      id: 'nightly',
      title: 'nightly',
      enabled: false,
      disabledReason: 'tm · 3 consecutive failures',
    })
    // Untouched rows are returned as-is, not rebuilt with an empty reason.
    expect(b).toEqual(row('hourly'))
  })

  test('a tripped schedule with no recorded reason still reads as disabled', () => {
    const [a] = applyBreaker([row('nightly')], [{ id: 'nightly' }])
    expect(a.enabled).toBe(false)
    expect(a.disabledReason).toBeUndefined()
  })

  test('the local breaker (no host) names no host', () => {
    const [a] = applyBreaker([row('nightly')], [{ id: 'nightly', reason: 'manual override' }])
    expect(a.disabledReason).toBe('manual override')
  })

  test('an already-off schedule stays off and gains the reason', () => {
    const [a] = applyBreaker([row('nightly', false)], [{ id: 'nightly', reason: 'ssh down' }])
    expect(a).toMatchObject({ enabled: false, disabledReason: 'ssh down' })
  })

  test('no breaker entries leaves every row identical', () => {
    const rows = [row('a'), row('b', false)]
    expect(applyBreaker(rows, [])).toEqual(rows)
  })
})
