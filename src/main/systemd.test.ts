import { test, expect, describe } from 'bun:test'
import {
  specToOnCalendar,
  renderUnits,
  unitName,
  isSafeUnitId,
  installUnitsCmd,
  removeUnitCmd,
  listUnitsCmd,
  parseInstalledUnits,
  containerExecStart,
} from './systemd'

describe('specToOnCalendar', () => {
  test('daily calendar spec → one OnCalendar line, seconds pinned to 00', () => {
    expect(specToOnCalendar({ kind: 'calendar', minute: 30, hour: 9 })).toEqual(['*-*-* 09:30:00'])
  })
  test('weekday calendar spec → one line per day, DOW as systemd name', () => {
    expect(specToOnCalendar({ kind: 'calendar', minute: 30, hour: 9, weekdays: [1, 3, 5] })).toEqual([
      'Mon *-*-* 09:30:00',
      'Wed *-*-* 09:30:00',
      'Fri *-*-* 09:30:00',
    ])
  })
  test('Sunday (0) maps to Sun', () => {
    expect(specToOnCalendar({ kind: 'calendar', minute: 0, hour: 8, weekdays: [0] })).toEqual(['Sun *-*-* 08:00:00'])
  })
  test('cron every-minute → wildcard minute+hour (matches launchd empty-dict)', () => {
    expect(specToOnCalendar({ kind: 'cron', expr: '* * * * *' })).toEqual(['*-*-* *:*:00'])
  })
  test('cron top-of-every-hour → wildcard hour, fixed minute', () => {
    expect(specToOnCalendar({ kind: 'cron', expr: '0 * * * *' })).toEqual(['*-*-* *:00:00'])
  })
  test('cron comma list of hours → one line each', () => {
    expect(specToOnCalendar({ kind: 'cron', expr: '0 9,17 * * *' })).toEqual([
      '*-*-* 09:00:00',
      '*-*-* 17:00:00',
    ])
  })
  test('cron weekday range → one line per weekday with DOW name', () => {
    expect(specToOnCalendar({ kind: 'cron', expr: '30 9 * * 1-5' })).toEqual([
      'Mon *-*-* 09:30:00',
      'Tue *-*-* 09:30:00',
      'Wed *-*-* 09:30:00',
      'Thu *-*-* 09:30:00',
      'Fri *-*-* 09:30:00',
    ])
  })
  test('cron with day-of-month → wildcard weekday, fixed day', () => {
    expect(specToOnCalendar({ kind: 'cron', expr: '0 0 1 * *' })).toEqual(['*-*-01 00:00:00'])
  })
})

describe('unitName / isSafeUnitId', () => {
  test('unit basename is prefixed', () => {
    expect(unitName('coverage')).toBe('terminal-cron-coverage')
  })
  test('accepts word/dash/dot ids', () => {
    expect(isSafeUnitId('my-agent_1.2')).toBe(true)
  })
  test('rejects shell/path-unsafe ids', () => {
    expect(isSafeUnitId('a;b')).toBe(false)
    expect(isSafeUnitId('a b')).toBe(false)
    expect(isSafeUnitId('../x')).toBe(false)
    expect(isSafeUnitId('')).toBe(false)
    expect(isSafeUnitId('a/b')).toBe(false)
  })
})

describe('renderUnits', () => {
  const { service, timer } = renderUnits(
    'coverage',
    { kind: 'calendar', minute: 30, hour: 9, weekdays: [1, 5] },
    { bun: '/home/u/.bun/bin/bun', runner: '/home/u/.config/TerMinal/bin/terminal-cron', env: { HOME: '/home/u', PATH: '/home/u/.bun/bin:/usr/bin' } },
  )
  test('service is a oneshot that execs the runner for this id', () => {
    expect(service).toContain('Type=oneshot')
    expect(service).toContain(
      'ExecStart=/home/u/.bun/bin/bun /home/u/.config/TerMinal/bin/terminal-cron run coverage',
    )
  })
  test('service carries the provided environment', () => {
    expect(service).toContain('Environment=HOME=/home/u')
    expect(service).toContain('Environment=PATH=/home/u/.bun/bin:/usr/bin')
  })
  test('timer emits every OnCalendar line and re-fires missed runs', () => {
    expect(timer).toContain('OnCalendar=Mon *-*-* 09:30:00')
    expect(timer).toContain('OnCalendar=Fri *-*-* 09:30:00')
    expect(timer).toContain('Persistent=true')
    expect(timer).toContain('WantedBy=timers.target')
  })
})

