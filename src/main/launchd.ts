import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  copyFileSync,
  chmodSync,
} from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { specToTrigger, type CalendarDict } from './cron'
import { readSchedules, type Schedule } from './schedules'

// Real macOS cron via per-schedule LaunchAgents. Every job shares the
// `com.terminal.cron.` label prefix, so reconcileSchedules() can guarantee no
// orphans by diffing the loaded jobs against schedules.json.
const LA_DIR = join(homedir(), 'Library', 'LaunchAgents')
const CFG = join(homedir(), '.config', 'TerMinal')
const RUNNER = join(CFG, 'bin', 'terminal-cron') // stable path, survives app moves
const PREFIX = 'com.terminal.cron.'
const label = (id: string) => `${PREFIX}${id}`
const plistPath = (id: string) => join(LA_DIR, `${label(id)}.plist`)
const uid = process.getuid?.() ?? 0
const domain = `gui/${uid}`

let bunPath = ''
function resolveBun(): string {
  if (bunPath) return bunPath
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    bunPath = execFileSync(shell, ['-l', '-c', 'command -v bun'], { encoding: 'utf8' }).trim()
  } catch {
    /* fall through */
  }
  if (!bunPath) bunPath = join(homedir(), '.bun', 'bin', 'bun')
  return bunPath
}

// Refresh the headless runner at the stable path (from the bundle in prod, the
// repo in dev). Called on launch so launchd points at a location independent of
// the .app bundle.
export function installRunner(srcPath: string): void {
  try {
    if (!existsSync(srcPath)) return
    mkdirSync(join(CFG, 'bin'), { recursive: true })
    copyFileSync(srcPath, RUNNER)
    chmodSync(RUNNER, 0o755)
  } catch {
    /* best effort */
  }
}

// Same pattern for the script helper. Scripts referenced by .agents/<id>.sh
// get ~/.config/TerMinal/bin prepended to PATH at exec time, so they can call
// `terminal-cli hitl ...` etc. without knowing the absolute path.
export function installCli(srcPath: string): void {
  try {
    if (!existsSync(srcPath)) return
    mkdirSync(join(CFG, 'bin'), { recursive: true })
    const dest = join(CFG, 'bin', 'terminal-cli')
    copyFileSync(srcPath, dest)
    chmodSync(dest, 0o755)
  } catch {
    /* best effort */
  }
}

// The OpenRouter tier (or-exec/or-agent/or-spend + model-routing/lib.ts) ships
// with TerMinal so a fresh install can run OpenRouter agents without depending
// on any global ~/.claude dotfiles. Scripts land on the same PATH-prepended
// bin dir; the registry is seeded once (never overwritten, so user edits + the
// spend log persist) while lib.ts is always refreshed to match the scripts.
export function installOrTier(binSrcDir: string, mrSrcDir: string): void {
  try {
    if (!existsSync(binSrcDir)) return
    const binDir = join(CFG, 'bin')
    mkdirSync(binDir, { recursive: true })
    for (const name of ['or-exec', 'or-agent', 'or-spend']) {
      const src = join(binSrcDir, name)
      if (!existsSync(src)) continue
      const dest = join(binDir, name)
      copyFileSync(src, dest)
      chmodSync(dest, 0o755)
    }
    const mrDir = join(CFG, 'model-routing')
    mkdirSync(mrDir, { recursive: true })
    const libSrc = join(mrSrcDir, 'lib.ts')
    if (existsSync(libSrc)) copyFileSync(libSrc, join(mrDir, 'lib.ts'))
    // Seed the registry only if absent — preserve the user's edits + spend log.
    const modelsSrc = join(mrSrcDir, 'models.json')
    const modelsDest = join(mrDir, 'models.json')
    if (existsSync(modelsSrc) && !existsSync(modelsDest)) copyFileSync(modelsSrc, modelsDest)
  } catch {
    /* best effort — OpenRouter runs surface a clear error if the tier is missing */
  }
}

