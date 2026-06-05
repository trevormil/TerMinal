import { describe, expect, test } from 'bun:test'
import { hitlRecurrenceKey, normalizeHitlIssue } from './hitl-recurrence'

describe('normalizeHitlIssue', () => {
  test('strips transient ids, long numbers, hashes, and paths', () => {
    expect(
      normalizeHitlIssue('Run run-abc123 failed in /tmp/worktree/auth at 019e1234567890abcdef #12345'),
    ).toBe('run failed in <path> at #')
  })

  test('keeps distinct issues distinct', () => {
    expect(normalizeHitlIssue('CI failed: tests red')).not.toBe(normalizeHitlIssue('Need API key approval'))
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
