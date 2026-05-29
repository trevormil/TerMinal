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
import { forgeFor } from './forge'
import { getPersona } from './personas'
import { enginePath, resolvedWorktreesDir } from './settings'
import { readGlobalAgents, saveGlobalAgent } from './agents-global'
import { fileHitl } from './hitl'
import { composeSteps, pipelineLabel, type Step } from './pipelines'

export { listPipelines, type PipelineId } from './pipelines'

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
  // Per-engine model alias (claude: "haiku"|"sonnet"|"opus"; codex: model name
  // like "gpt-5-codex", "gpt-5", "o4-mini"). undefined → engine default. Lets
  // lightweight agents (health, deps audit) avoid burning the biggest model.
  model?: string
  // Run directly in the repo (no fresh worktree) — e.g. orchestrators like
  // /factory that manage their own worktrees internally, or quick additive ops.
  inPlace?: boolean
  // provenance (set by readAgents): a built-in default, a default overridden by
  // this repo's .agents/agents.json, a repo-only agent, a global agent
  // (~/.config/TerMinal/agents/global.json), or a default overridden globally.
  source?: 'default' | 'override' | 'repo' | 'global'
}

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
  engine: Engine
  persona?: string
  pipeline?: string // display label when this run chained multiple stages
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  worktree: string
  branch: string
  output: string
}

const OUTPUT_CAP = 400_000
const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

