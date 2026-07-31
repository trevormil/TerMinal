import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const homes: string[] = []
type CronRunsModule = typeof import('./cron-runs')

mock.module('electron', () => ({
  Notification: class {
    static isSupported() {
      return false
    }
    show() {}
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'tm-runs-'))
  homes.push(home)
  return home
}

async function loadCronRuns(home: string): Promise<CronRunsModule> {
  process.env.TERMINAL_CRON_RUNS_DIR = join(home, '.config', 'TerMinal', 'cron-runs')
  process.env.TERMINAL_SESSION_RUNS_DIR = join(home, '.config', 'TerMinal', 'session-runs')
  const mod = (await import(
    `./cron-runs.ts?home=${encodeURIComponent(home)}-${Date.now()}`
  )) as CronRunsModule
  return mod
}

function touch(path: string, mtimeMs: number): void {
  const date = new Date(mtimeMs)
  utimesSync(path, date, date)
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
  delete process.env.TERMINAL_CRON_RUNS_DIR
  delete process.env.TERMINAL_SESSION_RUNS_DIR
})

describe('run record readers', () => {
  test('cron runs select a bounded recent file window before parsing', async () => {
    const home = tempHome()
    const runsDir = join(home, '.config', 'TerMinal', 'cron-runs')
    mkdirSync(runsDir, { recursive: true })

    const ancient = join(runsDir, 'ancient.json')
    writeFileSync(
      ancient,
      JSON.stringify({
        id: 'ancient',
        scheduleId: 'schedule',
        agentId: 'agent',
        agentTitle: 'Agent',
        engine: 'codex',
        status: 'done',
        startedAt: 9_999_999_999_999,
        branch: 'main',
        repoLabel: 'repo',
        worktree: '/repo',
      }),
    )
    touch(ancient, 1_700_000_000_000)

    for (let i = 0; i < 3; i++) {
      const file = join(runsDir, `recent-${i}.json`)
      writeFileSync(
        file,
        JSON.stringify({
          id: `recent-${i}`,
          scheduleId: 'schedule',
          agentId: 'agent',
          agentTitle: 'Agent',
          engine: 'codex',
          status: 'done',
          startedAt: 1_700_000_000_000 + i,
          branch: 'main',
          repoLabel: 'repo',
          worktree: '/repo',
        }),
      )
      touch(file, 1_700_000_001_000 + i)
    }

    const { readCronRuns } = await loadCronRuns(home)
    expect(readCronRuns(undefined, 2).map((run) => run.id)).toEqual(['recent-2', 'recent-1'])
  })

  test('session runs select a bounded recent file window before parsing', async () => {
    const home = tempHome()
    const runsDir = join(home, '.config', 'TerMinal', 'session-runs')
    mkdirSync(runsDir, { recursive: true })

    const ancient = join(runsDir, 'ancient.json')
    writeFileSync(
      ancient,
      JSON.stringify({
        id: 'ancient',
        source: 'session',
        agentId: 'agent',
        agentTitle: 'Agent',
        engine: 'codex',
        status: 'done',
        startedAt: 9_999_999_999_999,
        repoRoot: '/repo',
        repoLabel: 'repo',
        branch: 'main',
        worktree: '/repo',
        sessionId: 'ancient',
      }),
    )
    touch(ancient, 1_700_000_000_000)

    for (let i = 0; i < 3; i++) {
      const file = join(runsDir, `recent-${i}.json`)
      writeFileSync(
        file,
        JSON.stringify({
          id: `recent-${i}`,
          source: 'session',
          agentId: 'agent',
          agentTitle: 'Agent',
          engine: 'codex',
          status: 'done',
          startedAt: 1_700_000_000_000 + i,
          repoRoot: '/repo',
          repoLabel: 'repo',
          branch: 'main',
          worktree: '/repo',
          sessionId: `recent-${i}`,
        }),
      )
      touch(file, 1_700_000_001_000 + i)
    }

    const { readSessionRuns } = await loadCronRuns(home)
    expect(readSessionRuns(2).map((run) => run.id)).toEqual(['recent-2', 'recent-1'])
  })

  test('session logs are capped and finalize flushes the buffered tail', async () => {
    const home = tempHome()
    const {
      SESSION_RUN_LOG_MAX_BYTES,
      appendSessionRunLog,
      beginSessionRun,
      finalizeSessionRun,
      readSessionRunLog,
    } = await loadCronRuns(home)

    beginSessionRun({
      id: 'log-run',
      source: 'session',
      agentId: 'agent',
      agentTitle: 'Agent',
      engine: 'codex',
      status: 'running',
      startedAt: Date.now(),
      repoRoot: '/repo',
      repoLabel: 'repo',
      branch: 'main',
      worktree: '/repo',
      sessionId: 'log-run',
    })

    appendSessionRunLog('log-run', 'a'.repeat(SESSION_RUN_LOG_MAX_BYTES + 1024))
    appendSessionRunLog('log-run', 'tail')
    await finalizeSessionRun('log-run', { status: 'done', endedAt: Date.now(), exitCode: 0 })

    const log = readSessionRunLog('log-run')
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(SESSION_RUN_LOG_MAX_BYTES)
    expect(log).toContain('[TerMinal: earlier session log truncated]')
    expect(log.endsWith('tail')).toBe(true)

    const record = JSON.parse(
      readFileSync(join(home, '.config', 'TerMinal', 'session-runs', 'log-run.json'), 'utf8'),
    )
    expect(record.status).toBe('done')
  })
})

// `runs:cancel-cron` used to call readCronRuns(undefined, 20000) and scan the
// result — read+parsing EVERY run record on the main thread per cancel click,
// and then repopulating the shared cache at limit 20000 so the next ordinary
// listing paid for it too. Records live at cron-runs/<id>.json; one read is enough.
describe('getCronRun', () => {
  const write = (dir: string, id: string, extra: Record<string, unknown> = {}) =>
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, status: 'running', ...extra }))

  test('reads a single record by id without scanning the directory', async () => {
    const home = tempHome()
    const dir = join(home, '.config', 'TerMinal', 'cron-runs')
    mkdirSync(dir, { recursive: true })
    write(dir, 'wanted', { runnerPid: 4242 })
    for (let i = 0; i < 50; i++) write(dir, `noise-${i}`)

    const { getCronRun } = await loadCronRuns(home)
    expect(getCronRun('wanted')).toMatchObject({ id: 'wanted', runnerPid: 4242 })
  })

  test('returns null for an unknown id or a corrupt record', async () => {
    const home = tempHome()
    const dir = join(home, '.config', 'TerMinal', 'cron-runs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.json'), '{ not json')

    const { getCronRun } = await loadCronRuns(home)
    expect(getCronRun('missing')).toBeNull()
    expect(getCronRun('broken')).toBeNull()
    expect(getCronRun('')).toBeNull()
  })

  // The id reaches this from the renderer, and it is interpolated into a path.
  test('refuses an id that would escape the runs directory', async () => {
    const home = tempHome()
    const dir = join(home, '.config', 'TerMinal', 'cron-runs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(home, 'secret.json'), JSON.stringify({ id: 'secret' }))

    const { getCronRun } = await loadCronRuns(home)
    expect(getCronRun('../../secret')).toBeNull()
    expect(getCronRun('../secret')).toBeNull()
  })
})
