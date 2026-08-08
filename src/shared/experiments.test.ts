import { describe, expect, test } from 'bun:test'
import {
  EXPERIMENT_IDS,
  EXPERIMENT_META,
  experimentEnabled,
  normalizeExperiments,
} from './experiments'

describe('experiment registry', () => {
  test('every id carries metadata the Settings section can render', () => {
    for (const id of EXPERIMENT_IDS) {
      const meta = EXPERIMENT_META[id]
      expect(meta).toBeDefined()
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.desc.length).toBeGreaterThan(0)
      expect(meta.reveals.length).toBeGreaterThan(0)
    }
  })

  test('metadata carries no ids the registry does not declare', () => {
    expect(Object.keys(EXPERIMENT_META).sort()).toEqual([...EXPERIMENT_IDS].sort())
  })

  test('the two consumers landing on top of this are registered', () => {
    expect(EXPERIMENT_IDS).toContain('loops')
    expect(EXPERIMENT_IDS).toContain('lanes')
  })
})

describe('experimentEnabled', () => {
  test('fails closed: absent settings, absent block, and absent flag are all off', () => {
    expect(experimentEnabled(undefined, 'loops')).toBe(false)
    expect(experimentEnabled(null, 'loops')).toBe(false)
    expect(experimentEnabled({}, 'loops')).toBe(false)
    expect(experimentEnabled({ experiments: {} }, 'loops')).toBe(false)
    expect(experimentEnabled({ experiments: { lanes: true } }, 'loops')).toBe(false)
  })

  test('only an explicit true enables — truthy junk does not', () => {
    expect(experimentEnabled({ experiments: { loops: true } }, 'loops')).toBe(true)
    expect(experimentEnabled({ experiments: { loops: false } }, 'loops')).toBe(false)
    // A hand-edited settings.json (or an old CLI patch) can carry a string.
    expect(experimentEnabled({ experiments: { loops: 'yes' } } as never, 'loops')).toBe(false)
    expect(experimentEnabled({ experiments: { loops: 1 } } as never, 'loops')).toBe(false)
  })

  test('flags are independent', () => {
    const s = { experiments: { loops: true } }
    expect(experimentEnabled(s, 'loops')).toBe(true)
    expect(experimentEnabled(s, 'lanes')).toBe(false)
  })
})

describe('normalizeExperiments', () => {
  test('garbage and unknown keys are dropped, not carried', () => {
    expect(normalizeExperiments(undefined)).toEqual({})
    expect(normalizeExperiments('nope')).toEqual({})
    expect(normalizeExperiments({ nope: true, loops: 'yes' })).toEqual({})
    expect(normalizeExperiments({ loops: true, lanes: false, nope: true })).toEqual({
      loops: true,
      lanes: false,
    })
  })
})