describe('containerExecStart (runtime: container)', () => {
  const opts = {
    image: 'terminal-agent:latest',
    home: '/home/u',
    cfgDir: '/home/u/.config/TerMinal',
    repoRoot: '/home/u/repos/app',
    credDirs: ['/home/u/.claude', '/home/u/.codex'],
  }
  const cmd = containerExecStart('coverage', opts)
  test('runs an ephemeral, named container of the image with `run <id>`', () => {
    // /usr/bin/env so systemd (which resolves ExecStart against the manager PATH,
    // not the unit PATH) can find snap-installed docker in /snap/bin.
    expect(cmd).toContain('/usr/bin/env docker run --rm')
    expect(cmd).toContain('--name terminal-cron-coverage')
    expect(cmd).toMatch(/terminal-agent:latest run coverage$/)
  })
  test('mounts cfg (records land on host) + repo at their real paths, HOME set', () => {
    expect(cmd).toContain('-e HOME=/home/u')
    expect(cmd).toContain('-v /home/u/.config/TerMinal:/home/u/.config/TerMinal')
    expect(cmd).toContain('-v /home/u/repos/app:/home/u/repos/app')
  })
  test('mounts credential dirs read-only', () => {
    expect(cmd).toContain('-v /home/u/.claude:/home/u/.claude:ro')
    expect(cmd).toContain('-v /home/u/.codex:/home/u/.codex:ro')
  })
  test('rejects an unsafe schedule id (never interpolate into the container name)', () => {
    expect(() => containerExecStart('a;rm -rf', opts)).toThrow()
  })
})

describe('renderUnits with container runtime', () => {
  const { service } = renderUnits(
    'coverage',
    { kind: 'calendar', minute: 0, hour: 8 },
    {
      bun: 'bun',
      runner: 'r',
      env: {},
      container: {
        image: 'terminal-agent:latest',
        home: '/home/u',
        cfgDir: '/home/u/.config/TerMinal',
        repoRoot: '/home/u/repos/app',
      },
    },
  )
  test('ExecStart is the docker run, not the bare bun runner', () => {
    expect(service).toContain('ExecStart=/usr/bin/env docker run --rm')
    expect(service).toContain('terminal-agent:latest run coverage')
    expect(service).not.toContain('ExecStart=bun r run coverage')
  })
})

describe('command builders (injection-safe, XDG-aware)', () => {
  const { service, timer } = renderUnits(
    'cov',
    { kind: 'calendar', minute: 0, hour: 8 },
    { bun: 'bun', runner: 'r', env: {} },
  )
  const install = installUnitsCmd('cov', service, timer)
  test('install writes unit content as base64 (raw text never interpolated)', () => {
    // The literal unit body must NOT appear on the command line — only its base64.
    expect(install).not.toContain('Type=oneshot')
    expect(install).toContain(Buffer.from(service).toString('base64'))
    expect(install).toContain(Buffer.from(timer).toString('base64'))
    expect(install).toContain('base64 -d')
  })
  test('install reloads the daemon and enables the timer now', () => {
    expect(install).toContain('systemctl --user daemon-reload')
    expect(install).toContain("systemctl --user enable --now 'terminal-cron-cov.timer'")
  })
  test('install exports XDG_RUNTIME_DIR so --user works over a non-login ssh', () => {
    expect(install).toContain('XDG_RUNTIME_DIR')
    expect(install).toContain('/run/user/')
  })
  test('remove disables the timer and deletes both unit files', () => {
    const rm = removeUnitCmd('cov')
    expect(rm).toContain("systemctl --user disable --now 'terminal-cron-cov.timer'")
    expect(rm).toContain('terminal-cron-cov.service')
    expect(rm).toContain('terminal-cron-cov.timer')
    expect(rm).toContain('systemctl --user daemon-reload')
  })
  test('list command targets the user unit dir', () => {
    expect(listUnitsCmd()).toContain('systemd/user')
    expect(listUnitsCmd()).toContain('terminal-cron-')
  })
})

describe('parseInstalledUnits', () => {
  test('extracts ids from a listing of timer unit files', () => {
    const out = ['terminal-cron-coverage.timer', 'terminal-cron-deps-quality.timer', 'other.timer', ''].join('\n')
    expect(parseInstalledUnits(out)).toEqual(['coverage', 'deps-quality'])
  })
  test('ignores non-timer and non-prefixed lines', () => {
    expect(parseInstalledUnits('terminal-cron-x.service\nrandom\n')).toEqual([])
  })
})
