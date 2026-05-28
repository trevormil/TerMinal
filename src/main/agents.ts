import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import {
  readFileSync,
  existsSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { emitActivity } from './events'
import { repoForCwd } from './repo'

export type Engine = 'codex' | 'claude'

// On-demand Codex agents. Each runs in its own git worktree off the default
// branch; codex does the work, files tickets, and opens the PR itself. We just
// orchestrate the worktree + process and stream the output.

export type Agent = {
  id: string
  title: string
  description?: string
  icon?: string
  prompt: string
  opensPr?: boolean
  engine?: Engine // default engine; overridable per run
}

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
  engine: Engine
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  worktree: string
  branch: string
  output: string
}

const WORKTREES = join(homedir(), 'CompSci', 'gauntlet', '.worktrees')
const OUTPUT_CAP = 400_000
const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

// Shipped by default on every repo. A repo's .agents/agents.json overrides or
// extends these (matched by id). All three are ticket/MR-driven: file tickets
// for findings, open a PR when there are code changes.
const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'docs',
    title: 'Improve docs',
    description: 'Generate/improve developer-facing documentation, then open a PR.',
    icon: 'BookText',
    opensPr: true,
    prompt:
      "Act as the documentation agent for technical developers. Improve and generate developer-facing documentation for this repository: README, docs/architecture.md, docs/runbooks, ADRs/learnings, and sidecar docs where behavior is undocumented or stale. Sweep recent git history for undocumented changes. Make accurate, surgical edits — never invent behavior. Then commit your changes and open a PR with a clear summary. For larger documentation gaps you can't finish in one pass, file a backlog ticket each (type: docs). End with a summary of the PR and any tickets filed.",
  },
  {
    id: 'deep-audit',
    title: 'Deep audit',
    description: 'Audit the codebase; file a ticket per finding, PR any safe fixes.',
    icon: 'ScanSearch',
    opensPr: true,
    prompt:
      'Act as a deep-audit agent for this repository. Thoroughly audit the codebase across correctness, security, architecture, performance, dead code, and dependency hygiene. For EVERY notable finding, file a backlog ticket (one per finding) with an accurate title, a type (bug/security/performance/dx/etc.), a priority, a specific description citing files and lines, and a self-contained agent-runnable fix prompt. Prefer filing tickets over making changes. If you apply any safe, self-contained fixes during the audit, commit them and open a PR. Do not make sweeping refactors. End with a summary listing every ticket filed (by id) and the PR if one was opened.',
  },
  {
    id: 'ticket-pr-cleanup',
    title: 'Ticket / PR cleanup',
    description: 'Reconcile the backlog + open PRs; close/dedupe/fix, file follow-ups, PR changes.',
    icon: 'ListChecks',
    opensPr: true,
    prompt:
      'Act as the ticket & PR cleanup agent for this repository. Review the backlog/ tickets and the open PRs, and reconcile them with reality: close or icebox stale, duplicate, or obsolete tickets (add a brief closing note to each), fix inconsistent or missing metadata (status, priority, type, horizon), and close tickets whose work already shipped (unlink merged PRs). File new tickets for any gaps or follow-ups you discover. If your cleanup changes ticket files or code, commit and open a PR. End with a summary of what you closed, edited, and filed, plus the PR if one was opened.',
  },
]

function readRepoAgents(repoRoot: string): Agent[] {
  const f = join(repoRoot, '.agents', 'agents.json')
  if (!existsSync(f)) return []
  try {
    const a = JSON.parse(readFileSync(f, 'utf8'))
    const list = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : []
    return list.filter((x: Agent) => x && x.id && x.title && x.prompt)
  } catch {
    return []
  }
}

/** Built-in defaults, with the repo's .agents/agents.json overriding by id. */
export function readAgents(repoRoot: string): Agent[] {
  const byId = new Map<string, Agent>()
  for (const a of DEFAULT_AGENTS) byId.set(a.id, a)
  for (const a of readRepoAgents(repoRoot)) byId.set(a.id, a)
  return [...byId.values()]
}

