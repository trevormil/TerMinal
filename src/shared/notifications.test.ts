import { describe, expect, test } from 'bun:test'
import {
  anyChannelWants,
  categoryFor,
  channelWants,
  DEFAULT_MATRIX,
  NOTIFY_CATEGORIES,
} from './notifications'

describe('categoryFor', () => {
  test('a HITL filing is always needs-you, whatever its kind', () => {
    expect(categoryFor({ kind: 'info', hitlId: 'h1' })).toBe('needs-you')
    expect(categoryFor({ kind: 'blocked', hitlId: 'h2' })).toBe('needs-you')
  })
  test('maps kinds to their category', () => {
    expect(categoryFor({ kind: 'task-complete' })).toBe('completions')
    expect(categoryFor({ kind: 'pr-merged' })).toBe('code-review')
    expect(categoryFor({ kind: 'tests-fail' })).toBe('tests-ci')
    expect(categoryFor({ kind: 'session-start' })).toBe('sessions')
  })
  test('unknown kinds fall to ops rather than vanishing', () => {
    expect(categoryFor({ kind: 'something-new' })).toBe('ops')
  })
})

describe('channelWants (phone defaults kill the spam)', () => {
  test('phone pushes ONLY needs-you and completions by default', () => {
    for (const cat of NOTIFY_CATEGORIES) {
      const want = channelWants('push', cat)
      expect(want).toBe(cat === 'needs-you' || cat === 'completions')
    }
  })
  test('generic activity does NOT push (the reported bug)', () => {
    for (const kind of ['ticket-filed', 'pr-verdict', 'pr-merged', 'tests-fail', 'agent-run', 'error']) {
      expect(channelWants('push', categoryFor({ kind }))).toBe(false)
    }
  })
  test('inbox items and completions DO push', () => {
    expect(channelWants('push', categoryFor({ kind: 'blocked', hitlId: 'h' }))).toBe(true)
    expect(channelWants('push', categoryFor({ kind: 'task-complete' }))).toBe(true)
  })
})

describe('channelWants override', () => {
  test('an explicit override wins over the default (both directions)', () => {
    // opt the phone INTO code review
    expect(channelWants('push', 'code-review', { push: { 'code-review': true } })).toBe(true)
    // opt the phone OUT of completions
    expect(channelWants('push', 'completions', { push: { completions: false } })).toBe(false)
    // unrelated categories still use defaults
    expect(channelWants('push', 'needs-you', { push: { 'code-review': true } })).toBe(true)
  })
})

describe('anyChannelWants', () => {
  test('true when at least one channel opts in; false when all are off', () => {
    expect(anyChannelWants('needs-you')).toBe(true) // every channel wants it
    expect(anyChannelWants('sessions')).toBe(false) // no channel by default
    expect(anyChannelWants('sessions', { desktop: { sessions: true } })).toBe(true)
  })
})

test('DEFAULT_MATRIX covers every channel × category (no holes)', () => {
  for (const ch of Object.keys(DEFAULT_MATRIX) as (keyof typeof DEFAULT_MATRIX)[]) {
    for (const cat of NOTIFY_CATEGORIES) {
      expect(typeof DEFAULT_MATRIX[ch][cat]).toBe('boolean')
    }
  }
})
