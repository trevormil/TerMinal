import { test, expect, describe } from 'bun:test'
import { buildSelfUpdateScript, installSelfUpdateCmd } from './host-selfupdate'

describe('buildSelfUpdateScript', () => {
  const s = buildSelfUpdateScript('trevormil/TerMinal', 'main')
  test('clones-or-pulls the repo at the requested branch', () => {
    expect(s).toContain('trevormil/TerMinal')
    expect(s).toContain('fetch --quiet origin main')
    expect(s).toContain('reset --hard --quiet FETCH_HEAD') // robust for shallow clones
  })
  test('reinstalls BOTH runner and cli (executable)', () => {
    expect(s).toContain('terminal-cron')
    expect(s).toContain('terminal-cli')
    expect(s).toContain('install -m 755')
  })
  test('is idempotent — pulls when the clone exists, clones when it does not', () => {
    expect(s).toContain('.git')
    expect(s).toMatch(/clone/)
  })
  test('rebuilds the agent image ONLY when the runner changed (#21)', () => {
    expect(s).toContain('build-agent-image.sh')
    // gated on a git diff of bin/terminal-cron between old and new HEAD
    expect(s).toContain('diff --quiet')
    expect(s).toContain('bin/terminal-cron')
    expect(s).toContain('image rebuild skipped')
  })
  test('re-imports into k3s with passwordless sudo, else prints the manual command', () => {
    expect(s).toContain('k3s ctr images import')
    expect(s).toContain('sudo -n')
    expect(s).toContain('re-import manually')
  })
  test('skips the whole rebuild when docker or the Dockerfile is absent', () => {
    expect(s).toContain('command -v docker')
    expect(s).toContain('terminal-agent.Dockerfile')
  })
})

describe('installSelfUpdateCmd', () => {
  const cmd = installSelfUpdateCmd('trevormil/TerMinal', 'main', '*-*-* 03:30:00')
  // Units are shipped base64 (injection-safe); decode every blob to inspect content.
  const decoded = [...cmd.matchAll(/'([A-Za-z0-9+/=]{16,})'/g)]
    .map((m) => Buffer.from(m[1], 'base64').toString('utf8'))
    .join('\n')
  test('writes the update script under the TerMinal bin dir', () => {
    expect(cmd).toContain('terminal-selfupdate.sh')
    // the service ExecStart reaches it via the systemd %h specifier
    expect(decoded).toContain('%h/.config/TerMinal/bin/terminal-selfupdate.sh')
  })
  test('installs + enables a systemd --user timer', () => {
    expect(cmd).toContain('systemctl --user daemon-reload')
    expect(cmd).toContain("enable --now 'terminal-selfupdate.timer'")
  })
  test('the timer fires nightly and catches a missed run after downtime', () => {
    expect(decoded).toContain('OnCalendar=*-*-* 03:30:00')
    expect(decoded).toContain('Persistent=true')
  })
  test('exports XDG_RUNTIME_DIR so --user works over a non-login ssh', () => {
    expect(cmd).toContain('XDG_RUNTIME_DIR')
  })
})