// every git repo gets the default agents
export function hasAgents(repoRoot: string): boolean {
  return !!repoRoot
}

const runs = new Map<string, AgentRun>()
const procs = new Map<string, ChildProcess>()
let emit: (channel: string, payload: unknown) => void = () => {}
export function onAgentEvent(fn: (channel: string, payload: unknown) => void) {
  emit = fn
}

// --- persistence: one <id>.json (metadata) + <id>.log (output) per run --------
const RUNS_DIR = join(homedir(), '.config', 'gauntlet-terminal', 'agent-runs')
const KEEP_RUNS = 100
const metaPath = (id: string) => join(RUNS_DIR, `${id}.json`)
const logPath = (id: string) => join(RUNS_DIR, `${id}.log`)

function persistMeta(run: AgentRun) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true })
    const { output: _o, ...meta } = run
    writeFileSync(metaPath(run.id), JSON.stringify(meta))
  } catch {
    /* best effort */
  }
}
function appendLog(id: string, chunk: string) {
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
    files = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return
  }
  const metas: AgentRun[] = []
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8')) as AgentRun
      if (m.status === 'running') m.status = 'interrupted'
      let output = ''
      try {
        const buf = readFileSync(logPath(m.id), 'utf8')
        output = buf.length > OUTPUT_CAP ? buf.slice(-OUTPUT_CAP) : buf
      } catch {
        /* no log */
      }
      metas.push({ ...m, output })
    } catch {
      /* skip corrupt */
    }
  }
  metas.sort((a, b) => a.startedAt - b.startedAt)
  // prune oldest beyond KEEP_RUNS (delete files too)
  while (metas.length > KEEP_RUNS) {
    const old = metas.shift()!
    try {
      rmSync(metaPath(old.id), { force: true })
      rmSync(logPath(old.id), { force: true })
    } catch {
      /* ignore */
    }
  }
  for (const m of metas) {
    if (runs.has(m.id)) continue // never clobber a live (in-memory) run
    runs.set(m.id, m)
    if (m.status === 'interrupted') persistMeta(m) // persist the corrected status
  }
}

function defaultBase(repoRoot: string): string {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '')
  } catch {
    /* no origin HEAD */
  }
  for (const b of ['main', 'master']) {
    try {
      git(['rev-parse', '--verify', b])
      return b
    } catch {
      /* not present */
    }
  }
  return 'HEAD'
}

export function listRuns(): AgentRun[] {
  loadPersistedRuns()
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
}
export function getRun(id: string): AgentRun | null {
  return runs.get(id) ?? null
}

// Build the engine command. codex needs -C; claude uses cwd. Both run through a
// login shell so $PATH has brew/local bins, and with stdin = /dev/null (else
// they block reading "additional input from stdin" on an empty pipe).
function buildCmd(engine: Engine, worktree: string, prompt: string): string {
  if (engine === 'claude') {
    const bin = process.env.GT_CLAUDE_BIN || 'claude'
    return `${bin} -p ${shq(prompt)} --dangerously-skip-permissions`
  }
  return `codex exec -s danger-full-access -C ${shq(worktree)} ${shq(prompt)}`
}

type RunSpec = { id: string; title: string; prompt: string; engine: Engine }