// Shipped by default on every repo. A repo's .agents/agents.json overrides or
// extends these (matched by id). All are ticket/MR-driven: file tickets
// for findings, open a PR when there are code changes. The factory entry is
// inPlace (no worktree) because /factory itself manages worktrees per stacked
// MR — wrapping it in one would create confusing worktree-inside-worktree.
const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'factory',
    title: 'Run /factory',
    description:
      'Continuous orchestrator — reconcile, run /stacked-mr passes, handle verdicts. Never merges main.',
    icon: 'Factory',
    opensPr: false,
    inPlace: true,
    prompt:
      "Act as the /factory orchestrator for THIS repository, following the project's /factory skill exactly. Continuously turn the backlog into REVIEWED, merge-ready PRs: reconcile with /merge-sync, then run /stacked-mr passes (build a stack TDD-first → batch-review to the bar → handle verdicts), repeating until the in-scope backlog is dry. NEVER merge to main/master — the human merges. Park any TRUE human-need (decision, approval, creds, hard blocker) to the global HITL inbox with .claude/bin/hitl. Skip tickets blocked by depends_on (any dependency whose status is not closed). Emit an activity event at each checkpoint. Do not invent scope. End with the stack summary for the human to merge.",
  },
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
  {
    id: 'test-coverage',
    title: 'Strengthen tests',
    description: 'Add meaningful tests for under-tested behavior, then open a PR.',
    icon: 'TestTube2',
    opensPr: true,
    prompt:
      'Act as a test-coverage agent for this repository. Identify the most important under-tested or untested behavior (prioritize core logic, error paths, and recently-changed code) and add meaningful, adversarial tests that would catch real regressions — no tautological or implementation-mirroring assertions. Follow the project test runner and conventions, keep changes surgical, and make sure new tests exercise a real entry point. Commit and open a PR. For larger coverage gaps you cannot finish in one pass, file a backlog ticket each (type: testing). End with a summary of what you covered and the PR URL.',
  },
  {
    id: 'security-sweep',
    title: 'Security sweep',
    description: 'Focused security audit; ticket per finding, PR the safe fixes.',
    icon: 'ShieldAlert',
    opensPr: true,
    prompt:
      'Act as a focused security-sweep agent for this repository. Audit for exploitable vulnerabilities: injection (SQL/command/template), XSS/SSRF, broken authentication/authorization, insecure deserialization, secrets committed in code or git history, unsafe file/path handling, and vulnerable dependencies. For every finding, file a backlog ticket (type: security) with a precise title, a severity-aware priority, the affected files/lines, and a self-contained agent-runnable fix prompt. Apply only clearly-safe, self-contained fixes (with tests) and open a PR for those. End with a summary listing every ticket filed and the PR if one was opened.',
  },
  {
    id: 'perf-pass',
    title: 'Performance pass',
    description: 'Find + fix the highest-impact runtime/memory issues; PR the wins.',
    icon: 'Gauge',
    opensPr: true,
    prompt:
      'Act as a performance agent for this repository. Find the highest-impact runtime and memory issues — N+1 queries, accidentally-quadratic loops, redundant work in hot paths, missing batching/streaming, and avoidable allocations. Measure before/after where feasible and record the numbers. Apply safe, well-scoped optimizations with tests (do not trade readability for marginal gains) and open a PR. File a backlog ticket (type: performance) for any larger optimization you cannot safely land in one pass. End with a summary of the wins and the PR URL.',
  },
  {
    id: 'dep-upgrade',
    title: 'Dependency hygiene',
    description: 'Audit deps; bump safe pinned versions; PR with lockfile.',
    icon: 'PackageCheck',
    opensPr: true,
    prompt:
      'Act as a dependency-hygiene agent for this repository. Audit dependencies for known vulnerabilities and staleness. Upgrade safe, low-risk dependencies — pin exact versions (no ^ or ~), commit the lockfile, and only adopt versions at least 3 days old (a security-critical CVE fix may override the age rule; note it in the commit). Run the project audit and full test suite to confirm nothing breaks, then open a PR. File a backlog ticket for any risky or major upgrade that needs human judgment. End with a summary of what was bumped and the PR URL.',
  },
  {
    id: 'dead-code',
    title: 'Dead-code cleanup',
    description: 'Remove provably-unused code safely; ticket the uncertain; PR.',
    icon: 'Eraser',
    opensPr: true,
    prompt:
      'Act as a dead-code cleanup agent for this repository. Find unused exports, unreachable branches, orphaned files, and stale feature flags. Remove only what is provably unused (verify with a references/usage search and the type checker/build), keeping changes surgical and reversible. Run the test suite and build to confirm nothing breaks, then open a PR. For anything you suspect is dead but cannot prove safely, file a backlog ticket instead of deleting. End with a summary of what you removed and the PR URL.',
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

/** Built-in defaults, with the repo's .agents/agents.json overriding by id.
 *  Each agent is annotated with its `source` so the UI can distinguish a stock
 *  default, a default this repo has customized, and a repo-only agent. */
export function readAgents(repoRoot: string): Agent[] {
  const defaultIds = new Set(DEFAULT_AGENTS.map((a) => a.id))
  const global = readGlobalAgents()
  const globalIds = new Set(global.map((a) => a.id))
  const repo = readRepoAgents(repoRoot)
  const repoIds = new Set(repo.map((a) => a.id))
  const byId = new Map<string, Agent>()
  // Order matters: defaults → global → repo. Later layers win by id and the
  // provenance label reflects "any earlier layer also had this id" as override.
  for (const a of DEFAULT_AGENTS)
    byId.set(a.id, {
      ...a,
      source: repoIds.has(a.id) || globalIds.has(a.id) ? 'override' : 'default',
    })
  for (const a of global)
    byId.set(a.id, {
      ...a,
      source: defaultIds.has(a.id) || repoIds.has(a.id) ? 'override' : 'global',
    })
  for (const a of repo)
    byId.set(a.id, {
      ...a,
      source: defaultIds.has(a.id) || globalIds.has(a.id) ? 'override' : 'repo',
    })
  return [...byId.values()]
}

/** Upsert an agent into <repo>/.agents/agents.json (creates it). Overriding a
 *  built-in default = writing an entry with the same id. */
export function saveAgent(
  repoRoot: string,
  agent: Partial<Agent> & { id: string; title: string; prompt: string },
): { ok: true } | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const id = (agent.id || '').trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: 'id must be kebab-case (a-z, 0-9, -)' }
  if (!agent.title?.trim()) return { error: 'title is required' }
  if (!agent.prompt?.trim()) return { error: 'prompt is required' }
  const entry: Agent = {
    id,
    title: agent.title.trim(),
    prompt: agent.prompt.trim(),
    description: agent.description?.trim() || undefined,
    icon: agent.icon || undefined,
    engine: agent.engine,
    model: agent.model?.trim() || undefined,
    opensPr: agent.opensPr,
    inPlace: agent.inPlace,
  }
  const dir = join(repoRoot, '.agents')
  const f = join(dir, 'agents.json')
  const list = readRepoAgents(repoRoot).filter((a) => a.id !== id)
  list.push(entry)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(f, JSON.stringify(list, null, 2) + '\n')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Remove an agent override from .agents/agents.json — a customized default
 *  reverts to the built-in; a repo-only agent is deleted. */
