// Maintenance IPC (ticket 0122 index.ts decomposition) — the Settings pane's
// self-service surface: the installed-build update check, the global tm plugin
// status/sync, the per-project sidecar status + one-time migration, the in-app
// rebuild, and the harness self-status snapshot.
//
// The build-provenance helpers stay owned by index.ts (startup calls the update
// check too, and the packaged-vs-dev source resolution belongs with the other
// path helpers there), so they arrive via deps.

import { existsSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn as cpSpawn } from 'node:child_process'
import { handle } from '../typed-ipc'
import { emitActivity } from '../events'
import { configPath, terminalConfigDir } from '../config-dir'
import { installTmPlugin, tmPluginStatus } from '../plugin-install'
import { migrateRepoState, pendingMigration, sidecarGitStatus } from '../repo-state-migrate'
import {
  legacyPluginCopies,
  legacySeedCandidates,
  sweepLegacyPluginCopies,
  sweepLegacySeeds,
} from '../legacy-sweep'
import { readCronRuns } from '../cron-runs'
import { repoRootOf } from '../repo'
import { listDisabled } from '../agents-disabled'
import { listRuns } from '../agents'
import { type UpdateCheckResult } from '../update-check'

export type MaintenanceIpcDeps = {
  cur(): { cwd: string; sessionId: string }
  runUpdateCheck(): Promise<UpdateCheckResult>
  /** Where the bundled tm plugin lives — Resources when packaged, repo otherwise. */
  tmPluginSrcDir(): string
  /** The source checkout that carries `bin/release`, or '' when there isn't one. */
  sourceCheckoutRoot(marker: string): string
  repoLabelFor(cwdOrRoot: string): string
}

