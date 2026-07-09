import { test, expect, describe } from 'bun:test'
import { darkSchedules } from './launchd'
import type { Schedule } from './schedules'

// Minimal Schedule factory — only the fields darkSchedules reads matter.
const sched = (id: string, enabled: boolean): Schedule =>
  ({
    id,
    repoRoot: '/x',
    repoLabel: 'x',
    agentId: 'a',
    agentTitle: 'A',
    engine: 'claude',
    prompt: '',
    spec: { kind: 'interval', everyMinutes: 60 },
    enabled,
    createdAt: 0,
  }) as Schedule

describe('darkSchedules', () => {
  test('returns enabled schedules whose launchd job is NOT loaded', () => {
    const list = [sched('loaded', true), sched('dark', true)]
    const isLoaded = (id: string) => id === 'loaded'
    const dark = darkSchedules(list, isLoaded)
    expect(dark.map((s) => s.id)).toEqual(['dark'])
  })

  test('never flags disabled schedules, even when their job is absent', () => {
    const list = [sched('off', false)]
    const isLoaded = () => false // no job loaded
    expect(darkSchedules(list, isLoaded)).toEqual([])
  })

  test('all healthy → empty', () => {
    const list = [sched('a', true), sched('b', true)]
    expect(darkSchedules(list, () => true)).toEqual([])
  })
})
