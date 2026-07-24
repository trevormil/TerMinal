import { test, expect, describe, mock } from 'bun:test'
import {
  notifyKindFor,
  dispatchAlert,
  telegramSendBody,
  webhookPayload,
  isWebhookUrl,
  testWebhook,
  createTelegramChannel,
  createDesktopChannel,
  createWebhookChannel,
  createPushChannel,
  type NotifyChannel,
  type NotifyKind,
  type NotifyRefs,
} from './notify-channels'
import { defaultSettings, type Settings } from './settings'

function settingsWith(patch: {
  telegram?: Partial<Settings['telegram']>
  alerts?: {
    desktop?: Partial<Settings['alerts']['desktop']>
    webhook?: Partial<Settings['alerts']['webhook']>
  }
}): Settings {
  const s = defaultSettings()
  Object.assign(s.telegram, patch.telegram || {})
  Object.assign(s.alerts.desktop, patch.alerts?.desktop || {})
  Object.assign(s.alerts.webhook, patch.alerts?.webhook || {})
  return s
}

function recordingChannel(id: NotifyChannel['id'], enabled = true) {
  const calls: { kind: NotifyKind; title: string; detail?: string; refs: NotifyRefs }[] = []
  const ch: NotifyChannel = {
    id,
    enabled: () => enabled,
    send: (kind, title, detail, refs) => {
      calls.push({ kind, title, detail, refs })
    },
  }
  return { ch, calls }
}

describe('notifyKindFor', () => {
  test('failures map to blocked', () => {
    expect(notifyKindFor({ kind: 'error', title: 'x' })).toBe('blocked')
    expect(notifyKindFor({ kind: 'tests-fail', title: 'x' })).toBe('blocked')
    expect(notifyKindFor({ kind: 'blocked', title: 'x' })).toBe('blocked')
  })
  test('completions map to done', () => {
    expect(notifyKindFor({ kind: 'task-complete', title: 'x' })).toBe('done')
    expect(notifyKindFor({ kind: 'tests-pass', title: 'x' })).toBe('done')
    expect(notifyKindFor({ kind: 'pr-merged', title: 'x' })).toBe('done')
  })
  test('agent-run inspects the title', () => {
    expect(notifyKindFor({ kind: 'agent-run', title: 'Agent failed' })).toBe('blocked')
    expect(notifyKindFor({ kind: 'agent-run', title: 'Run interrupted' })).toBe('blocked')
    expect(notifyKindFor({ kind: 'agent-run', title: 'Agent done' })).toBe('done')
    expect(notifyKindFor({ kind: 'agent-run', title: 'Agent started' })).toBe('info')
  })
  test('everything else is info', () => {
    expect(notifyKindFor({ kind: 'ticket-filed', title: 'x' })).toBe('info')
    expect(notifyKindFor({ kind: 'info', title: 'x' })).toBe('info')
  })
})

describe('dispatchAlert', () => {
  const ev = {
    kind: 'blocked',
    title: 'Need input',
    detail: 'question pending',
    repo: 'TerMinal',
    ref: { ticket: 19, pr: 87 },
    runId: 'run-1',
    hitlId: 'hitl-1',
  }

  test('fans out to every enabled channel with the mapped kind + refs', () => {
    const a = recordingChannel('desktop')
    const b = recordingChannel('webhook')
    dispatchAlert([a.ch, b.ch], ev)
    for (const { calls } of [a, b]) {
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        kind: 'blocked',
        title: 'Need input',
        detail: 'question pending',
        refs: { ticket: 19, pr: 87, runId: 'run-1', hitlId: 'hitl-1', repo: 'TerMinal' },
      })
    }
  })

  test('skips disabled channels', () => {
    const off = recordingChannel('webhook', false)
    const on = recordingChannel('desktop')
    dispatchAlert([off.ch, on.ch], ev)
    expect(off.calls).toHaveLength(0)
    expect(on.calls).toHaveLength(1)
  })

  test('a channel throwing synchronously does not block the others', () => {
    const boom: NotifyChannel = {
      id: 'webhook',
      enabled: () => true,
      send: () => {
        throw new Error('boom')
      },
    }
    const after = recordingChannel('desktop')
    expect(() => dispatchAlert([boom, after.ch], ev)).not.toThrow()
    expect(after.calls).toHaveLength(1)
  })

  test('a channel rejecting asynchronously does not block the others', async () => {
    const boom: NotifyChannel = {
      id: 'webhook',
      enabled: () => true,
      send: () => Promise.reject(new Error('async boom')),
    }
    const after = recordingChannel('desktop')
    expect(() => dispatchAlert([boom, after.ch], ev)).not.toThrow()
    expect(after.calls).toHaveLength(1)
    await Bun.sleep(0) // let the rejection settle (must be handled internally)
  })

  test('a throwing enabled() probe does not block the others', () => {
    const boom: NotifyChannel = {
      id: 'webhook',
      enabled: () => {
        throw new Error('probe boom')
      },
      send: () => {},
    }
    const after = recordingChannel('desktop')
    expect(() => dispatchAlert([boom, after.ch], ev)).not.toThrow()
    expect(after.calls).toHaveLength(1)
  })

  test('suppressTelegram skips ONLY the telegram channel', () => {
    const tg = recordingChannel('telegram')
    const desk = recordingChannel('desktop')
    dispatchAlert([tg.ch, desk.ch], { ...ev, suppressTelegram: true })
    expect(tg.calls).toHaveLength(0)
    expect(desk.calls).toHaveLength(1)
  })
})

