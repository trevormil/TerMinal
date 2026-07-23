import { describe, expect, it } from 'bun:test'
import { defaultSeverity, itemSeverity } from './hitl-severity'

describe('itemSeverity', () => {
  it("treats a legacy item (no severity) as 'push' so nothing goes silent", () => {
    expect(itemSeverity({})).toBe('push')
    expect(itemSeverity({ severity: undefined })).toBe('push')
  })

  it('respects an explicit severity', () => {
    expect(itemSeverity({ severity: 'normal' })).toBe('normal')
    expect(itemSeverity({ severity: 'push' })).toBe('push')
  })

  it('defaults a completion reminder to normal, a real block to push', () => {
    expect(defaultSeverity('completion-hook')).toBe('normal')
    expect(defaultSeverity('cron-fail')).toBe('push')
    expect(defaultSeverity('manual')).toBe('push')
  })
})
