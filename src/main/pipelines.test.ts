import { test, expect, describe } from 'bun:test'
import { composeSteps, pipelineLabel, listPipelines, PIPELINE_IDS } from './pipelines'

const base = { label: 'task', prompt: 'do the thing' }

describe('composeSteps', () => {
  test('single pipeline = just the base task', () => {
    const steps = composeSteps(base, null, 'single')
    expect(steps).toHaveLength(1)
    expect(steps[0]).toEqual(base)
  })

  test('unknown / undefined pipeline falls back to single', () => {
    expect(composeSteps(base, null, undefined)).toHaveLength(1)
    expect(composeSteps(base, null, 'bogus')).toHaveLength(1)
  })

  test('review adds one stage after the task', () => {
    const steps = composeSteps(base, null, 'review')
    expect(steps.map((s) => s.label)).toEqual(['task', 'review'])
    expect(steps[0].prompt).toBe('do the thing')
  })

  test('review-iterate adds review then iterate, in order', () => {
    expect(composeSteps(base, null, 'review-iterate').map((s) => s.label)).toEqual([
      'task',
      'review',
      'iterate',
    ])
  })

  test('persona prompt is prepended to every step', () => {
    const steps = composeSteps(base, 'YOU ARE A SECURITY EXPERT', 'review')
    for (const s of steps) {
      expect(s.prompt.startsWith('YOU ARE A SECURITY EXPERT')).toBe(true)
      expect(s.prompt).toContain('---')
    }
    expect(steps[0].prompt).toContain('do the thing') // base content survives
  })

  test('no persona = stage prompt unchanged (no separator injected)', () => {
    expect(composeSteps(base, null, 'review')[1].prompt).not.toContain('---')
  })
})

describe('pipelineLabel', () => {
  test('single → undefined (nothing shown)', () => {
    expect(pipelineLabel('single')).toBeUndefined()
    expect(pipelineLabel(undefined)).toBeUndefined()
  })

  test('review / review-iterate → display titles', () => {
    expect(pipelineLabel('review')).toBe('Review')
    expect(pipelineLabel('review-iterate')).toBe('Review + Iterate')
  })
})

describe('listPipelines / PIPELINE_IDS', () => {
  test('lists the three pipelines with non-empty title + description', () => {
    expect(listPipelines().map((p) => p.id)).toEqual(['single', 'review', 'review-iterate'])
    for (const p of listPipelines()) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  test('PIPELINE_IDS matches the pipeline set', () => {
    expect([...PIPELINE_IDS].sort()).toEqual(['review', 'review-iterate', 'single'])
  })
})
