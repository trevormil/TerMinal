import type { ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configPath } from './config-dir'
import { inMemoryWorkingSet } from './run-retention'
import { readFileTail } from './fs-tail'
import { killProcessGroup } from './process-group'
import { readSettings } from './settings'
import type { AgentRun } from './agent-types'

// The in-process agent RUN STORE (ticket 91): the live run map, the child-
// process registry, the renderer event seam, and the on-disk persistence
// (one <id>.json of metadata + <id>.log of output per run). Extracted from
// agents.ts so the store is testable without the spawn runtime, and so
// cron-runs.ts can read runs without importing the whole runtime.

const OUTPUT_CAP = 400_000

const runs = new Map<string, AgentRun>()
const procs = new Map<string, ChildProcess>()

/** Register (or update) a live run in the in-memory map. */
export function trackRun(run: AgentRun): void {
  runs.set(run.id, run)
}

export function getRun(id: string): AgentRun | null {
  return runs.get(id) ?? null
}

export function listRuns(): AgentRun[] {
  loadPersistedRuns()
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
}

/** Track the spawned child so cancel and will-quit can reach it. */
export function trackProc(id: string, p: ChildProcess): void {
  procs.set(id, p)
}

export function getProc(id: string): ChildProcess | undefined {
  return procs.get(id)
}

/** Forget a child that exited on its own. */
export function releaseProc(id: string): void {
  procs.delete(id)
}

/**
 * Kill every in-process agent run. Called from `will-quit`: without it, quitting
 * TerMinal with agent sessions running left `claude`/`codex` children alive —
 * invisible, billable, and still pushing commits.
 *
 * SIGKILL, not SIGTERM: `will-quit` gives us no time to wait for a graceful
 * shutdown, and a half-exited engine is worse than a killed one.
 */
export function killAllAgentRuns(): number {
  let killed = 0
  for (const [, p] of procs) {
    killProcessGroup(p, 'SIGKILL')
    killed++
  }
  procs.clear()
  return killed
}

let emit: (channel: string, payload: unknown) => void = () => {}
export function onAgentEvent(fn: (channel: string, payload: unknown) => void) {
  emit = fn
}
/** Fire a renderer-bound agent event through whatever sink onAgentEvent bound. */
export function emitAgent(channel: string, payload: unknown): void {
  emit(channel, payload)
}

// --- persistence: one <id>.json (metadata) + <id>.log (output) per run --------
const RUNS_DIR = (): string => configPath('agent-runs')
const metaPath = (id: string) => join(RUNS_DIR(), `${id}.json`)
const logPath = (id: string) => join(RUNS_DIR(), `${id}.log`)
/** On-disk log path for the runs:log-tail IPC (tail-reads without loading the file). */
export const agentRunLogPath = logPath

// Read a persisted agent run's full log from disk by id — so a run that aged out
// of the in-memory working set is still viewable in the Runs tab. Returns '' if
// absent. Mirrors readCronRunLog.
export function readAgentRunLog(id: string): string {
  try {
    return readFileSync(logPath(id), 'utf8')
  } catch {
    return ''
  }
}

export function persistRunMeta(run: AgentRun): void {
  try {
    mkdirSync(RUNS_DIR(), { recursive: true })
    const { output: _o, ...meta } = run
    writeFileSync(metaPath(run.id), JSON.stringify(meta))
  } catch {
    /* best effort */
  }
}

export function appendRunLog(id: string, chunk: string): void {
  try {
    appendFileSync(logPath(id), chunk)
  } catch {
    /* best effort */
  }
}

// Load past runs from disk into memory at startup. Runs still marked 'running'
// were orphaned by an app quit → mark 'interrupted'. Prune to the newest N.
let loaded = false
export function loadPersistedRuns() {
  if (loaded) return
  loaded = true
  let files: string[] = []
  try {
    files = readdirSync(RUNS_DIR()).filter((f) => f.endsWith('.json'))
  } catch {
    return
  }
  const metas: AgentRun[] = []
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(join(RUNS_DIR(), f), 'utf8')) as AgentRun
      if (m.status === 'running') m.status = 'interrupted'
      metas.push(m)
    } catch {
      /* skip corrupt */
    }
  }
  // Never delete run files (storage is cheap — the user prunes manually). Only
  // load the most recent N into memory to bound RAM; older runs stay on disk and
  // remain viewable via readAgentRunLog. 0 = load all.
  // Logs are read AFTER the cap is applied, and only their last OUTPUT_CAP
  // bytes — run history grows without bound, and reading every log in full at
  // startup blocked the main process linearly with it.
  const cap = readSettings().runMemoryCap
  const inMemory = inMemoryWorkingSet(metas, cap)
  for (const m of inMemory) {
    if (runs.has(m.id)) continue // never clobber a live (in-memory) run
    let output = ''
    try {
      output = readFileTail(logPath(m.id), OUTPUT_CAP).text
    } catch {
      /* no log */
    }
    runs.set(m.id, { ...m, output })
    if (m.status === 'interrupted') persistRunMeta(m) // persist the corrected status
  }
}
