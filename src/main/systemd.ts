// Linux systemd --user trigger layer — the counterpart to launchd.ts for
// always-on remote hosts (ADR-0002). A schedule with `host` set to a
// `platform: 'linux'` RemoteHost is fired by a per-schedule systemd user timer
// installed over SSH, instead of a local launchd LaunchAgent.
//
// Split mirrors launchd.ts: a PURE, unit-testable core (spec → OnCalendar, unit
// rendering, injection-safe shell-command builders) plus a thin impure SSH shell
// (syncScheduleOnHost / reconcileSchedulesOnHost) exercised against a real host.
//
// Every function is host-parametric — nothing here is single-host. The trigger
// layer is chosen by the host's `platform`, never its name.

import { execFile } from 'node:child_process'
import { specToTrigger, type CalendarDict, type ScheduleSpec } from './cron'
import { isSafeSshTarget } from './remote'
import type { Schedule } from './schedules'

const PREFIX = 'terminal-cron-'
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad2 = (n: number) => String(n).padStart(2, '0')

export const unitName = (id: string) => `${PREFIX}${id}`

// systemd unit basenames land in a filesystem path and on a `systemctl --user`
// argv, so keep them to a conservative word/dash/dot set (no slashes, spaces, or
// shell metacharacters). Schedule ids are generated safe, but guard anyway.
export function isSafeUnitId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w.-]+$/.test(id) && id !== '.' && id !== '..'
}

// One launchd CalendarDict → one systemd OnCalendar expression.
// Format: `[DOW ]*-MM-DD HH:MM:SS`. An omitted field becomes `*` (matching
// launchd's "omitted key = any"); seconds are pinned to 00 so a matching minute
// fires exactly once (cron semantics), never once per second.
function dictToOnCalendar(e: CalendarDict): string {
  const dow = e.Weekday !== undefined ? `${WEEKDAY_NAMES[e.Weekday]} ` : ''
  const mon = e.Month !== undefined ? pad2(e.Month) : '*'
  const day = e.Day !== undefined ? pad2(e.Day) : '*'
  const hour = e.Hour !== undefined ? pad2(e.Hour) : '*'
  const min = e.Minute !== undefined ? pad2(e.Minute) : '*'
  return `${dow}*-${mon}-${day} ${hour}:${min}:00`
}

// Reuse cron.ts's parser/expander (single source of truth for timing), then map
// each resulting calendar dict to a systemd OnCalendar line. A timer with N
// OnCalendar lines fires on the union of them.
export function specToOnCalendar(spec: ScheduleSpec): string[] {
  return specToTrigger(spec).entries.map(dictToOnCalendar)
}

// Container execution (ADR-0002 C3, #13). Runs the SAME bundled runner inside a
// Docker image, mounting the host cfg dir (so cron-runs records still land on the
// host → Runs tab reads them for free) and the repo at their real paths, plus
// credential dirs read-only. The image + this contract are reused by the k3s
// CronJob path (#16).
export type ContainerRun = {
  image: string
  home: string
  cfgDir: string // host ~/.config/TerMinal — mounted at the same path
  repoRoot: string // host repo — mounted at the same path so worktree paths resolve
  credDirs?: string[] // e.g. ~/.claude, ~/.codex — mounted read-only for engine auth
  user?: string // run as this uid:gid so mounted-dir writes are owned by the host user, not root
}

// Build the `docker run` command that executes the runner in a container for a
// schedule. Same-path bind mounts keep the runner's absolute paths valid; the id
// is guarded so it can never break out of the --name/argv.
export function containerExecStart(id: string, c: ContainerRun): string {
  if (!isSafeUnitId(id)) throw new Error(`unsafe schedule id: ${id}`)
  const mounts = [
    `-v ${c.cfgDir}:${c.cfgDir}`,
    `-v ${c.repoRoot}:${c.repoRoot}`,
    ...(c.credDirs || []).map((d) => `-v ${d}:${d}:ro`),
  ]
  // systemd ExecStart needs an absolute executable and resolves it against the
  // MANAGER's PATH, not the unit's Environment=PATH — so a bare `docker` (snap
  // installs it in /snap/bin) fails with status 203/EXEC. `/usr/bin/env` is
  // absolute and does resolve `docker` via the unit's PATH. Host-agnostic.
  return [
    '/usr/bin/env docker run --rm',
    ...(c.user ? [`--user ${c.user}`] : []),
    `--name ${unitName(id)}`,
    `-e HOME=${c.home}`,
    ...mounts,
    c.image,
    `run ${id}`,
  ].join(' ')
}