export function resetAgent(repoRoot: string, id: string): { ok: true } | { error: string } {
  const f = join(repoRoot, '.agents', 'agents.json')
  if (!existsSync(f)) return { ok: true }
  try {
    const list = readRepoAgents(repoRoot).filter((a) => a.id !== id)
    writeFileSync(f, JSON.stringify(list, null, 2) + '\n')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
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
const RUNS_DIR = join(homedir(), '.config', 'TerMinal', 'agent-runs')
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
function buildCmd(engine: Engine, worktree: string, prompt: string, model?: string): string {
  const bin = enginePath(engine)
  const modelFlag = model ? ` --model ${shq(model)}` : ''
  if (engine === 'claude') {
    return `${shq(bin)} -p ${shq(prompt)} --dangerously-skip-permissions${modelFlag}`
  }
  return `${shq(bin)} exec -s danger-full-access -C ${shq(worktree)}${modelFlag} ${shq(prompt)}`
}

// Pipeline definitions + composition are pure (see ./pipelines, unit-tested).
// All stages share the worktree + branch, so a later stage sees what an earlier
// one committed. buildSteps just resolves the persona prompt off disk first.
function buildSteps(repoRoot: string, base: Step, personaId?: string, pipelineId?: string) {
  const p = personaId ? getPersona(repoRoot, personaId) : null
  return {
    steps: composeSteps(base, p?.prompt ?? null, pipelineId),
    persona: p?.title,
    pipeline: pipelineLabel(pipelineId),
  }
}

type RunSpec = {
  id: string
  title: string
  steps: Step[]
  engine: Engine
  persona?: string
  pipeline?: string
  /** PR-tab agents work ON an existing MR head instead of a fresh branch. */
  prRef?: { iid: number; sourceBranch: string }
  /** Run in the repo itself (no worktree) — for quick, additive ops like ticket filing. */
  inPlace?: boolean
  /** Optional per-engine model alias passed to the CLI as `--model <name>`. */
  model?: string
}

function runSpec(repoRoot: string, spec: RunSpec): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  if (!spec.steps.length) return { error: 'no steps' }
  // Concurrent-run guard: never let two runs of the same agent on the same
  // repo overlap. If one is already running, surface HITL + refuse the new
  // run rather than silently allowing duplicates to thrash on the same worktree.
  for (const r of runs.values()) {
    if (r.status === 'running' && r.agentId === spec.id && r.repoRoot === repoRoot) {
      const msg = `${spec.title} is already running (run ${r.id.slice(0, 8)}) — refusing to start a duplicate`
      fileHitl({
        source: 'agent',
        title: `Duplicate agent run blocked · ${spec.title}`,
        action: 'another run is in progress; cancel it or wait for it to finish',
        detail: `existing run ${r.id} · started ${new Date(r.startedAt).toLocaleString()}`,
        repo: basename(repoRoot),
        repoRoot,
      })
      return { error: msg }
    }
  }
  const ts = Date.now()
  // ts + random tag → unique worktree path + branch even if two runs of the
  // same agent start in the same millisecond (parallel fan-out / fast clicks).
  const tag = `${ts}-${Math.random().toString(36).slice(2, 6)}`
  let worktree: string
  let branch: string
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (spec.inPlace) {
    // Run directly in the repo (no worktree) — e.g. quick ticket filing that must
    // land in the real backlog/, visible immediately, not on an isolated branch.
    worktree = repoRoot
    branch = '(working tree)'
  } else {
    worktree = join(resolvedWorktreesDir(), basename(repoRoot) || 'repo', `${spec.id}-${tag}`)
    try {
      if (spec.prRef) {
        // Fetch the MR head and check it out detached; the agent pushes back to
        // the source branch. Reference origin/<branch> rather than the shared
        // FETCH_HEAD so concurrent PR agents don't clobber each other.
        git(['fetch', 'origin', spec.prRef.sourceBranch])
        let ref = `origin/${spec.prRef.sourceBranch}`
        try {
          git(['rev-parse', '--verify', '--quiet', ref])
        } catch {
          ref = 'FETCH_HEAD' // remote-tracking ref not configured — best effort
        }
        git(['worktree', 'add', '--detach', worktree, ref])
        branch = spec.prRef.sourceBranch
      } else {
        branch = `agent/${spec.id}-${tag}`
        git(['worktree', 'add', worktree, '-b', branch, defaultBase(repoRoot)])
      }
    } catch (e) {
      return { error: `worktree: ${(e as Error).message}` }
    }
  }
  const repoLabel = repoForCwd(repoRoot)?.path || basename(repoRoot)
  const baseLine = spec.prRef
    ? `▸ on ${forgeFor(repoRoot).label} ${forgeFor(repoRoot).sym}${spec.prRef.iid} · branch ${branch}`
    : `▸ branch ${branch} (off ${defaultBase(repoRoot)})`
  const header =
    `▸ ${spec.title} · ${spec.engine}${spec.persona ? ` · as ${spec.persona}` : ''}` +
    `${spec.pipeline ? ` · ${spec.pipeline}` : ''}\n${baseLine}\n▸ worktree ${worktree}\n\n`
  const run: AgentRun = {
    id: randomUUID(),
    agentId: spec.id,
    agentTitle: spec.title,
    engine: spec.engine,
    persona: spec.persona,
    pipeline: spec.pipeline,
    status: 'running',
    startedAt: ts,
    repoRoot,
    worktree,
    branch,
    output: header,
  }
  runs.set(run.id, run)
  persistMeta(run)
  appendLog(run.id, run.output)
  emit('agent:status', run)
  emitActivity(
    { kind: 'agent-run', title: `Agent started · ${spec.title}`, detail: `${spec.engine} · ${repoLabel}`, repo: repoLabel, repoRoot },
    { notify: false },
  )

  const append = (chunk: string) => {
    run.output += chunk
    if (run.output.length > OUTPUT_CAP) run.output = run.output.slice(-OUTPUT_CAP)
    appendLog(run.id, chunk)
    emit('agent:output', { runId: run.id, chunk })
  }

  let settled = false
  const finalize = (status: AgentRunStatus, exitCode?: number) => {
    if (settled) return
    settled = true
    run.status = status
    run.endedAt = Date.now()
    run.exitCode = exitCode
    procs.delete(run.id)
    persistMeta(run)
    emit('agent:status', run)
    emitActivity({
      // infra/run failures surface as 'error' (notify) so they don't hide in the
      // agent-run stream; normal completions stay 'agent-run'.
      kind: status === 'failed' || status === 'interrupted' ? 'error' : 'agent-run',
      title: `Agent ${status} · ${spec.title}`,
      detail: `${spec.engine} · ${branch}`,
      repo: repoLabel,
      repoRoot,
    })
  }

  let stepIdx = 0
  const runStep = () => {
    const step = spec.steps[stepIdx]
    if (spec.steps.length > 1) append(`\n━━ step ${stepIdx + 1}/${spec.steps.length} · ${step.label} ━━\n\n`)
    const p = spawn(LOGIN_SHELL, ['-l', '-c', buildCmd(spec.engine, worktree, step.prompt, spec.model)], {
      cwd: worktree,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    procs.set(run.id, p)
    p.stdout?.on('data', (d: Buffer) => append(d.toString()))
    p.stderr?.on('data', (d: Buffer) => append(d.toString()))
    p.on('error', (err) => {
      append(`\n[spawn error] ${err.message}\n`)
      finalize('failed')
    })
    p.on('exit', (code) => {
      if (run.status === 'canceled') return finalize('canceled', code ?? undefined)
      if (code !== 0) return finalize('failed', code ?? undefined)
      stepIdx++
      if (stepIdx < spec.steps.length) runStep()
      else finalize('done', 0)
    })
  }
  runStep()
  return run
}

export function runAgent(
  repoRoot: string,
  agentId: string,
  engine?: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
): AgentRun | { error: string } {
  const agent = readAgents(repoRoot).find((a) => a.id === agentId)
  if (!agent) return { error: 'unknown agent' }
  const { steps, persona, pipeline } = buildSteps(
    repoRoot,
    { label: agent.title, prompt: agent.prompt },
    personaId,
    pipelineId,
  )
  return runSpec(repoRoot, {
    id: agent.id,
    title: agent.title,
    steps,
    engine: engine || agent.engine || 'codex',
    persona,
    pipeline,
    inPlace: agent.inPlace,
    model: model ?? agent.model,
  })
}

/** Spawn a claude/codex run that designs a new agent from a natural-language
 *  description and saves it into the active scope (the active repo's
 *  .agents/agents.json, or the global registry). Runs inPlace — no fresh
 *  worktree, no PR — because designing an agent is a quick read+write op. */
export function runDesignerSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  scope: 'repo' | 'global',
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const target =
    scope === 'global'
      ? join(homedir(), '.config', 'TerMinal', 'agents', 'global.json')
      : join(repoRoot, '.agents', 'agents.json')
  const scopeLabel = scope === 'global' ? "TerMinal's global agent registry (~/.config/TerMinal/agents/global.json)" : `this repo's .agents/agents.json`
  const prompt = `You are designing a new TerMinal agent definition from the user's natural-language description below.

Target: ${scopeLabel}
Target file (load JSON array if it exists, else create with parent dirs): ${target}

The agent format is an entry in the target JSON array with these fields:
  - id           kebab-case, unique in the target file
  - title        short user-facing label (e.g. "Audit security")
  - description  one-line summary
  - icon         lucide-react icon name — use one already used by an existing agent in this repo (Bot, BookText, ScanSearch, ListChecks, TestTube2, ShieldAlert, Gauge, PackageCheck, Eraser, etc.) or any lucide name appropriate to the agent's purpose
  - prompt       the prompt that runs the agent at execution time (write this BAKING IN this project's conventions — see below)
  - opensPr      boolean — true if the agent ends with a PR
  - engine       "claude" or "codex" — pick the better fit; the user can override per-run
  - inPlace      optional boolean — true ONLY if the agent itself manages worktrees (rare; usually false)

CONVENTIONS TO READ BEFORE DESIGNING THE PROMPT:
  1. CLAUDE.md (root) — project conventions and global rules.
  2. .agents/forge.md — the auto-mergeable label convention and forge command mapping.
  3. .agents/changelog.md or .agents/drift.md — examples of scheduled-agent specs.
  4. backlog/EXAMPLE.md or .claude/skills/ticket/EXAMPLE.md — ticket conventions, including depends_on.
  5. The agents already in .agents/agents.json (don't duplicate them; pick a distinct id).

THE AGENT'S PROMPT MUST FOLLOW:
  - The ticket + MR workflow uniformly: work in a worktree (the runner provides one unless you set inPlace), commit, push, open a PR via the project's pr-creation skill or gh/glab directly. The MERGE TO MAIN IS HUMAN-ONLY — never set --auto / --merge.
  - File backlog tickets for findings the agent cannot fix in-pass (with depends_on linkage when the work cascades).
  - Open a PR only when there are concrete changes. If the diff is ONLY docs/markdown/tickets/reports, the agent's prompt should instruct it to apply the auto-mergeable label per .agents/forge.md.
  - Explicit success criteria (what makes the run "done").
  - HITL only for true blockers (decisions, credentials, hard blockers) via .claude/bin/hitl.

User's description:
> ${t}

PROCESS:
  1. Read the conventions listed above (enough to write a faithful prompt).
  2. Pick a kebab-case id, short title, lucide icon, and engine.
  3. Author the agent prompt — surgical, specific, with the workflow rules baked in.
  4. Save the entry into ${target}. If the file exists, read its JSON array and append; if not, create with mkdir -p of the parent dir and an array containing just the new entry. Write valid JSON (2-space indent).
  5. Confirm by printing the new entry as JSON and the target path.

DO NOT open a PR, do not modify other agents, do not invent extra files.`
  return runSpec(repoRoot, {
    id: `design-${scope}`,
    title: `Design agent · ${t.slice(0, 48)}`,
    steps: [{ label: 'design agent', prompt }],
    engine,
    inPlace: true,
    model,
  })
}

export { saveGlobalAgent }

/** Spawn a claude/codex run that designs a new schedule entry from a natural-
 *  language description. Reads the active agent list + existing schedules,
 *  appends a new entry to ~/.config/TerMinal/schedules.json. After the run
 *  completes the renderer reconciles + relaunches the LaunchAgent. */
export function runScheduleDesignerSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const schedulesFile = join(homedir(), '.config', 'TerMinal', 'schedules.json')
  const agents = readAgents(repoRoot)
  const agentSummary = agents.length
    ? agents
        .map(
          (a) =>
            `  - id: ${a.id} · title: ${a.title}${a.description ? ` · ${a.description}` : ''} · default-engine: ${a.engine || 'claude'} · opensPr: ${!!a.opensPr}`,
        )
        .join('\n')
    : '  (none — the user should create an agent first via the Agents tab)'
  const prompt = `You are designing a new TerMinal scheduled run based on the user's natural-language description.

Available agents (use one of these IDS verbatim — do NOT invent a new one):

${agentSummary}

Target file: ${schedulesFile}
  - If it does not exist, treat as an empty JSON array.
  - If it exists, parse the JSON array, append the new entry, write back with 2-space indent.

Schedule entry schema:
{
  "id": "<uuid v4>",
  "repoRoot": "${repoRoot}",
  "repoLabel": "<basename of repoRoot, or the GitHub/GitLab owner/repo if obvious>",
  "agentId": "<one of the ids above>",
  "agentTitle": "<the matching agent's title>",
  "engine": "claude" | "codex",
  "prompt": "<copy the matching agent's prompt verbatim>",
  "spec": <a ScheduleSpec — see below>,
  "enabled": true,
  "createdAt": <epoch ms — use \`date +%s%3N\` or current ms>,
  "lastStatus": "never"
}

ScheduleSpec options:
  { "kind": "interval", "everyMinutes": <number> }                              # every N minutes
  { "kind": "calendar", "minute": 0, "hour": 9 }                                # every day at 9:00
  { "kind": "calendar", "minute": 30, "hour": 14, "weekdays": [1,3,5] }         # Mon/Wed/Fri 2:30pm
  { "kind": "cron",     "expr": "30 9 * * 1-5" }                                # raw 5-field cron

User's description:
> ${t}

PROCESS:
  1. Parse the user's description to extract (a) which agent and (b) the cadence.
  2. Match the agent by id from the list above. If no clear match, pick the closest reasonable one and NOTE that in your final summary so the user can adjust.
  3. Generate a UUID v4 (uuidgen on macOS, or a /dev/urandom hex if not).
  4. Read the existing ${schedulesFile} JSON array (or start with []).
  5. Append the new entry. Write back with 2-space indent.
  6. Print the new entry as JSON so the user can verify; mention the inferred cadence + agent in plain English ("Every Monday at 9am, run docs.").

DO NOT open a PR. DO NOT modify the repo. Only write to ${schedulesFile}.

After this completes the app reconciles schedules automatically — your new entry becomes a real LaunchAgent the next time it loads.`
  return runSpec(repoRoot, {
    id: 'design-schedule',
    title: `Design schedule · ${t.slice(0, 48)}`,
    steps: [{ label: 'design schedule', prompt }],
    engine,
    inPlace: true,
  })
}

/** Turn a backlog ticket into an implementation run that opens a PR. */
export function runTicketAgent(
  repoRoot: string,
  ticket: { id: number; title: string; body: string },
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
): AgentRun | { error: string } {
  const base = `Implement backlog ticket #${ticket.id}: ${ticket.title}\n\n${ticket.body}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. Commit your work and open a PR that references ticket #${ticket.id}. If fully delivered set the ticket status to closed (else in-progress) and link the PR in its prs: field. End with a short summary of what changed and the PR URL.`
  const { steps, persona, pipeline } = buildSteps(repoRoot, { label: `implement #${ticket.id}`, prompt: base }, personaId, pipelineId)
  return runSpec(repoRoot, { id: `ticket-${ticket.id}`, title: `Implement #${ticket.id}`, steps, engine, persona, pipeline, model })
}

/** Spawn an agent that files ONE backlog ticket from a freeform request. Runs
 *  in-place (no worktree) so the ticket lands in the real backlog/ immediately. */
export function runTicketSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const prompt = `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions: allocate the next id (use .claude/skills/ticket/bin/next-ticket-id if present, else the next NNNN above the highest in backlog/), write backlog/NNNN-slug.md with valid YAML frontmatter (id, title, status: open, priority, type, horizon: now) matching backlog/EXAMPLE.md, put any detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR — just file the ticket. Request: ${t}`
  return runSpec(repoRoot, {
    id: 'ticket-spawn',
    title: `File ticket · ${t.slice(0, 48)}`,
    steps: [{ label: 'file ticket', prompt }],
    engine,
    inPlace: true,
    model,
  })
}

