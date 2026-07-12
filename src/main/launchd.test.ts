import { test, expect, describe } from 'bun:test'
import { darkSchedules, needsReload, scheduleLoadedState } from './launchd'
import type { Schedule } from './schedules'

// Minimal Schedule factory — only the fields these helpers read matter.
const sched = (id: string, enabled: boolean, host?: string): Schedule =>
  ({
    id,
    repoRoot: '/x',
    repoLabel: 'x',
    agentId: 'a',
    agentTitle: 'A',
    engine: 'claude',
    prompt: '',
    spec: { kind: 'calendar', minute: 0, hour: 9 },
    enabled,
    host,
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

  test('never flags a HOST-targeted schedule — it has no launchd job by design', () => {
    const list = [sched('hostjob', true, 'tm')]
    expect(darkSchedules(list, () => false)).toEqual([])
  })
})

describe('scheduleLoadedState', () => {
  test('local enabled schedule reflects its launchd loaded state', () => {
    expect(scheduleLoadedState(sched('a', true), () => true)).toBe(true)
    expect(scheduleLoadedState(sched('a', true), () => false)).toBe(false)
  })
  test('a HOST schedule is never probed via launchd → undefined, not a false false', () => {
    // Regression for the launchd-only-probe finding: a correctly-installed host
    // (systemd/k8s) schedule must NOT be reported as loaded:false.
    expect(scheduleLoadedState(sched('a', true, 'tm'), () => false)).toBeUndefined()
  })
  test('disabled schedule → undefined (intentionally not loaded)', () => {
    expect(scheduleLoadedState(sched('a', false), () => false)).toBeUndefined()
  })
})

describe('needsReload', () => {
  const xml = '<plist>same</plist>'

  test('loaded + identical plist → no reload (avoid needless churn)', () => {
    // Relaunching TerMinal must NOT bootout/bootstrap a healthy job when the
    // plist is unchanged — a pointless reload cycle on every launch.
    expect(needsReload(xml, xml, true)).toBe(false)
  })

  test('loaded but plist content changed → reload', () => {
    expect(needsReload('<plist>old</plist>', xml, true)).toBe(true)
  })

  test('not loaded → always reload, even if plist on disk matches', () => {
    expect(needsReload(xml, xml, false)).toBe(true)
  })

  test('no plist on disk (null) → reload', () => {
    expect(needsReload(null, xml, true)).toBe(true)
  })
})