describe('telegramSendBody', () => {
  test('emoji-prefixed text, title — detail', () => {
    const body = telegramSendBody('99', 'done', 'Tests green', 'suite passed', {})
    expect(body).toEqual({ chat_id: '99', text: '✅ Tests green — suite passed' })
  })
  test('no detail → title only', () => {
    expect(telegramSendBody('99', 'blocked', 'Stuck', undefined, {})).toEqual({
      chat_id: '99',
      text: '⛔ Stuck',
    })
  })
  test('HITL blocked events get Resolve + Tail run buttons', () => {
    const body = telegramSendBody('99', 'blocked', 'Need input', undefined, {
      hitlId: 'h1',
      runId: 'r1',
    }) as { reply_markup?: { inline_keyboard: unknown[][] } }
    expect(body.reply_markup?.inline_keyboard).toEqual([
      [
        { text: '✅ Resolve', callback_data: 'hitl:resolve:h1' },
        { text: '🪵 Tail run', callback_data: 'run:tail:r1' },
      ],
    ])
  })
  test('HITL without runId gets only Resolve', () => {
    const body = telegramSendBody('99', 'blocked', 'Need input', undefined, {
      hitlId: 'h1',
    }) as { reply_markup?: { inline_keyboard: unknown[][] } }
    expect(body.reply_markup?.inline_keyboard).toEqual([
      [{ text: '✅ Resolve', callback_data: 'hitl:resolve:h1' }],
    ])
  })
  test('non-blocked kinds never get buttons', () => {
    const body = telegramSendBody('99', 'done', 'Done', undefined, { hitlId: 'h1', runId: 'r1' })
    expect('reply_markup' in body).toBe(false)
  })
})

describe('webhookPayload', () => {
  test('carries the structured event plus Slack/Discord text fields', () => {
    const refs = { ticket: 19, pr: 87, runId: 'r1', repo: 'TerMinal' }
    const p = webhookPayload('done', 'Tests green', 'suite passed', refs)
    expect(p).toMatchObject({
      source: 'terminal',
      kind: 'done',
      title: 'Tests green',
      detail: 'suite passed',
      refs,
      text: '✅ Tests green — suite passed',
      content: '✅ Tests green — suite passed',
    })
    expect(typeof p.ts).toBe('number')
  })
  test('missing detail → empty string and title-only text', () => {
    const p = webhookPayload('info', 'Ping', undefined, {})
    expect(p.detail).toBe('')
    expect(p.text).toBe('ℹ️ Ping')
  })
})

describe('isWebhookUrl', () => {
  test('http(s) only', () => {
    expect(isWebhookUrl('https://hooks.slack.com/services/T/B/x')).toBe(true)
    expect(isWebhookUrl('http://localhost:9999/hook')).toBe(true)
    expect(isWebhookUrl('ftp://example.com')).toBe(false)
    expect(isWebhookUrl('file:///etc/passwd')).toBe(false)
    expect(isWebhookUrl('not a url')).toBe(false)
    expect(isWebhookUrl('')).toBe(false)
    expect(isWebhookUrl(undefined)).toBe(false)
  })
})