/** Start the /factory orchestrator as an in-place run — drives the backlog to
 *  merge-ready PRs (stacked-mr passes, gated by review), never merging to main. */
export function runFactorySpawn(repoRoot: string, engine: Engine): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const prompt = `Run the /factory orchestrator for THIS repository, following the project's /factory skill exactly. Continuously turn the backlog into REVIEWED, merge-ready PRs: reconcile with /merge-sync, then run /stacked-mr passes (build a stack TDD-first → batch-review to the bar → handle verdicts), repeating until the in-scope backlog is dry. NEVER merge to main/master — the human merges. Park any TRUE human-need (decision, approval, creds, hard blocker) to the global HITL inbox with .claude/bin/hitl. Emit an activity event at each checkpoint. Do not invent scope. End with the stack summary for the human to merge.`
  return runSpec(repoRoot, {
    id: 'factory',
    title: 'Factory',
    steps: [{ label: 'factory loop', prompt }],
    engine,
    inPlace: true,
  })
}

export type PrAgentKind = 'review' | 'iterate'

/** Spin an agent out ON an open MR: checks out the MR head, reviews/iterates,
 *  and pushes back to the source branch to update it. */
export function runPrAgent(
  repoRoot: string,
  pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
  kind: PrAgentKind,
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
): AgentRun | { error: string } {
  if (!pr?.sourceBranch) return { error: 'PR/MR has no source branch' }
  const f = forgeFor(repoRoot)
  const tag = `${f.label} ${f.sym}${pr.iid}` // e.g. "PR #12" / "MR !12"
  const noteCmd =
    f.kind === 'github' ? `gh pr comment ${pr.iid} -b …` : `glab mr note ${pr.iid} -m …`
  const ref = pr.webUrl || `${f.sym}${pr.iid}`
  const ctx = `This worktree is checked out at the head of ${tag} (${ref}${pr.title ? ` — "${pr.title}"` : ''}) on branch "${pr.sourceBranch}". After committing, push back to the ${f.label} with \`git push origin HEAD:${pr.sourceBranch}\`.`
  const base: Step =
    kind === 'review'
      ? {
          label: `review ${f.sym}${pr.iid}`,
          prompt: `Do a thorough senior code review of ${tag}. ${ctx} Inspect \`git diff\` against the target branch and \`git log\`. Evaluate correctness, security, architecture, conformance, quality, and dependencies. Post your review on the ${f.label} (\`${noteCmd}\`). Where you find clear, safe fixes, apply them with tests, commit, and push. End with a concise verdict and the list of findings.`,
        }
      : {
          label: `iterate ${f.sym}${pr.iid}`,
          prompt: `Iterate on ${tag} until it is merge-ready. ${ctx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases — keep changes surgical. Commit and push your work. End with the final status (tests/build green?) and a short summary of what changed.`,
        }
  const { steps, persona, pipeline } = buildSteps(repoRoot, base, personaId, pipelineId)
  return runSpec(repoRoot, {
    id: `pr-${kind}-${pr.iid}`,
    title: `${kind === 'review' ? 'Review' : 'Iterate'} ${f.sym}${pr.iid}`,
    steps,
    engine,
    persona,
    pipeline,
    prRef: { iid: pr.iid, sourceBranch: pr.sourceBranch },
    model,
  })
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
  if (run.worktree === run.repoRoot) return false // in-place run — never remove the repo
  try {
    execFileSync('git', ['-C', run.repoRoot, 'worktree', 'remove', run.worktree, '--force'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}
