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
  validateMonitors,
  MIN_INTERVAL_SEC,
  MAX_INTERVAL_SEC,
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

// monitors.json is executed by bin/terminal-monitor via /bin/bash -lc on a
// launchd timer that survives quitting the app, so the write path must not
// persist whatever JSON the renderer sends.
describe('validateMonitors', () => {
  const ok = {
    id: 'api',
    name: 'API',
    type: 'http',
    target: 'https://api.example/health',
    intervalSec: 60,
    enabled: true,
    notify: {
      onFailure: 'urgent',
      onRecovery: true,
      renotifyAfterSec: 600,
      dailyDigest: false,
      digestHour: 9,
    },
    config: { warnLatencyMs: 500 },
  }

  test('keeps a well-formed monitor intact', () => {
    const { monitors, rejected } = validateMonitors([ok])
    expect(rejected).toBe(0)
    expect(monitors[0]).toMatchObject({
      id: 'api',
      type: 'http',
      target: 'https://api.example/health',
      intervalSec: 60,
    })
    expect(monitors[0].config).toEqual({ warnLatencyMs: 500 })
  })

  test('rejects an unknown kind rather than persisting it', () => {
    const { monitors, rejected } = validateMonitors([{ ...ok, type: 'exec-anything' }])
    expect(monitors).toEqual([])
    expect(rejected).toBe(1)
  })

  test('rejects entries with no id or no target', () => {
    expect(validateMonitors([{ ...ok, id: '' }]).rejected).toBe(1)
    expect(validateMonitors([{ ...ok, target: '' }]).rejected).toBe(1)
    expect(validateMonitors([{ ...ok, target: 42 }]).rejected).toBe(1)
    expect(validateMonitors([null, 'x', []]).rejected).toBe(3)
  })

  test('clamps the interval so a bad value cannot become a runaway poll loop', () => {
    expect(validateMonitors([{ ...ok, intervalSec: 0 }]).monitors[0].intervalSec).toBe(
      MIN_INTERVAL_SEC,
    )
    expect(validateMonitors([{ ...ok, intervalSec: -5 }]).monitors[0].intervalSec).toBe(
      MIN_INTERVAL_SEC,
    )
    expect(validateMonitors([{ ...ok, intervalSec: 1e12 }]).monitors[0].intervalSec).toBe(
      MAX_INTERVAL_SEC,
    )
    expect(validateMonitors([{ ...ok, intervalSec: 'soon' }]).monitors[0].intervalSec).toBe(300)
  })

  test('normalises the notify block instead of trusting it', () => {
    const [m] = validateMonitors([
      { ...ok, notify: { onFailure: 'catastrophic', digestHour: 99, renotifyAfterSec: -1 } },
    ]).monitors
    expect(m.notify.onFailure).toBe('urgent') // falls back to the default
    expect(m.notify.digestHour).toBe(23)
    expect(m.notify.renotifyAfterSec).toBe(0)
    expect(m.notify.dailyDigest).toBe(false)
  })

  test('a non-object config cannot smuggle a value through', () => {
    expect(validateMonitors([{ ...ok, config: 'rm -rf /' }]).monitors[0].config).toEqual({})
    expect(validateMonitors([{ ...ok, config: ['a'] }]).monitors[0].config).toEqual({})
  })

  // The state file is keyed on id, so two entries sharing one would make the
  // daemon's writes ambiguous.
  test('drops duplicate ids', () => {
    const { monitors, rejected } = validateMonitors([ok, { ...ok, target: 'https://other' }])
    expect(monitors.length).toBe(1)
    expect(rejected).toBe(1)
  })

  test('a non-array payload yields nothing', () => {
    expect(validateMonitors(null)).toEqual({ monitors: [], rejected: 0 })
    expect(validateMonitors({ id: 'x' })).toEqual({ monitors: [], rejected: 0 })
  })
})
