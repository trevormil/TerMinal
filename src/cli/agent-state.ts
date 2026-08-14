// ---------------------------------------------------------------------------
// state — per-(repo, agent) JSON sidecar at
//   ~/.config/TerMinal/agent-state/<repo-basename>/<agent-id>.json
//
// Canonical fields the harness owns:
//   lastScannedSha   sha of main/master at the end of the previous successful
//                    scan. Agents use this to compute `git log <sha>..HEAD` and
//                    only act on new commits.
//   lastRunAt        ms epoch of the run that set lastScannedSha.
//   lastRunId        run id (matches TERMINAL_RUN_ID) of the same run.
//
// Beyond those, scripts can set/get arbitrary string keys via `state set` /
// `state get`. Values are stored as-is on disk; the writer JSON-parses when
// possible so booleans/numbers/arrays round-trip cleanly.
// ---------------------------------------------------------------------------
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { withFileLockShared, writeJsonAtomicShared } from '../runner/state-io'
import { AGENT_STATE_DIR, agentId, repo, repoLabel, runId } from './env'

type AgentState = Record<string, unknown>

function stateFile(): string {
  if (!repo()) {
    console.error(
      'terminal-cli state: TERMINAL_REPO not set — scripts must be invoked by the TerMinal runner',
    )
    process.exit(2)
  }
  if (!agentId()) {
    console.error(
      'terminal-cli state: TERMINAL_AGENT_ID not set — pass --agent <id> or invoke via the runner',
    )
    process.exit(2)
  }
  const slug = repoLabel() || 'unknown'
  return join(AGENT_STATE_DIR(), slug, `${agentId()}.json`)
}

function readState(): AgentState {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    return {}
  }
}

function writeState(obj: AgentState): void {
  const f = stateFile()
  mkdirSync(dirname(f), { recursive: true })
  withFileLockShared(f, () => writeJsonAtomicShared(f, obj))
}

function coerce(v: string | undefined): unknown {
  if (v === undefined) return undefined
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

function mainBranchSha(): { ref: string; sha: string } {
  try {
    // Prefer origin/main if the repo has one, else origin/master, else local
    // main/master. Falls through to HEAD if none of those exist.
    const candidates = ['origin/main', 'origin/master', 'main', 'master', 'HEAD']
    for (const ref of candidates) {
      try {
        const sha = execSync(`git rev-parse --verify --quiet ${ref}`, {
          cwd: repo(),
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim()
        if (sha) return { ref, sha }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* not a git repo */
  }
  return { ref: '', sha: '' }
}

export function stateCommand(sub: string | undefined, rest: string[]): void {
  if (!sub || sub === 'get') {
    const key = rest[0]
    const s = readState()
    if (key) {
      const v = s[key]
      console.log(v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))
    } else {
      console.log(JSON.stringify(s, null, 2))
    }
    return
  }
  if (sub === 'get-sha') {
    console.log(readState().lastScannedSha || '')
    return
  }
  if (sub === 'set-sha') {
    const sha = rest[0]
    if (!sha) {
      console.error('terminal-cli state set-sha: missing <sha> argument')
      process.exit(2)
    }
    const s = readState()
    s.lastScannedSha = sha
    s.lastRunAt = Date.now()
    if (runId()) s.lastRunId = runId()
    writeState(s)
    return
  }
  if (sub === 'mark-main') {
    // Convenience: fetch + record origin/main (or fallback) tip as
    // lastScannedSha. The canonical "I've scanned trunk through here" call.
    try {
      execSync('git fetch --quiet origin', { cwd: repo(), stdio: 'ignore' })
    } catch {
      /* offline / no remote — fall back to local ref */
    }
    const { ref, sha } = mainBranchSha()
    if (!sha) {
      console.error('terminal-cli state mark-main: no main/master ref resolvable in this repo')
      process.exit(2)
    }
    const s = readState()
    s.lastScannedSha = sha
    s.lastScannedRef = ref
    s.lastRunAt = Date.now()
    if (runId()) s.lastRunId = runId()
    writeState(s)
    console.log(sha)
    return
  }
  if (sub === 'set') {
    const key = rest[0]
    const val = rest[1]
    if (!key) {
      console.error('terminal-cli state set: missing <key>')
      process.exit(2)
    }
    const s = readState()
    s[key] = coerce(val)
    writeState(s)
    return
  }
  console.error(
    'usage: terminal-cli state [get [key] | get-sha | set <key> <value> | set-sha <sha> | mark-main]',
  )
  process.exit(2)
}