export type RenderOpts = {
  bun: string
  runner: string
  description?: string
  env?: Record<string, string>
  container?: ContainerRun // present → ExecStart runs the runner in a container instead of bare
}

// Render the .service + .timer pair for a schedule. Pure: all host-specific
// values (bun path, runner path, HOME/PATH env) are injected by the caller so
// this stays deterministic and testable.
export function renderUnits(
  id: string,
  spec: ScheduleSpec,
  opts: RenderOpts,
): { service: string; timer: string } {
  const desc = opts.description || `TerMinal scheduled agent ${id}`
  const envLines = Object.entries(opts.env || {})
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join('\n')
  // Type=oneshot: the runner does one bounded run then exits; the timer, not
  // systemd restart logic, controls cadence. runtime:container → the run executes
  // in a Docker image (same runner inside); bare → the runner directly on the host.
  const execStart = opts.container
    ? containerExecStart(id, opts.container)
    : `${opts.bun} ${opts.runner} run ${id}`
  const service =
    `[Unit]\n` +
    `Description=${desc}\n\n` +
    `[Service]\n` +
    `Type=oneshot\n` +
    `ExecStart=${execStart}\n` +
    (envLines ? `${envLines}\n` : '')
  // Persistent=true re-fires a run missed while the host was asleep/off — the
  // systemd equivalent of launchd firing on wake.
  const timer =
    `[Unit]\n` +
    `Description=${desc} (timer)\n\n` +
    `[Timer]\n` +
    specToOnCalendar(spec)
      .map((l) => `OnCalendar=${l}`)
      .join('\n') +
    `\nPersistent=true\n\n` +
    `[Install]\n` +
    `WantedBy=timers.target\n`
  return { service, timer }
}

// `systemctl --user` needs a session bus; over a non-login ssh, XDG_RUNTIME_DIR
// is usually unset and systemctl fails with "Failed to connect to bus". Exporting
// it (linger keeps /run/user/<uid> alive headless) is the fix. Prepended to every
// systemctl invocation we build.
const XDG = 'export XDG_RUNTIME_DIR="/run/user/$(id -u)";'
const USER_DIR = '"$HOME/.config/systemd/user"'

// Build the remote shell command that installs+enables a schedule's timer. Unit
// contents are shipped as base64 (charset [A-Za-z0-9+/=], safe inside single
// quotes) and decoded on the host — the raw unit text is never interpolated into
// the command line, so a unit body can never break out into shell.
export function installUnitsCmd(id: string, service: string, timer: string): string {
  const unit = unitName(id)
  const svc64 = Buffer.from(service).toString('base64')
  const tim64 = Buffer.from(timer).toString('base64')
  return (
    `${XDG} ` +
    `mkdir -p ${USER_DIR} && ` +
    `printf %s '${svc64}' | base64 -d > ${USER_DIR}/'${unit}.service' && ` +
    `printf %s '${tim64}' | base64 -d > ${USER_DIR}/'${unit}.timer' && ` +
    `systemctl --user daemon-reload && ` +
    `systemctl --user enable --now '${unit}.timer'`
  )
}

// Remove+disable a schedule's timer and delete both unit files.
export function removeUnitCmd(id: string): string {
  const unit = unitName(id)
  return (
    `${XDG} ` +
    `systemctl --user disable --now '${unit}.timer' 2>/dev/null; ` +
    `rm -f ${USER_DIR}/'${unit}.service' ${USER_DIR}/'${unit}.timer'; ` +
    `systemctl --user daemon-reload`
  )
}

// List installed TerMinal timer unit files on the host.
export function listUnitsCmd(): string {
  return `ls -1 ${USER_DIR} 2>/dev/null | grep '^${PREFIX}.*\\.timer$' || true`
}

// Parse `listUnitsCmd` output → schedule ids. Only *.timer files with our prefix
// count; the paired .service is ignored (managed together).
export function parseInstalledUnits(lsOutput: string): string[] {
  return lsOutput
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(PREFIX) && l.endsWith('.timer'))
    .map((l) => l.slice(PREFIX.length, -'.timer'.length))
    .filter(Boolean)
}

