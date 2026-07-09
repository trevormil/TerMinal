import { test, expect, describe } from 'bun:test'
import { shouldRerun, COL_THRESHOLD } from './structuralReflow'

describe('shouldRerun', () => {
  test('never re-runs before first render (oldCols === 0)', () => {
    expect(shouldRerun(0, 160)).toBe(false)
    expect(shouldRerun(0, 0)).toBe(false)
  })

  test('re-runs when the column delta clears the threshold (widen)', () => {
    expect(shouldRerun(120, 120 + COL_THRESHOLD)).toBe(true)
    expect(shouldRerun(120, 200)).toBe(true)
  })

  test('re-runs when the column delta clears the threshold (narrow)', () => {
    expect(shouldRerun(200, 200 - COL_THRESHOLD)).toBe(true)
    expect(shouldRerun(200, 120)).toBe(true)
  })

  test('does not re-run on sub-threshold jitter', () => {
    expect(shouldRerun(160, 160)).toBe(false)
    expect(shouldRerun(160, 161)).toBe(false)
    expect(shouldRerun(160, 159)).toBe(false)
  })

  test('honors an explicit threshold override', () => {
    expect(shouldRerun(160, 165, 10)).toBe(false)
    expect(shouldRerun(160, 170, 10)).toBe(true)
  })
})