function runSpec(repoRoot: string, spec: RunSpec): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const ts = Date.now()
  const branch = `agent/${spec.id}-${ts}`
  const worktree = join(WORKTREES, basename(repoRoot) || 'repo', `${spec.id}-${ts}`)
  const base = defaultBase(repoRoot)
  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'add', worktree, '-b', branch, base], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return { error: `worktree: ${(e as Error).message}` }
  }
  const repoLabel = repoForCwd(repoRoot)?.path || basename(repoRoot)
  const run: AgentRun = {
    id: randomUUID(),
    agentId: spec.id,
    agentTitle: spec.title,
    engine: spec.engine,
    status: 'running',
    startedAt: ts,
    repoRoot,
    worktree,
    branch,
    output: `▸ ${spec.title} · ${spec.engine} · worktree ${worktree}\n▸ branch ${branch} (off ${base})\n▸ running…\n\n`,
  }
  runs.set(run.id, run)
  persistMeta(run)
  appendLog(run.id, run.output)
  emit('agent:status', run)
  emitActivity(
    { kind: 'agent-run', title: `Agent started · ${spec.title}`, detail: `${spec.engine} · ${repoLabel}`, repo: repoLabel, repoRoot },
    { notify: false },
  )

  const p = spawn(LOGIN_SHELL, ['-l', '-c', buildCmd(spec.engine, worktree, spec.prompt)], {
    cwd: worktree,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  procs.set(run.id, p)
  const append = (d: Buffer) => {
    const chunk = d.toString()
    run.output += chunk
    if (run.output.length > OUTPUT_CAP) run.output = run.output.slice(-OUTPUT_CAP)
    appendLog(run.id, chunk)
    emit('agent:output', { runId: run.id, chunk })
  }
  p.stdout?.on('data', append)
  p.stderr?.on('data', append)
  p.on('error', (err) => {
    run.output += `\n[spawn error] ${err.message}\n`
    appendLog(run.id, `\n[spawn error] ${err.message}\n`)
    run.status = 'failed'
    run.endedAt = Date.now()
    procs.delete(run.id)
    persistMeta(run)
    emit('agent:status', run)
    emitActivity({ kind: 'agent-run', title: `Agent failed · ${spec.title}`, detail: err.message, repo: repoLabel, repoRoot })
  })
  p.on('exit', (code) => {
    if (run.status !== 'canceled') run.status = code === 0 ? 'done' : 'failed'
    run.endedAt = Date.now()
    run.exitCode = code ?? undefined
    procs.delete(run.id)
    persistMeta(run)
    emit('agent:status', run)
    emitActivity({
      kind: 'agent-run',
      title: `Agent ${run.status} · ${spec.title}`,
      detail: `${spec.engine} · ${run.branch}`,
      repo: repoLabel,
      repoRoot,
    })
  })
  return run
}

export function runAgent(repoRoot: string, agentId: string, engine?: Engine): AgentRun | { error: string } {
  const agent = readAgents(repoRoot).find((a) => a.id === agentId)
  if (!agent) return { error: 'unknown agent' }
  return runSpec(repoRoot, {
    id: agent.id,
    title: agent.title,
    prompt: agent.prompt,
    engine: engine || agent.engine || 'codex',
  })
}

/** Turn a backlog ticket into an implementation run that opens a PR. */
export function runTicketAgent(
  repoRoot: string,
  ticket: { id: number; title: string; body: string },
  engine: Engine,
): AgentRun | { error: string } {
  const prompt = `Implement backlog ticket #${ticket.id}: ${ticket.title}\n\n${ticket.body}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. Commit your work and open a PR that references ticket #${ticket.id}. If fully delivered set the ticket status to closed (else in-progress) and link the PR in its prs: field. End with a short summary of what changed and the PR URL.`
  return runSpec(repoRoot, { id: `ticket-${ticket.id}`, title: `Implement #${ticket.id}`, prompt, engine })
}

export function cancelRun(runId: string): boolean {
  const run = runs.get(runId)
  const p = procs.get(runId)
  if (run && run.status === 'running') {
    run.status = 'canceled'
    persistMeta(run)
  }
  p?.kill('SIGTERM')
  return !!p
}

/** Remove a finished run's worktree (the branch/commits/PR remain). */
export function removeWorktree(runId: string): boolean {
  const run = runs.get(runId)
  if (!run || run.status === 'running') return false
  try {
    execFileSync('git', ['-C', run.repoRoot, 'worktree', 'remove', run.worktree, '--force'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}