// MCP server for cross-session views (ticket #0003). Same path scheme so
// agents can launch it via stdio.
export function installMcpServer(srcPath: string): void {
  try {
    if (!existsSync(srcPath)) return
    mkdirSync(join(CFG, 'bin'), { recursive: true })
    const dest = join(CFG, 'bin', 'terminal-mcp-server')
    copyFileSync(srcPath, dest)
    chmodSync(dest, 0o755)
  } catch {
    /* best effort */
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plistXml(s: Schedule): string {
  const trig = specToTrigger(s.spec)
  const args = [resolveBun(), RUNNER, 'run', s.id]
  const argsXml = args.map((a) => `    <string>${esc(a)}</string>`).join('\n')
  // Always StartCalendarInterval — fires at fixed wall-clock times and re-fires
  // on wake, unlike the drift-prone StartInterval we no longer emit.
  const dict = (e: CalendarDict) =>
    '    <dict>\n' +
    Object.entries(e)
      .map(([k, v]) => `      <key>${k}</key><integer>${v}</integer>`)
      .join('\n') +
    '\n    </dict>'
  const trigXml = `  <key>StartCalendarInterval</key>\n  <array>\n${trig.entries.map(dict).join('\n')}\n  </array>`
  const logOut = join(CFG, 'cron-runs', `${s.id}.launchd.log`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label(s.id)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
${trigXml}
  <key>StandardOutPath</key>
  <string>${esc(logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(logOut)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${esc(homedir())}</string>
    <key>PATH</key><string>${esc(launchdPath())}</string>
  </dict>
</dict>
</plist>
`
}

// launchd hands the runner a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so
// claude / codex / bun / gh / glab all fail to resolve. Build a sane PATH from
// the user's actual environment plus a fallback list of common dev-tool dirs.
// Captured at plist-generation time so each schedule gets the PATH of whoever
// installed it; works across .bun/.local/.npm-global/homebrew layouts.
function launchdPath(): string {
  const home = homedir()
  const fromEnv = (process.env.PATH || '').split(':').filter(Boolean)
  const common = [
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.cargo/bin`,
    `${home}/go/bin`,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  // Dedupe, keeping first-seen order (env wins over fallbacks).
  const seen = new Set<string>()
  const merged: string[] = []
  for (const p of [...fromEnv, ...common]) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    merged.push(p)
  }
  return merged.join(':')
}

function bootout(id: string): void {
  try {
    execFileSync('launchctl', ['bootout', `${domain}/${label(id)}`], { stdio: 'ignore' })
  } catch {
    /* not loaded */
  }
}

// Is a schedule's launchd job actually loaded? True only when the plist exists
// AND launchd knows the label. This is the real "will it fire?" signal — a
// schedule can be enabled in schedules.json yet have no loaded job (never
// bootstrapped, or a bootstrap that failed silently), in which case it never
// fires. Used to surface that state instead of pretending everything is fine.
export function isJobLoaded(id: string): boolean {
  if (!existsSync(plistPath(id))) return false
  try {
    execFileSync('launchctl', ['print', `${domain}/${label(id)}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Pure decision: does an enabled schedule's job need a bootout/bootstrap cycle?
// Only when it's not currently loaded, or the plist content actually changed.
// Reloading an already-correct job is pointless churn (a bootout/bootstrap on
// every TerMinal relaunch), so skip it when the on-disk plist already matches.
export function needsReload(onDiskXml: string | null, newXml: string, isLoaded: boolean): boolean {
  return !isLoaded || onDiskXml !== newXml
}

// Pure classifier (injectable probe): enabled schedules whose job isn't loaded
// in launchd — i.e. "dark" schedules that will never fire. Disabled schedules
// are never dark (they're intentionally not loaded).
export function darkSchedules(schedules: Schedule[], isLoaded: (id: string) => boolean = isJobLoaded): Schedule[] {
  return schedules.filter((s) => s.enabled && !isLoaded(s.id))
}

// Returns whether the job is actually loaded afterward (verified via print), so
// callers can surface a silent launchd bind/load failure instead of swallowing it.
function bootstrap(id: string): boolean {
  try {
    execFileSync('launchctl', ['bootstrap', domain, plistPath(id)], { stdio: 'ignore' })
  } catch {
    try {
      execFileSync('launchctl', ['load', plistPath(id)], { stdio: 'ignore' }) // older macOS fallback
    } catch {
      /* best effort — verified below */
    }
  }
  return isJobLoaded(id)
}

// Write + (re)load the plist for an enabled schedule; unload + delete if disabled.
// Returns ok=false (with a reason) if launchd didn't actually load the job.
export function syncSchedule(s: Schedule): { ok: boolean; error?: string } {
  mkdirSync(LA_DIR, { recursive: true })
  // Host-targeted schedules fire via systemd on that host (ADR-0002), never
  // launchd — tear down any local plist left over from when it ran locally.
  if (s.host) {
    unscheduleJob(s.id)
    return { ok: true }
  }
  if (!s.enabled) {
    bootout(s.id)
    try {
      if (existsSync(plistPath(s.id))) unlinkSync(plistPath(s.id))
    } catch {
      /* ignore */
    }
    return { ok: true }
  }
  const xml = plistXml(s)
  const onDisk = existsSync(plistPath(s.id)) ? readFileSync(plistPath(s.id), 'utf8') : null
  // Already loaded with the exact plist we'd write? Leave it running — a
  // needless bootout/bootstrap on every relaunch is pointless churn (see needsReload).
  if (!needsReload(onDisk, xml, isJobLoaded(s.id))) return { ok: true }
  bootout(s.id) // clean reload for a changed/unloaded job
  try {
    writeFileSync(plistPath(s.id), xml)
  } catch (e) {
    return { ok: false, error: `write plist: ${(e as Error).message}` }
  }
  return bootstrap(s.id)
    ? { ok: true }
    : { ok: false, error: 'launchctl did not load the job — check Console.app / the plist' }
}

export function unscheduleJob(id: string): void {
  bootout(id)
  try {
    if (existsSync(plistPath(id))) unlinkSync(plistPath(id))
  } catch {
    /* ignore */
  }
}

function listCronPlists(): string[] {
  try {
    return readdirSync(LA_DIR).filter((f) => f.startsWith(PREFIX) && f.endsWith('.plist'))
  } catch {
    return []
  }
}
const idFromPlist = (f: string) => f.slice(PREFIX.length, -'.plist'.length)

// Diff loaded jobs ↔ schedules.json: delete orphans, (re)load enabled schedules.
// This is the no-orphans guarantee — run on launch and on demand. `loaded`
// counts only jobs launchd ACTUALLY loaded; every syncSchedule failure lands in
// `failed` so callers can surface it instead of silently reporting success.
export function reconcileSchedules(): {
  loaded: number
  removed: number
  failed: { id: string; error: string }[]
} {
  // Only local schedules (no host) are launchd's business; host-targeted ones
  // are reconciled via systemd in schedule-router.ts. A plist whose schedule
  // moved to a host is therefore treated as an orphan and removed below.
  const schedules = readSchedules().filter((s) => !s.host)
  const byId = new Map(schedules.map((s) => [s.id, s]))
  let removed = 0
  let loaded = 0
  const failed: { id: string; error: string }[] = []
  for (const f of listCronPlists()) {
    const id = idFromPlist(f)
    const s = byId.get(id)
    if (!s || !s.enabled) {
      unscheduleJob(id)
      removed++
    }
  }
  for (const s of schedules)
    if (s.enabled) {
      const r = syncSchedule(s)
      if (r.ok) loaded++
      else failed.push({ id: s.id, error: r.error || 'unknown launchd error' })
    }
  return { loaded, removed, failed }
}

export function removeAllJobs(): number {
  let n = 0
  for (const f of listCronPlists()) {
    unscheduleJob(idFromPlist(f))
    n++
  }
  return n
}

// Fire a schedule immediately, out of band (detached so it outlives this call).
export function runScheduleNow(id: string): void {
  try {
    spawn(resolveBun(), [RUNNER, 'run', id], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* best effort */
  }
}
