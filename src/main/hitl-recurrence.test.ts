import { describe, expect, test } from 'bun:test'
import { hitlRecurrenceKey, hitlRecurrenceBump, normalizeHitlIssue } from './hitl-recurrence'

describe('normalizeHitlIssue', () => {
  test('strips transient ids, long numbers, hashes, and paths', () => {
    expect(
      normalizeHitlIssue(
        'Run run-abc123 failed in /tmp/worktree/auth at 019e1234567890abcdef #12345',
      ),
    ).toBe('run failed in <path> at #')
  })

  test('keeps distinct issues distinct', () => {
    expect(normalizeHitlIssue('CI failed: tests red')).not.toBe(
      normalizeHitlIssue('Need API key approval'),
    )
  })
})

describe('hitlRecurrenceKey', () => {
  test('groups by normalized issue and repo scope', () => {
    expect(hitlRecurrenceKey({ title: 'CI failed run-abc123', repoRoot: '/repo/app' })).toBe(
      hitlRecurrenceKey({ title: 'CI failed run-def456', repoRoot: '/repo/app' }),
    )
    expect(hitlRecurrenceKey({ title: 'CI failed run-abc123', repoRoot: '/repo/app' })).not.toBe(
      hitlRecurrenceKey({ title: 'CI failed run-def456', repoRoot: '/repo/api' }),
    )
  })
})

describe('hitlRecurrenceBump', () => {
  test('a READ item that recurs becomes unread again and bumps the count', () => {
    const { item } = hitlRecurrenceBump(
      { severity: 'urgent', readAt: 1234, occurrenceCount: 2 },
      'urgent',
    )
    expect(item.readAt).toBeUndefined()
    expect(item.occurrenceCount).toBe(3)
    expect(item.lastOccurredAt).toBeGreaterThan(0)
  })

  test('notify decision follows the severity threshold like a fresh filing', () => {
    // urgent recurrence pings at the default 'urgent' threshold — even if read
    expect(hitlRecurrenceBump({ severity: 'urgent', readAt: 1 }, 'urgent').loud).toBe(true)
    // a low recurrence stays quiet at 'urgent', but pings if the user lowered it
    expect(hitlRecurrenceBump({ severity: 'low', readAt: 1 }, 'urgent').loud).toBe(false)
    expect(hitlRecurrenceBump({ severity: 'low', readAt: 1 }, 'low').loud).toBe(true)
    // legacy/absent severity reads as urgent, so it still notifies
    expect(hitlRecurrenceBump({ readAt: 1 }, 'urgent').loud).toBe(true)
  })

  test('first recurrence of an unread item counts from 1', () => {
    const { item } = hitlRecurrenceBump({ severity: 'normal' }, 'urgent')
    expect(item.occurrenceCount).toBe(2)
    expect(item.readAt).toBeUndefined()
  })
})
