import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyCert,
  classifyCommand,
  classifyHttp,
  listMonitorsWithStatus,
  readMonitors,
  shouldNotify,
  type MonitorStatus,
} from './monitors'

describe('classifyHttp', () => {
  test('2xx/3xx ok, 4xx warn, 5xx/none fail', () => {
    expect(classifyHttp(200, 50)).toBe('ok')
    expect(classifyHttp(301, 50)).toBe('ok')
    expect(classifyHttp(404, 50)).toBe('warn')
    expect(classifyHttp(503, 50)).toBe('fail')
    expect(classifyHttp(null, null)).toBe('fail')
  })
  test('slow response downgrades ok to warn', () => {
    expect(classifyHttp(200, 900, 500)).toBe('warn')
    expect(classifyHttp(200, 200, 500)).toBe('ok')
  })
})

describe('classifyCert', () => {
  test('expiry thresholds', () => {
    expect(classifyCert(40)).toBe('ok')
    expect(classifyCert(10)).toBe('warn')
    expect(classifyCert(3)).toBe('fail')
    expect(classifyCert(-1)).toBe('fail')
    expect(classifyCert(null)).toBe('fail')
  })
})

describe('classifyCommand', () => {
  test('exit code, overridden by parsed status', () => {
    expect(classifyCommand(0)).toBe('ok')
    expect(classifyCommand(1)).toBe('fail')
    expect(classifyCommand(0, 'warn')).toBe('warn')
    expect(classifyCommand(1, 'ok')).toBe('ok')
  })
})

describe('shouldNotify', () => {
  const st = (over: Partial<MonitorStatus>): MonitorStatus => ({
    id: 'm',
    status: 'ok',
    summary: '',
    lastCheckedAt: 0,
    since: 0,
    lastTransition: null,
    history: [],
    ...over,
  })
  test('fires on any transition', () => {
    expect(shouldNotify(st({ status: 'ok' }), 'fail', 1000, 3600)).toBe(true)
    expect(shouldNotify(st({ status: 'fail' }), 'ok', 1000, 3600)).toBe(true)
  })
  test('no notify while unchanged and healthy', () => {
    expect(shouldNotify(st({ status: 'ok' }), 'ok', 1000, 3600)).toBe(false)
  })
  test('re-notifies a still-failing check after the window', () => {
    const failing = st({
      status: 'fail',
      since: 0,
      lastTransition: { from: 'ok', to: 'fail', at: 0 },
    })
    expect(shouldNotify(failing, 'fail', 1000, 3600)).toBe(false) // 1s < 1h
    expect(shouldNotify(failing, 'fail', 3_600_001, 3600)).toBe(true) // past window
    expect(shouldNotify(failing, 'fail', 3_600_001, 0)).toBe(false) // renotify disabled
  })
  test('a first-ever failing check notifies (compared against ok)', () => {
    expect(shouldNotify(null, 'fail', 1000, 3600)).toBe(true)
    expect(shouldNotify(null, 'ok', 1000, 3600)).toBe(false)
  })
})

describe('config + status join', () => {
  test('lists worst-first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mon-'))
    const cfg = join(dir, 'monitors.json')
    const state = join(dir, 'state')
    require('node:fs').mkdirSync(state)
    writeFileSync(
      cfg,
      JSON.stringify([
        {
          id: 'a',
          name: 'A',
          type: 'http',
          target: 'x',
          intervalSec: 60,
          enabled: true,
          notify: {},
          config: {},
        },
        {
          id: 'b',
          name: 'B',
          type: 'http',
          target: 'y',
          intervalSec: 60,
          enabled: true,
          notify: {},
          config: {},
        },
      ]),
    )
    writeFileSync(
      join(state, 'a.json'),
      JSON.stringify({ id: 'a', status: 'ok', lastCheckedAt: 5 }),
    )
    writeFileSync(
      join(state, 'b.json'),
      JSON.stringify({ id: 'b', status: 'fail', lastCheckedAt: 1 }),
    )
    expect(listMonitorsWithStatus(cfg, state).map((m) => m.id)).toEqual(['b', 'a'])
    expect(readMonitors(cfg)).toHaveLength(2)
  })
})
