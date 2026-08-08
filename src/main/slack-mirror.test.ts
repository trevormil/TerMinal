import { describe, expect, test } from 'bun:test'
import {
  deliverSlackPost,
  testSlackDelivery,
  threadSlackRecurrence,
  reactSlackResolved,
  type SlackApiCall,
} from './slack-mirror'

const cfg = {
  botToken: 'xoxb-test',
  defaultChannel: '#terminal-inbox',
  channelPrefix: 'inbox',
  autoCreateChannels: true,
  inviteUserId: '',
}

const item = {
  id: 'h1',
  title: 'Cert expiring',
  source: 'monitor' as const,
  severity: 'urgent' as const,
  category: 'Monitoring/Certs',
  repo: 'TerMinal',
}

/** Scripted Slack API: maps method → responses in call order. Records calls. */
function fakeApi(script: Record<string, unknown[]>): {
  calls: SlackApiCall[]
  api: (call: SlackApiCall) => Promise<unknown>
} {
  const calls: SlackApiCall[] = []
  const remaining = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  return {
    calls,
    api: async (call) => {
      calls.push(call)
      const next = remaining[call.method]?.shift()
      if (next === undefined) throw new Error(`unscripted slack call: ${call.method}`)
      return next
    },
  }
}

describe('deliverSlackPost', () => {
  test('posts to the derived channel and returns the message ref', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [{ ok: true, channel: 'C123', ts: '1.1' }],
    })
    const ref = await deliverSlackPost(cfg, item, api)
    expect(ref).toEqual({ channelId: 'C123', ts: '1.1' })
    expect(calls[0].body.channel).toBe('#inbox-monitoring-certs')
    expect(calls[0].token).toBe('xoxb-test')
  })

  test('channel_not_found + autoCreate → creates the channel and retries with its id', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [
        { ok: false, error: 'channel_not_found' },
        { ok: true, channel: 'C9', ts: '2.2' },
      ],
      'conversations.create': [{ ok: true, channel: { id: 'C9' } }],
    })
    const ref = await deliverSlackPost(cfg, item, api)
    expect(ref).toEqual({ channelId: 'C9', ts: '2.2' })
    expect(calls.map((c) => c.method)).toEqual([
      'chat.postMessage',
      'conversations.create',
      'chat.postMessage',
    ])
    expect(calls[1].body.name).toBe('inbox-monitoring-certs')
    expect(calls[2].body.channel).toBe('C9')
  })

  test('auto-created channel invites the configured member so it appears in their sidebar', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [
        { ok: false, error: 'channel_not_found' },
        { ok: true, channel: 'C9', ts: '2.2' },
      ],
      'conversations.create': [{ ok: true, channel: { id: 'C9' } }],
      'conversations.invite': [{ ok: true }],
    })
    const ref = await deliverSlackPost({ ...cfg, inviteUserId: 'U0TREVOR' }, item, api)
    expect(ref).toEqual({ channelId: 'C9', ts: '2.2' })
    const invite = calls.find((c) => c.method === 'conversations.invite')
    expect(invite?.body).toEqual({ channel: 'C9', users: 'U0TREVOR' })
  })

  test('no inviteUserId → no invite call', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [
        { ok: false, error: 'channel_not_found' },
        { ok: true, channel: 'C9', ts: '2.2' },
      ],
      'conversations.create': [{ ok: true, channel: { id: 'C9' } }],
    })
    await deliverSlackPost(cfg, item, api)
    expect(calls.some((c) => c.method === 'conversations.invite')).toBe(false)
  })

  test('a failed invite never blocks the post', async () => {
    const { api } = fakeApi({
      'chat.postMessage': [
        { ok: false, error: 'channel_not_found' },
        { ok: true, channel: 'C9', ts: '2.2' },
      ],
      'conversations.create': [{ ok: true, channel: { id: 'C9' } }],
      'conversations.invite': [{ ok: false, error: 'already_in_channel' }],
    })
    expect(await deliverSlackPost({ ...cfg, inviteUserId: 'U0TREVOR' }, item, api)).toEqual({
      channelId: 'C9',
      ts: '2.2',
    })
  })

  test('channel_not_found without autoCreate → falls back to the default channel once', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [
        { ok: false, error: 'channel_not_found' },
        { ok: true, channel: 'C0', ts: '3.3' },
      ],
    })
    const ref = await deliverSlackPost({ ...cfg, autoCreateChannels: false }, item, api)
    expect(ref).toEqual({ channelId: 'C0', ts: '3.3' })
    expect(calls[1].body.channel).toBe('#terminal-inbox')
  })

  test('an item already bound for the default channel never loops on failure', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [{ ok: false, error: 'channel_not_found' }],
    })
    const ref = await deliverSlackPost(
      { ...cfg, autoCreateChannels: false },
      { ...item, category: undefined },
      api,
    )
    expect(ref).toBeNull()
    expect(calls.length).toBe(1)
  })

  test('network/API failure returns null instead of throwing', async () => {
    const ref = await deliverSlackPost(cfg, item, async () => {
      throw new Error('offline')
    })
    expect(ref).toBeNull()
  })
})

