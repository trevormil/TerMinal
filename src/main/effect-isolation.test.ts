import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// hitl.ts → events.ts → Electron's Notification, which doesn't exist here.
mock.module('electron', () => ({
  Notification: class {
    show(): void {}
    static isSupported(): boolean {
      return true // the guard, not the platform, is what must stop the alert
    }
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

// The canary for ticket 0115. Filing a HITL used to reach the operator twice per
// suite run: the activity append landed in the REAL feed (which the running app
// tails and mirrors to the phone) and `alwaysPingTelegram` POSTed the Bot API,
// deliberately ignoring the `telegram.notify` toggle. Both are effects, not
// state, so the config-dir sandbox never covered them.
//
// This test arms every gate a notification has to pass — creds present, notify
// on, desktop on, an 'urgent' item — and asserts nothing leaves the process.
const REAL_CONFIG = join(homedir(), '.config', 'TerMinal')

let dir = ''
let fetchCalls: string[] = []
const prevConfigDir = process.env.TERMINAL_CONFIG_DIR
const realFetch = globalThis.fetch

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-effects-'))
  process.env.TERMINAL_CONFIG_DIR = dir
  fetchCalls = []
  globalThis.fetch = ((input: unknown) => {
    fetchCalls.push(typeof input === 'string' ? input : String((input as { url?: string })?.url))
    return Promise.resolve(new Response('{"ok":true}'))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (prevConfigDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = prevConfigDir
})

/** Every notification gate wide open, so only the effect guard can stop it. */
async function armEverything(): Promise<void> {
  const { patchSettings, resetSettingsCache } = await import('./settings')
  resetSettingsCache()
  patchSettings({
    telegram: { notify: true, control: false, botToken: '123:REAL-LOOKING', chatId: '4242' },
    alerts: { desktop: { enabled: true }, webhook: { enabled: true, url: 'https://x.test/hook' } },
    inbox: { completionHook: true, agentContextPreamble: true, notifyThreshold: 'low' },
  })
  resetSettingsCache()
}

describe('the activity feed is never the real one under test', () => {
  test('the log resolves inside the sandbox, not the operator feed', async () => {
    const { activityLogFile } = await import('./events')
    expect(activityLogFile()).toBe(join(dir, 'activity.jsonl'))
    expect(activityLogFile().startsWith(REAL_CONFIG)).toBe(false)
  })

  test('without an override it is still exactly the path production writes', async () => {
    // The seam must not MOVE the feed — bin/gt-notify and the skills append to
    // ~/.config/TerMinal/activity.jsonl and the app has to tail the same file.
    const { activityLogFile } = await import('./events')
    delete process.env.TERMINAL_CONFIG_DIR
    expect(activityLogFile()).toBe(join(REAL_CONFIG, 'activity.jsonl'))
    process.env.TERMINAL_CONFIG_DIR = dir
  })

  test('emitActivity writes nothing at all and dispatches nothing', async () => {
    const { emitActivity } = await import('./events')
    const { resetBlockedEffects, blockedEffects } = await import('./effect-guard')
    await armEverything()
    resetBlockedEffects()

    const ev = emitActivity({ kind: 'blocked', title: 'canary-emit' }, { notify: true })

    // Callers use the returned id, so it is still a well-formed event…
    expect(ev.id).toBeTruthy()
    // …it just never lands anywhere, in the sandbox or out of it.
    expect(existsSync(join(dir, 'activity.jsonl'))).toBe(false)
    expect(fetchCalls).toEqual([])
    expect(blockedEffects().map((b) => b.kind)).toEqual(['activity'])
  })
})

describe('fileHitl — the exact call that pinged the phone', () => {
  test('files the item but reaches neither the feed nor Telegram', async () => {
    const { fileHitl, readHitl } = await import('./hitl')
    const { resetBlockedEffects, blockedEffects } = await import('./effect-guard')
    await armEverything()
    resetBlockedEffects()

    const marker = `canary-hitl-${Date.now()}`
    const item = fileHitl({ title: marker, source: 'manual', severity: 'urgent' })

    // Production semantics are intact: the item is filed, in the sandbox.
    expect(item.severity).toBe('urgent')
    expect(readHitl().map((h) => h.title)).toContain(marker)

    // No POST to api.telegram.org, no APNs, no webhook.
    expect(fetchCalls).toEqual([])
    // No activity append — not to the sandbox, and (below) not to the real feed.
    expect(existsSync(join(dir, 'activity.jsonl'))).toBe(false)

    // And the guard saw both effects it stopped — this is what used to escape.
    const labels = blockedEffects().map((b) => `${b.kind}:${b.label}`)
    expect(labels).toContain('activity:blocked')
    expect(labels).toContain('notify:hitl-telegram')

    // The operator's real feed and inbox never heard of this test.
    for (const file of ['activity.jsonl', 'hitl.json']) {
      const p = join(REAL_CONFIG, file)
      if (existsSync(p)) expect(readFileSync(p, 'utf8')).not.toContain(marker)
    }
  })

  test('a recurrence bump is just as silent', async () => {
    const { fileHitl } = await import('./hitl')
    const { resetBlockedEffects, blockedEffects } = await import('./effect-guard')
    await armEverything()
    const marker = `canary-recur-${Date.now()}`
    fileHitl({ title: marker, source: 'manual', severity: 'urgent' })
    resetBlockedEffects()

    // Same fingerprint within the dedup window → the recurrence path, which has
    // its own emitActivity + alwaysPingTelegram pair.
    const again = fileHitl({ title: marker, source: 'manual', severity: 'urgent' })

    expect(again.occurrenceCount).toBe(2)
    expect(fetchCalls).toEqual([])
    expect(blockedEffects().map((b) => `${b.kind}:${b.label}`)).toContain('notify:hitl-telegram')
    const real = join(REAL_CONFIG, 'activity.jsonl')
    if (existsSync(real)) expect(readFileSync(real, 'utf8')).not.toContain(marker)
  })
})

describe('the other outbound channels', () => {
  test('a push notification is never sent to a paired phone', async () => {
    const { sendPush } = await import('./bridge/push')
    const { resetBlockedEffects, blockedEffects } = await import('./effect-guard')
    resetBlockedEffects()
    expect(await sendPush({ title: 't', body: 'b' })).toEqual({ sent: 0, failed: 0, errors: [] })
    expect(blockedEffects().map((b) => b.label)).toEqual(['push'])
  })

  test('channels built without injected transports cannot reach the network', async () => {
    const { createTelegramChannel, createWebhookChannel, dispatchAlert } =
      await import('./notify-channels')
    const { readSettings } = await import('./settings')
    await armEverything()

    // Built exactly the way events.ts builds them — no deps injected.
    dispatchAlert([createTelegramChannel(readSettings), createWebhookChannel(readSettings)], {
      kind: 'blocked',
      title: 'canary-dispatch',
      hitlId: 'h1',
    })
    await Promise.resolve()
    expect(fetchCalls).toEqual([])
  })
})