export function registerMaintenanceIpc(deps: MaintenanceIpcDeps): void {
  handle('update:check', () => deps.runUpdateCheck())

  // Global tm plugin status/sync for the Settings panel. Sync re-copies the
  // bundled plugin and repairs the ~/.claude/skills/tm symlink.
  handle('plugin:status', () => tmPluginStatus())

  // Per-project sidecar: where this repo's tickets/reviews/sessions live, how
  // many files are still sitting in the repo, and the one-time move.
  handle('repoState:status', (_e, repoRoot?: string) => {
    // Gate HARD on an actual git repo, and always operate on its toplevel. A
    // plain-shell session cwd'd at $HOME would otherwise "detect" the user's
    // real global ~/.claude/skills as repo-local plugin copies (they share
    // names by construction) and offer to bank them — breaking every project.
    const root = repoRootOf(repoRoot || deps.cur().cwd)
    if (!root) return { isRepo: false, commits: 0, path: '', pending: 0, legacyCopies: 0 }
    const pluginDir = join(terminalConfigDir(), 'plugin')
    return {
      ...sidecarGitStatus(root),
      pending: pendingMigration(root),
      legacyCopies:
        legacyPluginCopies(root, pluginDir).length + legacySeedCandidates(root, pluginDir).length,
    }
  })
  // One-time cleanup: state files → sidecar, plus everything older bootstraps
  // seeded per-repo that is global now — plugin-served skill/bin/hook copies,
  // the Codex stop hook, seed artifacts, the layout marker, the forge selector
  // (preserved into the sidecar), and unmodified default script agents. All
  // banked in .claude/pre-tm-backup, never deleted.
  handle('repoState:migrate', (_e, repoRoot?: string) => {
    const root = repoRootOf(repoRoot || deps.cur().cwd)
    if (!root) return { moved: 0, skipped: [], sweptCopies: 0, error: 'not inside a git repo' }
    const pluginDir = join(terminalConfigDir(), 'plugin')
    const r = migrateRepoState(root)
    // A mid-sweep failure (odd permissions, .claude as a file) must not throw
    // away the migrate result or wedge the caller — the sweep is resumable, so
    // report what moved and surface the error.
    let swept = 0
    let sweepError: string | undefined
    try {
      if (!r.error)
        swept =
          sweepLegacyPluginCopies(root, pluginDir).moved + sweepLegacySeeds(root, pluginDir).moved
    } catch (e) {
      sweepError = e instanceof Error ? e.message : String(e)
    }
    // A sweep-only failure must not mask a successful state migration — say
    // what moved AND what failed, since both surfaces render only `error`.
    const error =
      r.error ||
      (sweepError
        ? `moved ${r.moved} state file(s), but the seed sweep failed (re-run to resume): ${sweepError}`
        : undefined)
    return { ...r, sweptCopies: swept, error }
  })
  handle('plugin:sync', () => installTmPlugin(deps.tmPluginSrcDir()))

  // In-app rebuild. Spawns bin/release fully detached and routes its output to
  // a log file the renderer can tail. The release script kills the running
  // TerMinal mid-flow (so it can replace /Applications/TerMinal.app); the
  // detached child outlives the parent and finishes the install + relaunch.
  //
  // Why detached + own process group: bin/release does `pkill -f
  // "/Applications/TerMinal.app/Contents/MacOS"` which would otherwise kill the
  // build itself. Putting the child in its own group + ignoring stdio + unref()
  // makes it a true daemon — the harness exits cleanly and the script lands a
  // fresh app in /Applications a minute or so later.
  const RELEASE_LOG = (): string => configPath('release.log')
  let releasePid: number | null = null
  handle('release:start', () => {
    if (releasePid) {
      try {
        process.kill(releasePid, 0) // throws if process is gone
        return { error: 'release already running' }
      } catch {
        releasePid = null
      }
    }
    // Resolve the repo root from this app's bundle. In dev this is the source
    // tree; in the packaged build there's no bin/release (packaged users would
    // need the source checkout). Refuse cleanly if it's missing.
    // We probe a few candidates: GT_REPO env var (dev override) → process.cwd()
    // → __dirname climb-up. This is enough for the dev / source-installed
    // workflow TerMinal actually runs in.
    const repoRoot = deps.sourceCheckoutRoot(join('bin', 'release'))
    if (!repoRoot) {
      return {
        error:
          'bin/release not found — set GT_TERMINAL_REPO to your source checkout, or run from the repo directory',
      }
    }
    // Truncate the log so each rebuild starts fresh.
    try {
      writeFileSync(
        RELEASE_LOG(),
        `▸ rebuild started ${new Date().toISOString()}\n▸ repo: ${repoRoot}\n`,
      )
    } catch {
      /* best-effort */
    }
    const out = openSync(RELEASE_LOG(), 'a')
    const child = cpSpawn('bin/release', [], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
      // TERMINAL_SELF_UPDATE arms bin/release's provenance gate (F-14). This is
      // the ONE path where the operator clicks a button and trusts whatever comes
      // out, so the build must come from a commit that is actually published —
      // not from a dirty tree or a local-only commit that something else wrote.
      // Signing raises the stakes rather than lowering them: an ad-hoc build
      // announced itself with a Gatekeeper warning, a Developer ID build will not.
      env: { ...process.env, TERMINAL_SELF_UPDATE: '1' },
    })
    child.unref()
    releasePid = child.pid || null
    emitActivity(
      {
        kind: 'check',
        title: 'Release started',
        detail: repoRoot,
        repo: deps.repoLabelFor(repoRoot),
        repoRoot,
      },
      { notify: false },
    )
    return { ok: true, pid: releasePid, log: RELEASE_LOG(), repoRoot }
  })
  handle('release:tail', () => {
    try {
      return readFileSync(RELEASE_LOG(), 'utf8')
    } catch {
      return ''
    }
  })
  // Harness self-status. Meta-observability snapshot so the operator can see
  // how the harness itself is doing without ls-ing config dirs. Cheap: one
  // directory listing + the in-memory run map.
  handle('harness:status', () => {
    const cfgDir = terminalConfigDir()
    const cronRunsDir = join(cfgDir, 'cron-runs')
    let cronRunFiles = 0
    let cronWorktrees = 0
    if (existsSync(cronRunsDir)) {
      try {
        cronRunFiles = readdirSync(cronRunsDir).filter((f) => f.endsWith('.json')).length
      } catch {
        /* ignore */
      }
    }
    const wtDir = join(cfgDir, 'cron-worktrees')
    if (existsSync(wtDir)) {
      try {
        cronWorktrees = readdirSync(wtDir).length
      } catch {
        /* ignore */
      }
    }
    const cronRuns = readCronRuns(undefined, 1000)
    const running = cronRuns.filter((r) => r.status === 'running').length
    const failed24h = cronRuns.filter(
      (r) => r.status === 'failed' && r.startedAt >= Date.now() - 86_400_000,
    ).length
    const paused = listDisabled().length
    const inProcessRunning = listRuns().filter((r) => r.status === 'running').length
    return {
      cronRunFiles,
      cronWorktrees,
      cronRunsRunning: running,
      cronFailed24h: failed24h,
      inProcessRunning,
      schedulesPaused: paused,
      configDir: cfgDir,
    }
  })
  handle('release:status', () => {
    if (!releasePid) return { running: false }
    try {
      process.kill(releasePid, 0)
      return { running: true, pid: releasePid }
    } catch {
      return { running: false, pid: releasePid }
    }
  })
}