describe('createWebhookChannel', () => {
  test('disabled unless armed AND the url is valid', () => {
    const off = createWebhookChannel(() => settingsWith({}))
    expect(off.enabled()).toBe(false)
    const badUrl = createWebhookChannel(() =>
      settingsWith({ alerts: { webhook: { enabled: true, url: 'nope' } } }),
    )
    expect(badUrl.enabled()).toBe(false)
    const on = createWebhookChannel(() =>
      settingsWith({ alerts: { webhook: { enabled: true, url: 'https://x.test/hook' } } }),
    )
    expect(on.enabled()).toBe(true)
  })

  test('send POSTs the JSON payload to the configured url', async () => {
    const fetchFn = mock(() => Promise.resolve(new Response('ok')))
    const ch = createWebhookChannel(
      () => settingsWith({ alerts: { webhook: { enabled: true, url: 'https://x.test/hook' } } }),
      fetchFn as unknown as typeof fetch,
    )
    await ch.send('done', 'Tests green', 'suite passed', { pr: 87 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x.test/hook')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ kind: 'done', title: 'Tests green', refs: { pr: 87 } })
  })
})

describe('createTelegramChannel', () => {
  test('enabled mirrors telegram.notify', () => {
    expect(createTelegramChannel(() => settingsWith({})).enabled()).toBe(false)
    expect(
      createTelegramChannel(() => settingsWith({ telegram: { notify: true } })).enabled(),
    ).toBe(true)
  })

  test('with native creds it POSTs to the Bot API', async () => {
    const fetchFn = mock(() => Promise.resolve(new Response('ok')))
    const ch = createTelegramChannel(
      () => settingsWith({ telegram: { notify: true, botToken: 'bot:tok', chatId: '99' } }),
      { fetchFn: fetchFn as unknown as typeof fetch },
    )
    await ch.send('done', 'Tests green', 'suite passed', {})
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('api.telegram.org')
    expect(url).toContain('bot:tok')
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '99',
      text: '✅ Tests green — suite passed',
    })
  })

  test('without creds it falls back to the notify script when present', () => {
    const spawned: string[][] = []
    const spawnFn = ((cmd: string, args: string[]) => {
      spawned.push([cmd, ...args])
      return { unref() {} }
    }) as never
    const ch = createTelegramChannel(() => settingsWith({ telegram: { notify: true } }), {
      spawnFn,
      scriptPath: process.execPath, // any existing file stands in for the script
    })
    ch.send('blocked', 'Stuck', 'need a decision', {})
    expect(spawned).toEqual([[process.execPath, '--kind=blocked', 'Stuck — need a decision']])
  })

  test('without creds and without a script it is a silent no-op', () => {
    const spawnFn = mock(() => ({ unref() {} }))
    const ch = createTelegramChannel(() => settingsWith({ telegram: { notify: true } }), {
      spawnFn: spawnFn as never,
      scriptPath: '/nonexistent/telegram-notify.sh',
    })
    expect(() => ch.send('info', 'Hi', undefined, {})).not.toThrow()
    expect(spawnFn).not.toHaveBeenCalled()
  })
})

describe('createDesktopChannel', () => {
  test('enabled follows alerts.desktop.enabled (default on)', () => {
    const show = mock(() => {})
    expect(createDesktopChannel(() => defaultSettings(), show).enabled()).toBe(true)
    expect(
      createDesktopChannel(
        () => settingsWith({ alerts: { desktop: { enabled: false } } }),
        show,
      ).enabled(),
    ).toBe(false)
  })
  test('send shows title + detail', () => {
    const show = mock(() => {})
    createDesktopChannel(() => defaultSettings(), show).send('done', 'Tests green', 'all good', {})
    expect(show).toHaveBeenCalledWith('Tests green', 'all good')
    createDesktopChannel(() => defaultSettings(), show).send('info', 'Ping', undefined, {})
    expect(show).toHaveBeenCalledWith('Ping', '')
  })
})

describe('testWebhook', () => {
  test('invalid url → friendly error without a request', async () => {
    const fetchFn = mock(() => Promise.resolve(new Response('ok')))
    const r = await testWebhook('nope', fetchFn as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('http')
    expect(fetchFn).not.toHaveBeenCalled()
  })
  test('2xx → ok', async () => {
    const fetchFn = mock(() => Promise.resolve(new Response('ok')))
    expect(await testWebhook('https://x.test/hook', fetchFn as unknown as typeof fetch)).toEqual({
      ok: true,
    })
  })
  test('non-2xx surfaces status + body', async () => {
    const fetchFn = mock(() => Promise.resolve(new Response('no_service', { status: 404 })))
    const r = await testWebhook('https://x.test/hook', fetchFn as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('404')
    expect(r.error).toContain('no_service')
  })
  test('network failure surfaces the message', async () => {
    const fetchFn = mock(() => Promise.reject(new Error('ECONNREFUSED')))
    const r = await testWebhook('https://x.test/hook', fetchFn as unknown as typeof fetch)
    expect(r).toEqual({ ok: false, error: 'ECONNREFUSED' })
  })
})

describe('push channel', () => {
  test('body falls back to the title so iOS never renders a generic "Notification"', async () => {
    const sent: { title: string; body: string }[] = []
    const ch = createPushChannel(
      () => true,
      (input) => {
        sent.push(input)
      },
      () => 2,
    )
    await ch.send('blocked', 'HITL · approve deploy', '', {})
    await ch.send('done', 'Run finished', 'all green', {})
    expect(sent[0].body).toBe('HITL · approve deploy')
    expect(sent[1].body).toBe('all green')
  })
})
