import { describe, expect, it } from 'bun:test'
import { defaultSeverity, itemSeverity, shouldNotify } from './hitl-severity'

describe('itemSeverity', () => {
  it("normalizes legacy values ('push' → urgent) and absent → urgent", () => {
    expect(itemSeverity({ severity: 'push' })).toBe('urgent')
    expect(itemSeverity({})).toBe('urgent')
    expect(itemSeverity({ severity: undefined })).toBe('urgent')
  })

  it('passes the three tiers through', () => {
    expect(itemSeverity({ severity: 'urgent' })).toBe('urgent')
    expect(itemSeverity({ severity: 'normal' })).toBe('normal')
    expect(itemSeverity({ severity: 'low' })).toBe('low')
  })

  it('defaults a completion reminder to low, a real block to urgent', () => {
    expect(defaultSeverity('completion-hook')).toBe('low')
    expect(defaultSeverity('cron-fail')).toBe('urgent')
    expect(defaultSeverity('manual')).toBe('urgent')
  })
})

describe('shouldNotify', () => {
  it('default threshold (urgent) pings only urgent', () => {
    expect(shouldNotify('urgent', 'urgent')).toBe(true)
    expect(shouldNotify('normal', 'urgent')).toBe(false)
    expect(shouldNotify('low', 'urgent')).toBe(false)
  })

  it("threshold 'normal' pings urgent + normal, not low", () => {
    expect(shouldNotify('urgent', 'normal')).toBe(true)
    expect(shouldNotify('normal', 'normal')).toBe(true)
    expect(shouldNotify('low', 'normal')).toBe(false)
  })

  it("threshold 'low' pings everything", () => {
    expect(shouldNotify('low', 'low')).toBe(true)
    expect(shouldNotify('urgent', 'low')).toBe(true)
  })
})
