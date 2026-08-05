import { describe, expect, test } from 'bun:test'
import {
  anyChannelWants,
  categoryFor,
  channelWants,
  DEFAULT_MATRIX,
  NOTIFY_CATEGORIES,
  webhookWants,
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
    for (const kind of [
      'ticket-filed',
      'pr-verdict',
      'pr-merged',
      'tests-fail',
      'agent-run',
      'error',
    ]) {
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

// Multiple webhooks each route independently. The matrix's `webhook` row is the
// DEFAULT for a destination that hasn't customized anything, so an existing
// single-webhook setup keeps behaving identically.
describe('webhookWants (per-destination routing)', () => {
  test('no override falls back to the matrix row', () => {
    expect(webhookWants('needs-you', undefined)).toBe(true)
    expect(webhookWants('tickets', undefined)).toBe(false)
  })

  test('an override wins in both directions', () => {
    expect(webhookWants('tickets', { tickets: true })).toBe(true)
    expect(webhookWants('needs-you', { 'needs-you': false })).toBe(false)
  })

  test('an override for ONE category leaves the others on the default', () => {
    const own = { tickets: true }
    expect(webhookWants('tickets', own)).toBe(true)
    expect(webhookWants('needs-you', own)).toBe(true)
    expect(webhookWants('sessions', own)).toBe(false)
  })

  test('a user matrix override moves the fallback', () => {
    expect(webhookWants('tickets', undefined, { webhook: { tickets: true } })).toBe(true)
  })
})

describe('anyChannelWants accounts for per-webhook opt-ins', () => {
  test('a webhook that opted into a category nobody else wants still fires', () => {
    // Without this the emit gate drops the event before dispatch ever runs, and
    // the webhook silently never receives the category it asked for.
    expect(anyChannelWants('sessions')).toBe(false)
    expect(anyChannelWants('sessions', undefined, [{ sessions: true }])).toBe(true)
  })

  test('webhooks with no overrides change nothing', () => {
    expect(anyChannelWants('sessions', undefined, [undefined, {}])).toBe(false)
    expect(anyChannelWants('needs-you', undefined, [undefined])).toBe(true)
  })
})
