import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

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
}

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
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
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
}
export function getRun(id: string): AgentRun | null {
  return runs.get(id) ?? null
}

export function runAgent(repoRoot: string, agentId: string): AgentRun | { error: string } {
  const agent = readAgents(repoRoot).find((a) => a.id === agentId)
  if (!agent) return { error: 'unknown agent' }
  const ts = Date.now()
  const branch = `agent/${agent.id}-${ts}`
  const worktree = join(WORKTREES, basename(repoRoot) || 'repo', `${agent.id}-${ts}`)
  const base = defaultBase(repoRoot)
  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'add', worktree, '-b', branch, base], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return { error: `worktree: ${(e as Error).message}` }
  }

  const run: AgentRun = {
    id: randomUUID(),
    agentId,
    agentTitle: agent.title,
    status: 'running',
    startedAt: ts,
    repoRoot,
    worktree,
    branch,
    output: `▸ ${agent.title} · worktree ${worktree}\n▸ branch ${branch} (off ${base})\n▸ codex exec…\n\n`,
  }
  runs.set(run.id, run)
  emit('agent:status', run)

  // run codex through a login shell so $PATH includes brew (codex isn't on a GUI
  // app's default PATH)
  const cmd = `codex exec -s danger-full-access -C ${shq(worktree)} ${shq(agent.prompt)}`
  const p = spawn(LOGIN_SHELL, ['-l', '-c', cmd], { cwd: worktree, env: process.env })
  procs.set(run.id, p)

  const append = (d: Buffer) => {
    run.output += d.toString()
    if (run.output.length > OUTPUT_CAP) run.output = run.output.slice(-OUTPUT_CAP)
    emit('agent:output', { runId: run.id, chunk: d.toString() })
  }
  p.stdout?.on('data', append)
  p.stderr?.on('data', append)
  p.on('error', (err) => {
    run.output += `\n[spawn error] ${err.message}\n`
    run.status = 'failed'
    run.endedAt = Date.now()
    procs.delete(run.id)
    emit('agent:status', run)
  })
  p.on('exit', (code) => {
    if (run.status !== 'canceled') run.status = code === 0 ? 'done' : 'failed'
    run.endedAt = Date.now()
    run.exitCode = code ?? undefined
    procs.delete(run.id)
    emit('agent:status', run)
  })
  return run
}

export function cancelRun(runId: string): boolean {
  const run = runs.get(runId)
  const p = procs.get(runId)
  if (run && run.status === 'running') run.status = 'canceled'
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
