// Host provisioning (ADR-0002, #12). Prepares any registered Linux host to run
// scheduled agents via systemd: install Bun, enable linger (so --user timers
// fire headless — the critical always-on step), install the runner, and report
// readiness. Host-parametric — the same routine provisions any host by sshTarget,
// never a single hardcoded box.
//
// The exact command sequence here was verified live against a fresh Ubuntu host
// (util-linux 2.37.2, systemd --user): bun self-installs, linger enables without
// sudo, the runner runs under a systemd --user service to `status: done`.
//
// Split like launchd/systemd.ts: pure builders + parser (unit-tested) plus a thin
// SSH/scp shell (provisionHost) exercised against the real host.

import { execFile } from 'node:child_process'
import { isSafeSshTarget } from './remote'
import { installSelfUpdateCmd } from './host-selfupdate'

const CFG = '$HOME/.config/TerMinal'

// Idempotent bash: install Bun only if absent, enable linger, create runtime dirs.
export function buildProvisionScript(): string {
  return [
    'set -e',
    'if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then',
    '  curl -fsSL https://bun.sh/install | bash >/tmp/terminal-bun-install.log 2>&1',
    'fi',
    'export PATH="$HOME/.bun/bin:$PATH"',
    // Self-service linger (systemd 248+); fires --user timers with no active login.
    'loginctl enable-linger "$(whoami)" >/dev/null 2>&1 || true',
    `mkdir -p ${CFG}/bin ${CFG}/cron-runs ${CFG}/scripts "$HOME/repos"`,
    'echo PROVISION_DONE',
  ].join('\n')
}

// Bash that prints KEY=VALUE readiness lines parsed by parseReadiness().
export function buildReadinessProbe(engines: string[]): string {
  const safe = engines.filter((e) => /^[\w-]+$/.test(e))
  const lines = [
    'export PATH="$HOME/.bun/bin:$PATH"',
    'echo "BUN=$(bun --version 2>/dev/null || true)"',
    'echo "LINGER=$(loginctl show-user "$(whoami)" -p Linger --value 2>/dev/null || echo unknown)"',
    `[ -x ${CFG}/bin/terminal-cron ] && echo "RUNNER=ok" || echo "RUNNER=missing"`,
    `[ -x ${CFG}/bin/terminal-cli ] && echo "CLI=ok" || echo "CLI=missing"`,
    ...safe.map((e) => `echo "ENGINE_${e}=$(command -v ${e} 2>/dev/null || true)"`),
  ]
  return lines.join('\n')
}

export type HostReadiness = {
  bun: string | null
  linger: boolean
  runner: boolean
  cli: boolean
  engines: Record<string, boolean>
  ready: boolean
  missing: string[]
}

// Parse the readiness probe output. `ready` requires the three things a fired
// timer needs to complete a run: bun, linger (headless firing), and the runner.
// Engine availability is informational (a schedule may use only some engines).
export function parseReadiness(raw: string, engines: string[]): HostReadiness {
  const map = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  const bunRaw = map.get('BUN') || ''
  const bun = bunRaw && bunRaw !== 'MISSING' ? bunRaw : null
  const linger = map.get('LINGER') === 'yes'
  const runner = map.get('RUNNER') === 'ok'
  const cli = map.get('CLI') === 'ok'
  const engineMap: Record<string, boolean> = {}
  for (const e of engines) engineMap[e] = !!(map.get(`ENGINE_${e}`) || '').trim()
  const missing: string[] = []
  if (!bun) missing.push('bun')
  if (!linger) missing.push('linger')
  if (!runner) missing.push('runner')
  return { bun, linger, runner, cli, engines: engineMap, ready: missing.length === 0, missing }
}

// ── Impure SSH/scp shell (verified against a real host; see ticket #15) ──────

export type ProvisionHost = { sshTarget: string }

function ssh(sshTarget: string, cmd: string, timeoutMs = 180_000): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise((resolve) => {
    if (!isSafeSshTarget(sshTarget)) return resolve({ ok: false, stdout: '', error: 'unsafe ssh target' })
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, `bash -lc ${shSingleQuote(cmd)}`],
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, stdout: stdout || '', error: (stderr || err.message || 'ssh error').trim() })
        else resolve({ ok: true, stdout: stdout || '' })
      },
    )
  })
}

function scp(localPath: string, sshTarget: string, remotePath: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!isSafeSshTarget(sshTarget)) return resolve({ ok: false, error: 'unsafe ssh target' })
    execFile('scp', ['-q', localPath, `${sshTarget}:${remotePath}`], { timeout: 60_000 }, (err, _o, stderr) =>
      err ? resolve({ ok: false, error: (stderr || err.message).trim() }) : resolve({ ok: true }),
    )
  })
}

const shSingleQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

export type ProvisionOpts = {
  cliSrcPath?: string // local bin/terminal-cli — installed alongside the runner
  selfUpdate?: boolean // install the nightly self-update timer (default true)
  repoSlug?: string // repo the host self-updates from (default trevormil/TerMinal)
  branch?: string // branch it tracks (default main)
}

// Provision a host end-to-end: idempotent setup, copy the runner + cli into place,
// install the nightly self-update timer (so the host tracks latest main on its
// own), then probe readiness. `runnerSrcPath` is the local terminal-cron path.
export async function provisionHost(
  host: ProvisionHost,
  runnerSrcPath: string,
  engines: string[] = ['claude', 'codex'],
  opts: ProvisionOpts = {},
): Promise<HostReadiness & { log: string }> {
  const log: string[] = []
  const setup = await ssh(host.sshTarget, buildProvisionScript())
  log.push(`setup: ${setup.ok ? 'ok' : `FAILED — ${setup.error}`}`)
  // Copy the runner + cli AFTER dirs exist. Remote chmod (scp doesn't preserve +x reliably).
  const copiedRunner = await scp(runnerSrcPath, host.sshTarget, '.config/TerMinal/bin/terminal-cron')
  log.push(`runner copy: ${copiedRunner.ok ? 'ok' : `FAILED — ${copiedRunner.error}`}`)
  if (opts.cliSrcPath) {
    const copiedCli = await scp(opts.cliSrcPath, host.sshTarget, '.config/TerMinal/bin/terminal-cli')
    log.push(`cli copy: ${copiedCli.ok ? 'ok' : `FAILED — ${copiedCli.error}`}`)
  }
  await ssh(host.sshTarget, 'chmod +x "$HOME/.config/TerMinal/bin/"terminal-cron "$HOME/.config/TerMinal/bin/"terminal-cli 2>/dev/null; true')
  if (opts.selfUpdate !== false) {
    const su = await ssh(
      host.sshTarget,
      installSelfUpdateCmd(opts.repoSlug || 'trevormil/TerMinal', opts.branch || 'main', '*-*-* 03:30:00'),
    )
    log.push(`self-update timer: ${su.ok ? 'ok' : `FAILED — ${su.error}`}`)
  }
  const probe = await ssh(host.sshTarget, buildReadinessProbe(engines))
  log.push(`probe: ${probe.ok ? 'ok' : `FAILED — ${probe.error}`}`)
  const readiness = parseReadiness(probe.stdout, engines)
  return { ...readiness, log: log.join('\n') }
}
