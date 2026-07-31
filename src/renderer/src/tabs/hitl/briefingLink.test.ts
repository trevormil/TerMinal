import { describe, expect, test } from 'bun:test'
import { resolveBriefingTarget } from './briefingLink'
import type { BriefingItem } from '../../lib/types'

const item = (over: Partial<BriefingItem>): BriefingItem => ({
  id: 'x-1',
  kind: 'note',
  title: 't',
  ...over,
})

describe('resolveBriefingTarget', () => {
  test('an http link opens externally rather than navigating a tab', () => {
    expect(
      resolveBriefingTarget(item({ kind: 'pr', link: 'https://github.com/o/r/pull/1' })),
    ).toEqual({ kind: 'url', url: 'https://github.com/o/r/pull/1' })
  })

  test('a non-http scheme never becomes an external open', () => {
    // Briefing markdown is agent-generated, so a hostile or malformed link
    // must not reach window.open.
    for (const link of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
      expect(resolveBriefingTarget(item({ link })).kind).toBe('nav')
    }
  })

  test('ticket: and run: links become tab payloads, not URLs', () => {
    expect(
      resolveBriefingTarget(item({ kind: 'idea', link: 'ticket:0130', repo: 'TerMinal' })),
    ).toEqual({ kind: 'nav', tabId: 'tickets', payload: { repo: 'TerMinal', ticket: '0130' } })

    expect(resolveBriefingTarget(item({ kind: 'run', link: 'run:abc-123' }))).toEqual({
      kind: 'nav',
      tabId: 'runs',
      payload: { runId: 'abc-123' },
    })
  })

  test("the agent's nav hint wins over the per-kind default", () => {
    expect(resolveBriefingTarget(item({ kind: 'pr', nav: 'runs' })).kind).toBe('nav')
    expect(resolveBriefingTarget(item({ kind: 'pr', nav: 'runs' }))).toMatchObject({
      tabId: 'runs',
    })
    // ...and without a hint, the kind decides.
    expect(resolveBriefingTarget(item({ kind: 'pr' }))).toMatchObject({ tabId: 'mrs' })
  })

  test('every item kind resolves to a real tab id', () => {
    // A typo'd fallback is invisible in a typecheck and just opens the wrong
    // tab, so pin the whole map against the tab ids that actually exist.
    const REAL_TABS = ['mrs', 'tickets', 'hitl', 'runs', 'reports', 'docs', 'activity', 'schedules']
    for (const kind of [
      'pr',
      'ticket',
      'idea',
      'hitl',
      'run',
      'report',
      'lesson',
      'note',
    ] as const) {
      const t = resolveBriefingTarget(item({ kind }))
      expect(t.kind).toBe('nav')
      expect(REAL_TABS).toContain((t as { tabId: string }).tabId)
    }
  })

  test('an item with no repo omits the key rather than sending undefined', () => {
    expect(resolveBriefingTarget(item({ kind: 'note' })).kind).toBe('nav')
    expect((resolveBriefingTarget(item({ kind: 'note' })) as { payload: object }).payload).toEqual(
      {},
    )
  })
})