describe('threadSlackRecurrence', () => {
  test('threads under the original message', async () => {
    const { calls, api } = fakeApi({ 'chat.postMessage': [{ ok: true }] })
    await threadSlackRecurrence(
      cfg,
      { ...item, occurrenceCount: 4, slackChannel: 'C123', slackTs: '1.1' },
      api,
    )
    expect(calls[0].body.channel).toBe('C123')
    expect(calls[0].body.thread_ts).toBe('1.1')
    expect(String(calls[0].body.text)).toContain('4')
  })

  test('no stored ref → no call', async () => {
    const { calls, api } = fakeApi({})
    await threadSlackRecurrence(cfg, { ...item, occurrenceCount: 2 }, api)
    expect(calls.length).toBe(0)
  })
})

describe('testSlackDelivery', () => {
  test('posts to the default channel and reports ok', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [{ ok: true, channel: 'C0', ts: '1.0' }],
    })
    expect(await testSlackDelivery(cfg, api)).toEqual({ ok: true })
    expect(calls[0].body.channel).toBe('#terminal-inbox')
  })

  test('maps invalid_auth to actionable guidance', async () => {
    const { api } = fakeApi({ 'chat.postMessage': [{ ok: false, error: 'invalid_auth' }] })
    const res = await testSlackDelivery(cfg, api)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('xoxb-')
  })

  test('maps missing_scope to the scope list', async () => {
    const { api } = fakeApi({ 'chat.postMessage': [{ ok: false, error: 'missing_scope' }] })
    expect((await testSlackDelivery(cfg, api)).error).toContain('chat:write')
  })

  test('creates the default channel when missing and auto-create is on', async () => {
    const { calls, api } = fakeApi({
      'chat.postMessage': [
        { ok: false, error: 'channel_not_found' },
        { ok: true, channel: 'C1' },
      ],
      'conversations.create': [{ ok: true, channel: { id: 'C1' } }],
    })
    expect(await testSlackDelivery(cfg, api)).toEqual({ ok: true })
    expect(calls[1].method).toBe('conversations.create')
  })

  test('network failure reports unreachable, never throws', async () => {
    const res = await testSlackDelivery(cfg, async () => {
      throw new Error('offline')
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('offline')
  })
})

describe('reactSlackResolved', () => {
  test('adds the resolve reaction to the original message', async () => {
    const { calls, api } = fakeApi({ 'reactions.add': [{ ok: true }] })
    await reactSlackResolved(cfg, { ...item, slackChannel: 'C123', slackTs: '1.1' }, api)
    expect(calls[0].method).toBe('reactions.add')
    expect(calls[0].body).toEqual({ channel: 'C123', timestamp: '1.1', name: 'white_check_mark' })
  })

  test('already-reacted / API errors never throw', async () => {
    await reactSlackResolved(cfg, { ...item, slackChannel: 'C123', slackTs: '1.1' }, async () => {
      throw new Error('already_reacted')
    })
  })
})