// ── Impure SSH shell (exercised against a real host; see ticket #15) ──────────

export type SystemdHost = {
  sshTarget: string
  bun?: string
  runner?: string
  home?: string
  path?: string
  image?: string // container-runtime image override (default terminal-agent:latest)
}

// systemd expands %h to the user's home in unit files (ExecStart/Environment);
// plain $HOME would be taken literally there since Environment= does no shell
// expansion. Use %h so units resolve without the caller knowing the abs home.
const DEFAULT_RUNNER = '%h/.config/TerMinal/bin/terminal-cron'
const DEFAULT_BUN = '%h/.bun/bin/bun'
// A sane PATH for the fired timer — --user services otherwise get a minimal PATH
// and can't find bun/claude/codex/gh/glab. Provisioning (#12) can override.
const DEFAULT_PATH =
  '%h/.local/bin:%h/.bun/bin:%h/.npm-global/bin:%h/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin'
const DEFAULT_IMAGE = 'terminal-agent:latest'

function sshExec(
  sshTarget: string,
  remoteCmd: string,
): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise((resolve) => {
    if (!isSafeSshTarget(sshTarget)) {
      resolve({ ok: false, stdout: '', error: 'unsafe ssh target' })
      return
    }
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, remoteCmd],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err)
          resolve({
            ok: false,
            stdout: stdout || '',
            error: (stderr || err.message || 'ssh error').trim(),
          })
        else resolve({ ok: true, stdout: stdout || '' })
      },
    )
  })
}

function renderOptsFor(host: SystemdHost, s: Schedule): RenderOpts {
  const opts: RenderOpts = {
    bun: host.bun || DEFAULT_BUN,
    runner: host.runner || DEFAULT_RUNNER,
    env: { PATH: host.path || DEFAULT_PATH },
  }
  if (s.runtime === 'container') {
    // systemd expands %h/%U/%G in ExecStart at fire time, so the docker mounts +
    // uid resolve to the real host user without us knowing the absolute home here.
    opts.container = {
      image: host.image || DEFAULT_IMAGE,
      home: '%h',
      cfgDir: '%h/.config/TerMinal',
      repoRoot: s.repoRoot,
      credDirs: ['%h/.claude', '%h/.codex'],
      user: '%U:%G',
    }
  }
  return opts
}

// Install/enable an enabled schedule's timer on the host, or remove it when
// disabled. Returns ok=false (with reason) so callers can surface a silent
// systemd/ssh failure instead of reporting success. Mirrors launchd.syncSchedule.
export async function syncScheduleOnHost(
  host: SystemdHost,
  s: Schedule,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeUnitId(s.id)) return { ok: false, error: `unsafe schedule id: ${s.id}` }
  if (!s.enabled) {
    const r = await sshExec(host.sshTarget, removeUnitCmd(s.id))
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }
  const { service, timer } = renderUnits(s.id, s.spec, renderOptsFor(host, s))
  const r = await sshExec(host.sshTarget, installUnitsCmd(s.id, service, timer))
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

// Diff installed timers ↔ the schedules targeted at this host: remove orphans,
// (re)install enabled ones. The no-orphans guarantee, per host. Mirrors
// launchd.reconcileSchedules. `schedules` should already be filtered to this host.
export async function reconcileSchedulesOnHost(
  host: SystemdHost,
  schedules: Schedule[],
): Promise<{ loaded: number; removed: number; failed: { id: string; error: string }[] }> {
  const failed: { id: string; error: string }[] = []
  let loaded = 0
  let removed = 0
  const byId = new Map(schedules.map((s) => [s.id, s]))

  const listed = await sshExec(host.sshTarget, listUnitsCmd())
  if (!listed.ok)
    return { loaded, removed, failed: [{ id: '*', error: listed.error || 'ssh list failed' }] }

  for (const id of parseInstalledUnits(listed.stdout)) {
    const s = byId.get(id)
    if (!s || !s.enabled) {
      const r = await sshExec(host.sshTarget, removeUnitCmd(id))
      if (r.ok) removed++
      else failed.push({ id, error: r.error || 'remove failed' })
    }
  }
  for (const s of schedules)
    if (s.enabled) {
      const r = await syncScheduleOnHost(host, s)
      if (r.ok) loaded++
      else failed.push({ id: s.id, error: r.error || 'unknown systemd error' })
    }
  return { loaded, removed, failed }
}
