import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendDeliveryRecord,
  consecutiveFailures,
  MAX_DELIVERY_RECORDS,
  readDeliveryLog,
  recentDeliveries,
  shouldEscalate,
  writeDeliveryLog,
  type DeliveryRecord,
} from './notify-log'

const dirs: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'notify-log-'))
  dirs.push(dir)
  return join(dir, 'nested', 'notify-log.json')
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const rec = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  ts: 1,
  channel: 'webhook',
  ok: true,
  title: 'alert',
  ...over,
})

describe('delivery log storage', () => {
  test('round-trips through disk', () => {
    const file = tempFile()
    const log = [rec({ ok: false, error: 'Webhook 401' })]
    writeDeliveryLog(file, log)
    expect(readDeliveryLog(file)).toEqual(log)
  })

  test('an unwritten or corrupt log reads as empty', () => {
    const file = tempFile()
    expect(readDeliveryLog(file)).toEqual([])
    writeDeliveryLog(file, [rec()])
    writeFileSync(file, '{oops')
    expect(readDeliveryLog(file)).toEqual([])
  })

  test('the log is capped so it cannot grow without bound', () => {
    let log: DeliveryRecord[] = []
    for (let i = 0; i < MAX_DELIVERY_RECORDS + 25; i++)
      log = appendDeliveryRecord(log, rec({ ts: i }))
    expect(log).toHaveLength(MAX_DELIVERY_RECORDS)
    // The cap drops the oldest, not the newest.
    expect(log[log.length - 1].ts).toBe(MAX_DELIVERY_RECORDS + 24)
  })
})

describe('consecutiveFailures', () => {
  test('counts only the tail run, per channel', () => {
    const log = [
      rec({ channel: 'webhook', ok: false }),
      rec({ channel: 'webhook', ok: true }),
      rec({ channel: 'webhook', ok: false }),
      rec({ channel: 'webhook', ok: false }),
    ]
    expect(consecutiveFailures(log, 'webhook')).toBe(2)
  })

  test('another channel\'s traffic does not reset the streak', () => {
    const log = [
      rec({ channel: 'telegram', ok: false }),
      rec({ channel: 'webhook', ok: true }),
      rec({ channel: 'telegram', ok: false }),
    ]
    expect(consecutiveFailures(log, 'telegram')).toBe(2)
  })

  test('a success resets it to zero', () => {
    expect(consecutiveFailures([rec({ ok: false }), rec({ ok: true })], 'webhook')).toBe(0)
  })

  test('an unseen channel has no failures', () => {
    expect(consecutiveFailures([rec()], 'push')).toBe(0)
  })
})

describe('shouldEscalate', () => {
  test('fires exactly once — on the failure that crosses the threshold', () => {
    let log: DeliveryRecord[] = []
    const fired: number[] = []
    for (let i = 1; i <= 6; i++) {
      log = appendDeliveryRecord(log, rec({ ok: false, ts: i }))
      if (shouldEscalate(log, 'webhook')) fired.push(i)
    }
    expect(fired).toEqual([3])
  })

  test('a success in between re-arms it', () => {
    let log: DeliveryRecord[] = []
    const fired: number[] = []
    const push = (ok: boolean, ts: number) => {
      log = appendDeliveryRecord(log, rec({ ok, ts }))
      if (shouldEscalate(log, 'webhook')) fired.push(ts)
    }
    for (let i = 1; i <= 3; i++) push(false, i)
    push(true, 4)
    for (let i = 5; i <= 7; i++) push(false, i)
    expect(fired).toEqual([3, 7])
  })
})

describe('recentDeliveries', () => {
  const log = [
    rec({ ts: 1, channel: 'telegram' }),
    rec({ ts: 2, channel: 'webhook' }),
    rec({ ts: 3, channel: 'telegram' }),
  ]

  test('is newest-first', () => {
    expect(recentDeliveries(log).map((r) => r.ts)).toEqual([3, 2, 1])
  })

  test('narrows by channel and honours the limit', () => {
    expect(recentDeliveries(log, { channel: 'telegram' }).map((r) => r.ts)).toEqual([3, 1])
    expect(recentDeliveries(log, { limit: 1 }).map((r) => r.ts)).toEqual([3])
  })

  test('does not mutate the source log', () => {
    recentDeliveries(log)
    expect(log.map((r) => r.ts)).toEqual([1, 2, 3])
  })
})
