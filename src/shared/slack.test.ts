import { describe, expect, test } from 'bun:test'
import {
  inboxIsLoud,
  mirrorsToSlack,
  normalizeDestination,
  slackChannelName,
  slackMessageFor,
  slackRecurrenceText,
} from './slack'

const cfg = { defaultChannel: '#terminal-inbox', channelPrefix: 'inbox' }

describe('normalizeDestination', () => {
  test('valid values pass through', () => {
    expect(normalizeDestination('inbox')).toBe('inbox')
    expect(normalizeDestination('both')).toBe('both')
    expect(normalizeDestination('slack')).toBe('slack')
  })
  test('anything else falls back to inbox', () => {
    expect(normalizeDestination(undefined)).toBe('inbox')
    expect(normalizeDestination('Slack')).toBe('inbox')
    expect(normalizeDestination(42)).toBe('inbox')
  })
})

describe('destination gates', () => {
  test('mirrorsToSlack — both and slack mirror, inbox does not', () => {
    expect(mirrorsToSlack('inbox')).toBe(false)
    expect(mirrorsToSlack('both')).toBe(true)
    expect(mirrorsToSlack('slack')).toBe(true)
  })
  test('inboxIsLoud — slack-only quiets desktop/Telegram, others stay loud', () => {
    expect(inboxIsLoud('inbox')).toBe(true)
    expect(inboxIsLoud('both')).toBe(true)
    expect(inboxIsLoud('slack')).toBe(false)
  })
})

describe('slackChannelName', () => {
  test('nested category slugifies with prefix, / becomes -', () => {
    expect(slackChannelName('Monitoring/Certs', cfg)).toBe('inbox-monitoring-certs')
  })
  test('flat category', () => {
    expect(slackChannelName('Builds', cfg)).toBe('inbox-builds')
  })
  test('empty prefix omits the prefix segment', () => {
    expect(slackChannelName('Builds', { ...cfg, channelPrefix: '' })).toBe('builds')
  })
  test('uncategorized and absent land in the default channel, # stripped', () => {
    expect(slackChannelName(undefined, cfg)).toBe('terminal-inbox')
    expect(slackChannelName('Uncategorized', cfg)).toBe('terminal-inbox')
  })
  test('spaces and invalid characters fold to dashes / are stripped', () => {
    expect(slackChannelName('Cron Failures/PR review!', cfg)).toBe('inbox-cron-failures-pr-review')
  })
  test('dash runs collapse and never lead/trail', () => {
    expect(slackChannelName('--Weird---Name--', cfg)).toBe('inbox-weird-name')
  })
  test('caps at 80 chars (Slack limit)', () => {
    expect(slackChannelName('x'.repeat(200), cfg).length).toBeLessThanOrEqual(80)
  })
  test('a category that slugifies to nothing falls back to the default channel', () => {
    expect(slackChannelName('!!!', cfg)).toBe('terminal-inbox')
  })
  test('empty default channel falls back to terminal-inbox', () => {
    expect(slackChannelName(undefined, { defaultChannel: '', channelPrefix: '' })).toBe(
      'terminal-inbox',
    )
  })
})

describe('slackMessageFor', () => {
  const base = {
    title: 'Cert expiring',
    source: 'monitor',
    severity: 'urgent' as const,
    category: 'Monitoring/Certs',
    repo: 'TerMinal',
    action: 'Renew the cert',
    detail: 'expires in 3 days',
  }
  test('fallback text carries severity marker, title, and action', () => {
    const msg = slackMessageFor(base)
    expect(msg.text).toContain('Cert expiring')
    expect(msg.text).toContain('Renew the cert')
    expect(msg.text).toContain('⛔')
  })
  test('completion-hook reads as done, not a block', () => {
    const msg = slackMessageFor({ ...base, source: 'completion-hook', severity: 'low' })
    expect(msg.text).toContain('✅')
  })
  test('blocks include repo and category context', () => {
    const rendered = JSON.stringify(slackMessageFor(base).blocks)
    expect(rendered).toContain('TerMinal')
    expect(rendered).toContain('Monitoring/Certs')
  })
  test('oversized detail is truncated below the 3000-char block limit', () => {
    const msg = slackMessageFor({ ...base, detail: 'x'.repeat(10_000) })
    for (const b of msg.blocks as { text?: { text?: string } }[]) {
      if (b.text?.text) expect(b.text.text.length).toBeLessThanOrEqual(3000)
    }
  })
})

describe('slackRecurrenceText', () => {
  test('names the occurrence count', () => {
    expect(slackRecurrenceText({ title: 'Cron failed', occurrenceCount: 4 })).toContain('4')
  })
})
