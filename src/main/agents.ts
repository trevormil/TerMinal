import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import {
  readFileSync,
  existsSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { emitActivity } from './events'
import { AGENT_TIMEOUT_EXIT, killProcessGroup, resolveRunTimeoutMs } from './process-group'
import { scriptWrapperArgs } from './script-wrapper'
import { inMemoryWorkingSet } from './run-retention'
import { readFileTail } from './fs-tail'
import { repoForCwd } from './repo'
import { forgeFor } from './forge'
import { getPersona } from './personas'
import {
  enginePath,
  engineDefaultModel,
  readSettings,
  resolvedWorktreesDir,
  resolvedOpenRouterKey,
  resolvedOpenAICompatKey,
  openAICompatBaseUrl,
} from './settings'
import { recordRunnerInvocation } from './ai-collectors'
import { resolveModel } from './resolve-model'
import { saveGlobalAgent } from './agents-global'
import { fileHitl } from './hitl'
import { composeSteps, pipelineLabel, type Step } from './pipelines'
import {
  getPersistentAgent,
  listPersistentAgents,
  persistentAgentDesignerPrompt,
  persistentAgentLaunchPrompt,
} from './persistent-agents'
import { createAgentStreamDecoder } from './agent-stream'
import { evaluateAgentRun } from './agent-run-evaluation'
import { withAgentContextPreamble } from './context-preamble'
import { getRepoTicket, repoTicketProvider, ticketProviderInstructions } from './ticket-provider'
import { promptLogBlock, type TicketComment } from './ticket-comments'
import { getTicket as getLocalTicket, updateTicket as updateLocalTicket } from './backlog'
import type { TicketAgent } from './backlog'
import { configPath } from './config-dir'

export { listPipelines, type PipelineId } from './pipelines'

// Re-exported so the ~40 existing importers of `Agent`, `AgentRun`,
// `DEFAULT_AGENTS` etc. keep working unchanged. A refactor that also rewrites
// every call site is two changes reviewed as one, and only one of them is
// mechanical.
export type * from './agent-types'
export { DEFAULT_AGENTS, FORCE_PREAMBLE } from './agent-catalog'
// The definition registry moved to agent-registry.ts (ticket 91); re-exported
// so the ~15 existing importers of readAgents/saveAgent/locateScript via
// './agents' keep working unchanged.
export { readAgents, saveAgent, resetAgent, hasAgents, locateScript } from './agent-registry'
import { readAgents, locateScript } from './agent-registry'

// Imported as well as re-exported: `export ... from` forwards names to
// consumers without binding them locally, and this module uses most of them.
import type {
  Agent,
  AgentCheck,
  AgentDefinition,
  AgentModelPolicy,
  AgentQuality,
  AgentRun,
  AgentRunContext,
  AgentRunStatus,
  AgentRunTrace,
  Engine,
  PrAgentKind,
  RerunSpec,
} from './agent-types'
import { DEFAULT_AGENTS as CATALOG, FORCE_PREAMBLE as FORCE_TEXT } from './agent-catalog'
const DEFAULT_AGENTS = CATALOG
const FORCE_PREAMBLE = FORCE_TEXT

// One definition, from the shared registry — this was a verbatim copy of
// settings.EngineId that could (and did) drift from it.
const OUTPUT_CAP = 400_000
const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

const runs = new Map<string, AgentRun>()
const procs = new Map<string, ChildProcess>()

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

function persistMeta(run: AgentRun) {
  try {
    mkdirSync(RUNS_DIR(), { recursive: true })
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
    if (m.status === 'interrupted') persistMeta(m) // persist the corrected status
  }
}

// `defaultBase` costs up to three git invocations, and runSpec called it TWICE
// per run (header line + the worktree add) with no memoisation — driven
// sequentially up to 100x by runTicketLanes, that is up to 600 synchronous git
// processes on the main thread for a single fan-out. The default branch of a
// repo does not change during a fan-out, so cache it briefly.
const DEFAULT_BASE_TTL_MS = 60_000
const defaultBaseCache = new Map<string, { base: string; at: number }>()

function defaultBase(repoRoot: string): string {
  const hit = defaultBaseCache.get(repoRoot)
  if (hit && Date.now() - hit.at < DEFAULT_BASE_TTL_MS) return hit.base
  const base = computeDefaultBase(repoRoot)
  defaultBaseCache.set(repoRoot, { base, at: Date.now() })
  return base
}

function computeDefaultBase(repoRoot: string): string {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
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
const TERMINAL_BIN_DIR = (): string => configPath('bin')

// State sidecar — mirrors terminal-cli's path layout exactly:
//   ~/.config/TerMinal/agent-state/<repo-basename>/<agentId>.json
// We expose read + reset to the renderer so the Agents tab can surface
// "last scanned X ago" without users `cat`-ing the JSON.
const AGENT_STATE_DIR = (): string => configPath('agent-state')
function agentStateFile(repoRoot: string, agentId: string): string {
  return join(AGENT_STATE_DIR(), basename(repoRoot) || 'unknown', `${agentId}.json`)
}
export type AgentState = {
  lastScannedSha?: string
  lastScannedRef?: string
  lastRunAt?: number
  lastRunId?: string
  [key: string]: unknown
}
export function readAgentState(
  repoRoot: string,
  agentId: string,
): { path: string; exists: boolean; state: AgentState } {
  const path = agentStateFile(repoRoot, agentId)
  if (!existsSync(path)) return { path, exists: false, state: {} }
  try {
    return { path, exists: true, state: JSON.parse(readFileSync(path, 'utf8')) as AgentState }
  } catch {
    return { path, exists: true, state: {} }
  }
}
export function resetAgentState(
  repoRoot: string,
  agentId: string,
): { ok: true } | { error: string } {
  const path = agentStateFile(repoRoot, agentId)
  if (!existsSync(path)) return { ok: true }
  try {
    unlinkSync(path)
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export function engineLabel(engine: Engine): string {
  return engine === 'claude'
    ? 'Claude Code'
    : engine === 'codex'
      ? 'Codex'
      : engine === 'openrouter'
        ? 'OpenRouter'
        : engine === 'openai-compat'
          ? 'Self-hosted'
          : 'Cursor Agent'
}

// Prepended to OpenRouter (or-agent) task prompts. codex exec is a
// non-interactive one-shot, but weaker OR models don't realise it and end their
// turn with a clarifying question instead of doing the work. Say so plainly.
const OR_AUTONOMY_PREAMBLE = [
  'You are running FULLY AUTONOMOUSLY in a non-interactive one-shot process (codex exec).',
  'There is NO human reading your output and no follow-up turn — you cannot ask questions.',
  'Do NOT ask for confirmation, permission, or which part to start with, and do NOT end your',
  'turn with a question or a plan. Execute the ENTIRE task now: inspect the code, make all the',
  'edits, run the project checks, commit, and open the PR. Keep calling tools until the work is',
  'actually done. Only stop early if you are genuinely blocked — and then state the blocker explicitly.',
].join(' ')

// Hermes writes its run cost here (JSON, via --usage-file) — read back in
// finalize(). Per-worktree path so it's unique per run and cleaned with the tree.
export const HERMES_USAGE_FILE = '.terminal-hermes-usage.json'

// Hermes one-shot (`-z`): prints only the final response to stdout, auto-bypasses
// approvals (--yolo --accept-hooks), writes cost JSON to --usage-file. `provider`
// forces OpenRouter when Hermes is used as the OpenRouter harness; omitted for the
// standalone Hermes engine (uses Hermes' own configured provider).
function hermesOneShot(
  bin: string,
  worktree: string,
  prompt: string,
  model?: string,
  provider?: string,
): string {
  const usage = join(worktree, HERMES_USAGE_FILE)
  const mFlag = model ? ` -m ${shq(model)}` : ''
  const pFlag = provider ? ` --provider ${shq(provider)}` : ''
  return `${shq(bin)} -z ${shq(`${OR_AUTONOMY_PREAMBLE}\n\n${prompt}`)}${pFlag}${mFlag} --usage-file ${shq(usage)} --yolo --accept-hooks`
}

// Per-run extra context — appended to the base prompt for a single launch
// (Agents-tab run or ticket run). Never persisted to the agent/ticket itself.
export function extraContextBlock(extra?: string): string {
  const t = (extra || '').trim()
  return t ? `\n\n--- Additional context for THIS run ---\n${t}` : ''
}

// Read the USD cost from a Hermes --usage-file JSON report. The key varies by
// Hermes version, so try the common ones; undefined if unreadable/absent.
function readHermesUsageCost(path: string): number | undefined {
  try {
    if (!existsSync(path)) return undefined
    const j = JSON.parse(readFileSync(path, 'utf8'))
    for (const k of ['cost', 'estimated_cost', 'cost_usd', 'total_cost', 'estimatedCost']) {
      const v = j?.[k]
      if (typeof v === 'number' && isFinite(v)) return v
    }
  } catch {
    /* no/!json usage file — leave cost undefined */
  }
  return undefined
}

export function buildCmd(
  engine: Engine,
  worktree: string,
  prompt: string,
  model?: string,
  harness?: 'codex' | 'hermes',
): string {
  const bin = enginePath(engine)
  const modelFlag = model ? ` --model ${shq(model)}` : ''
  if (engine === 'claude') {
    return `${shq(bin)} -p ${shq(prompt)} --output-format stream-json --permission-mode auto${modelFlag}`
  }
  if (engine === 'cursor') {
    return `${shq(bin)} -p --force --trust --output-format stream-json --stream-partial-output --workspace ${shq(worktree)}${modelFlag} ${shq(prompt)}`
  }
  if (engine === 'pi') {
    // No workspace flag exists — pi operates on the process cwd, and the spawn
    // already sets `cwd: worktree`. `--mode json` gives the JSONL event stream
    // agent-stream.ts decodes; `--no-session` keeps one-shot agent runs out of
    // the interactive session store the Sessions tab lists.
    return `${shq(bin)} -p --mode json --no-session -a${modelFlag} ${shq(prompt)}`
  }
  if (engine === 'hermes') {
    return hermesOneShot(bin, worktree, prompt, model)
  }
  if (engine === 'openrouter') {
    // Hermes harness: `hermes -z --provider openrouter -m <slug>`.
    if (harness === 'hermes')
      return hermesOneShot(enginePath('hermes'), worktree, prompt, model, 'openrouter')
    // Codex harness (default): or-agent = Codex driven by an OpenRouter model.
    // --model is the OR slug (falls back to the registry agentic default when
    // omitted). Reads OPENROUTER_API_KEY from the spawn env. The blunt
    // non-interactive preamble keeps weaker OR models from stopping to ask.
    return `${shq(bin)} --dir ${shq(worktree)}${modelFlag} ${shq(`${OR_AUTONOMY_PREAMBLE}\n\n${prompt}`)}`
  }
  if (engine === 'openai-compat') {
    // Self-hosted endpoint: same or-agent harness as openrouter, retargeted by
    // OPENAI_BASE_URL (+ OPENAI_API_KEY), which the runner injects into the
    // spawn env from Settings. --model is required by or-agent in this mode.
    return `${shq(bin)} --dir ${shq(worktree)}${modelFlag} ${shq(`${OR_AUTONOMY_PREAMBLE}\n\n${prompt}`)}`
  }
  return `${shq(bin)} exec -s danger-full-access -C ${shq(worktree)}${modelFlag} ${shq(prompt)}`
}

function displayCmd(
  engine: Engine,
  worktree: string,
  model?: string,
  scriptPath?: string | null,
  harness?: 'codex' | 'hermes',
): string {
  if (scriptPath) return `${scriptPath} # script-first agent`
  const bin = enginePath(engine)
  const modelFlag = model ? ` --model ${model}` : ''
  if (engine === 'claude') {
    return `${bin} -p <prompt> --output-format stream-json --permission-mode auto${modelFlag}`
  }
  if (engine === 'cursor') {
    return `${bin} -p --force --trust --output-format stream-json --stream-partial-output --workspace ${worktree}${modelFlag} <prompt>`
  }
  if (engine === 'pi') {
    return `${bin} -p --mode json --no-session -a${modelFlag} <prompt>`
  }
  if (engine === 'hermes') {
    return `${bin} -z <prompt>${model ? ` -m ${model}` : ''} --usage-file … --yolo --accept-hooks`
  }
  if (engine === 'openrouter') {
    if (harness === 'hermes') {
      return `${enginePath('hermes')} -z <prompt> --provider openrouter${model ? ` -m ${model}` : ''} --usage-file … --yolo`
    }
    return `${bin} --dir ${worktree}${modelFlag} <prompt>`
  }
  if (engine === 'openai-compat') {
    return `OPENAI_BASE_URL=${openAICompatBaseUrl() || '<unset>'} ${bin} --dir ${worktree}${modelFlag} <prompt>`
  }
  return `${bin} exec -s danger-full-access -C ${worktree}${modelFlag} <prompt>`
}

function classicAgentContextPrompt(agent: Agent): string {
  return `Run with the selected TerMinal classic agent context "${agent.title}" (${agent.id}).

Use this agent's operating guidance as the lens for the task below. Do not run a separate generic agent task; apply these instructions to the requested ticket, PR, or run.

Classic agent guidance:
${agent.prompt}`
}

function persistentAgentContextPrompt(
  repoRoot: string,
  id: string,
): { title: string; prompt: string } | null {
  const detail = getPersistentAgent(id)
  if (!detail) return null
  return {
    title: detail.title,
    prompt: `Run with the selected TerMinal persistent agent context "${detail.title}" (${detail.id}).

Persistent agent memory home:
${detail.dir}

Active workspace repo:
${repoRoot || '- Not provided.'}

Use the persistent agent files as memory and operating guidance for the task below:
- INSTRUCTIONS.md: stable operating instructions.
- MEMORY.md: durable memories and preferences.
- STATE.md: current state and open threads.
- JOURNAL.md: append-only run history.

Required workflow:
1. Read INSTRUCTIONS.md, MEMORY.md, STATE.md, and recent JOURNAL.md entries before acting.
2. Do the requested ticket, PR, or run task below.
3. Before ending, update STATE.md with current status and next actions.
4. Append a dated JOURNAL.md entry with what you did, decisions made, and files changed.
5. Update MEMORY.md only for durable facts or lessons that should affect future runs.`,
  }
}

function defaultQualityForAgent(agent: Agent): AgentQuality {
  const criteria = agent.acceptanceCriteria?.length
    ? agent.acceptanceCriteria
    : agent.quality?.acceptanceCriteria?.length
      ? agent.quality.acceptanceCriteria
      : [
          'Follow the repository agent process: assign ownership, gather knowledge before edits, and file owner-scoped follow-up tickets.',
          agent.opensPr
            ? 'Open and link a PR/MR when concrete changes are made.'
            : 'Write a durable summary of findings and tickets filed.',
          'End with checks run, artifacts produced, and follow-up ticket ids or none.',
        ]
  const deterministicChecks: AgentCheck[] = agent.quality?.deterministicChecks?.length
    ? agent.quality.deterministicChecks
    : agent.opensPr
      ? [
          {
            id: 'linked-pr',
            title: 'PR/MR is opened and linked when changes are made',
            command: 'git status --short && git log --oneline -1',
            cwd: 'worktree',
            required: false,
          },
        ]
      : []
  return {
    acceptanceCriteria: criteria,
    requiredArtifacts: agent.quality?.requiredArtifacts || [],
    deterministicChecks,
    judge: agent.quality?.judge || {
      enabled: false,
      mode: 'deterministic',
      rubric: [
        'Output matches the agent purpose.',
        'Findings cite concrete files, artifacts, or tickets.',
        'No out-of-scope changes were made.',
      ],
    },
  }
}

function defaultQualityForPersistentAgent(
  agent: ReturnType<typeof listPersistentAgents>[number],
): AgentQuality {
  return {
    acceptanceCriteria: agent.quality?.acceptanceCriteria?.length
      ? agent.quality.acceptanceCriteria
      : [
          'Read INSTRUCTIONS.md, MEMORY.md, STATE.md, and recent JOURNAL.md entries before acting.',
          'Update STATE.md and append JOURNAL.md before ending.',
          'Write human-readable output under artifacts/<run>/ when the task produces a durable result.',
        ],
    requiredArtifacts: agent.quality?.requiredArtifacts || ['STATE.md', 'JOURNAL.md'],
    deterministicChecks: agent.quality?.deterministicChecks?.length
      ? agent.quality.deterministicChecks
      : [
          {
            id: 'memory-updated',
            title: 'Memory state files updated when work is performed',
            command: `test -f ${shq(join(agent.dir, 'STATE.md'))} && test -f ${shq(join(agent.dir, 'JOURNAL.md'))}`,
            cwd: 'repo',
            required: true,
          },
        ],
    judge: agent.quality?.judge || {
      enabled: false,
      mode: 'deterministic',
      rubric: [
        'Persistent memory was read and updated appropriately.',
        'Artifacts are concise and durable.',
        'Repo work follows the assigned ticket owner scope.',
      ],
    },
  }
}

function modelPolicyFrom(model?: string, policy?: AgentModelPolicy): AgentModelPolicy {
  return {
    default: policy?.default || model || undefined,
    cheap: policy?.cheap,
    deep: policy?.deep,
    judge: policy?.judge,
    allowOverride: policy?.allowOverride ?? true,
  }
}

export function listAgentDefinitions(repoRoot: string): AgentDefinition[] {
  const classic = readAgents(repoRoot).map((agent): AgentDefinition => {
    const scope = agent.source === 'repo' || agent.source === 'repo-override' ? 'repo' : 'global'
    const scriptPath = locateScript(repoRoot, agent.id) || undefined
    return {
      id: `classic:${scope}:${agent.id}`,
      ref: { id: agent.id, scope, kind: 'classic' },
      title: agent.title,
      description: agent.description,
      icon: agent.icon,
      scope,
      kind: 'classic',
      source: agent.source || 'default',
      runtime: {
        engine: agent.engine,
        model: agent.model,
        modelPolicy: modelPolicyFrom(agent.model, agent.modelPolicy),
        mode: scriptPath ? 'script' : 'prompt',
        scriptPath,
        inPlace: agent.inPlace,
        opensPr: agent.opensPr,
        force: agent.force,
      },
      instructions: {
        prompt: agent.prompt,
        knowledgePolicy: 'standard',
        outputContract: agent.outputContract,
      },
      quality: defaultQualityForAgent(agent),
      metadata: {},
    }
  })
  const persistent = listPersistentAgents().map((agent): AgentDefinition => ({
    id: `persistent:global:${agent.id}`,
    ref: { id: agent.id, scope: 'global', kind: 'persistent' },
    title: agent.title,
    description: agent.description,
    icon: 'Brain',
    scope: 'global',
    kind: 'persistent',
    source: 'persistent',
    runtime: {
      engine: agent.engine,
      model: agent.model,
      modelPolicy: modelPolicyFrom(agent.model, agent.modelPolicy),
      mode: 'persistent',
      memoryDir: agent.dir,
      inPlace: true,
      opensPr: false,
      force: false,
    },
    instructions: {
      knowledgePolicy: 'deep',
      outputContract: 'Update persistent memory files and write artifacts for durable outputs.',
    },
    quality: defaultQualityForPersistentAgent(agent),
    metadata: {
      tags: agent.tags,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      lastRunAt: agent.lastRunAt,
    },
  }))
  return [...classic, ...persistent].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'classic' ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

export function resolveAgentDefinition(
  repoRoot: string,
  ref: { id: string; scope?: 'repo' | 'global'; kind?: 'classic' | 'persistent' },
): AgentDefinition | null {
  const defs = listAgentDefinitions(repoRoot)
  return (
    defs.find((d) => d.ref.id === ref.id && d.ref.kind === ref.kind && d.ref.scope === ref.scope) ||
    defs.find((d) => d.ref.id === ref.id && d.ref.kind === ref.kind) ||
    defs.find((d) => d.ref.id === ref.id) ||
    null
  )
}

function resolveRunContext(
  repoRoot: string,
  contextId?: string,
): { title?: string; prompt?: string } {
  if (!contextId) return {}
  if (contextId.startsWith('agent:')) {
    const id = contextId.slice('agent:'.length)
    const agent = readAgents(repoRoot).find((a) => a.id === id)
    return agent ? { title: agent.title, prompt: classicAgentContextPrompt(agent) } : {}
  }
  if (contextId.startsWith('persistent:')) {
    return persistentAgentContextPrompt(repoRoot, contextId.slice('persistent:'.length)) ?? {}
  }
  const p = getPersona(repoRoot, contextId)
  return p ? { title: p.title, prompt: p.prompt } : {}
}

function ticketAgentContextId(agent?: TicketAgent): string | undefined {
  if (!agent?.id) return undefined
  return agent.kind === 'persistent' ? `persistent:${agent.id}` : `agent:${agent.id}`
}

export function readAgentRunContexts(repoRoot: string): AgentRunContext[] {
  return listAgentDefinitions(repoRoot).map((agent) => ({
    id: agent.kind === 'persistent' ? `persistent:${agent.ref.id}` : `agent:${agent.ref.id}`,
    title: agent.title,
    description: `${agent.kind === 'persistent' ? 'Persistent' : 'Classic'} agent · ${agent.source}${agent.description ? ` · ${agent.description}` : ''}`,
    icon: agent.icon,
    prompt:
      agent.kind === 'persistent'
        ? (persistentAgentContextPrompt(repoRoot, agent.ref.id)?.prompt ?? '')
        : classicAgentContextPrompt({
            id: agent.ref.id,
            title: agent.title,
            description: agent.description,
            icon: agent.icon,
            prompt: agent.instructions.prompt || '',
            opensPr: agent.runtime.opensPr,
            engine: agent.runtime.engine,
            model: agent.runtime.model,
            inPlace: agent.runtime.inPlace,
            force: agent.runtime.force,
            source: agent.source === 'persistent' ? 'global' : agent.source,
          }),
    agentId: agent.ref.id,
    agentScope: agent.ref.scope,
    agentKind: agent.ref.kind,
  }))
}

// Pipeline definitions + composition are pure (see ./pipelines, unit-tested).
// All stages share the worktree + branch, so a later stage sees what an earlier
// one committed. buildSteps just resolves the selected run context first.
function buildSteps(repoRoot: string, base: Step, personaId?: string, pipelineId?: string) {
  const context = resolveRunContext(repoRoot, personaId)
  return {
    steps: composeSteps(base, context.prompt ?? null, pipelineId),
    persona: context.title,
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
  /** FORCE-MODE: spawn the child with TERMINAL_FORCE_MAIN=1 and prepend FORCE_PREAMBLE. */
  force?: boolean
  /** Explicit per-run model pick (run dialog / rerun) — the top-priority input
   *  to resolveModel; the policy's allowOverride: false can veto it. */
  model?: string
  /** The agent's plain configured model — the fallback below the policy. */
  agentModel?: string
  /** Owner agent's model policy — serves modelTier and the override lock. */
  modelPolicy?: AgentModelPolicy
  /** The engine the policy's model slugs target (the agent's own engine) —
   *  resolveModel drops the policy when the run engine differs. */
  modelPolicyEngine?: string
  /** The driving ticket's model_tier (auto | top | cheap-agentic | cheap-raw). */
  modelTier?: string
  /** For engine 'openrouter': which harness runs the slug (default 'codex'). */
  openrouterHarness?: 'codex' | 'hermes'
  quality?: AgentQuality
  trace?: AgentRunTrace
  rerun?: RerunSpec
  /** Hard cap per run, mirroring terminal-cron's. 0/undefined → AGENT_RUN_TIMEOUT_MS. */
  timeoutSec?: number
}

function runSpec(repoRoot: string, spec: RunSpec): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  if (!spec.steps.length) return { error: 'no steps' }
  // Fail fast, not mid-run: a self-hosted run without an endpoint or model can
  // only die inside or-agent with a confusing codex error (there is no registry
  // fallback slug a private server would know). The model check runs the same
  // pure resolveModel chain used at launch, so a model supplied by the owner
  // agent's policy/tier (or agent model) satisfies it.
  if (spec.engine === 'openai-compat') {
    if (!openAICompatBaseUrl())
      return { error: 'openai-compat: no base URL configured (Settings → Engines → Self-hosted)' }
    const predictedModel = resolveModel({
      override: spec.model,
      policy: spec.modelPolicy,
      tier: spec.modelTier,
      model: spec.agentModel,
      engineDefault: engineDefaultModel(spec.engine),
      engine: spec.engine,
      policyEngine: spec.modelPolicyEngine,
    })
    if (!predictedModel)
      return {
        error:
          'openai-compat: no model — pick one for this run or set the engine default model (Settings → Engines → Self-hosted)',
      }
  }
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
    execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  if (spec.inPlace) {
    // Run directly in the repo (no worktree) — e.g. quick ticket filing that must
    // land in the real backlog/, visible immediately, not on an isolated branch.
    worktree = repoRoot
    branch = '(working tree)'
  } else {
    worktree = join(resolvedWorktreesDir(), basename(repoRoot) || 'repo', `${spec.id}-${tag}`)
    // Only true once we have actually asked git to create the worktree — the
    // rollback below must not run a repo-wide `worktree prune` for a failure
    // that happened BEFORE that (a failed fetch, say), because prune would then
    // deregister other worktrees whose directories are merely transiently
    // absent (an unmounted volume, a dir being moved).
    let addAttempted = false
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
        addAttempted = true
        git(['worktree', 'add', '--detach', worktree, ref])
        branch = spec.prRef.sourceBranch
      } else {
        branch = `agent/${spec.id}-${tag}`
        addAttempted = true
        git(['worktree', 'add', worktree, '-b', branch, defaultBase(repoRoot)])
      }
    } catch (e) {
      // `git worktree add` can fail AFTER registering the worktree (a checkout
      // conflict, a branch that already exists), leaving an administrative entry
      // in .git/worktrees and possibly a directory on disk. Left behind, the
      // path is then permanently unusable and the storage sweep never sees it.
      // Roll back before reporting the failure — but only if we got as far as
      // asking git to add it. `worktree prune` is REPO-WIDE, so running it for
      // an earlier failure could deregister unrelated worktrees.
      if (addAttempted) {
        try {
          execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktree], {
            stdio: 'ignore',
          })
        } catch {
          /* nothing registered — prune the stale admin entry for THIS path only */
          try {
            execFileSync('git', ['-C', repoRoot, 'worktree', 'prune'], { stdio: 'ignore' })
          } catch {
            /* best-effort */
          }
        }
      }
      return { error: `worktree: ${(e as Error).message}` }
    }
  }
  const repoLabel = repoForCwd(repoRoot)?.path || basename(repoRoot)
  const launchScriptPath = locateScript(repoRoot, spec.id)
  const launchModel = resolveModel({
    override: spec.model,
    policy: spec.modelPolicy,
    tier: spec.modelTier,
    model: spec.agentModel,
    engineDefault: engineDefaultModel(spec.engine),
    engine: spec.engine,
    policyEngine: spec.modelPolicyEngine,
  })
  const baseLine = spec.prRef
    ? `▸ on ${forgeFor(repoRoot).label} ${forgeFor(repoRoot).sym}${spec.prRef.iid} · branch ${branch}`
    : `▸ branch ${branch} (off ${defaultBase(repoRoot)})`
  const forceLine = spec.force ? '▸ ⚠ FORCE MODE — TERMINAL_FORCE_MAIN=1 (main-push allowed)\n' : ''
  const header =
    `▸ ${spec.title} · ${spec.engine}${spec.persona ? ` · as ${spec.persona}` : ''}` +
    `${spec.pipeline ? ` · ${spec.pipeline}` : ''}\n${baseLine}\n▸ worktree ${worktree}\n` +
    `▸ command ${displayCmd(spec.engine, worktree, launchModel || undefined, launchScriptPath, spec.openrouterHarness)}\n${forceLine}\n`
  const run: AgentRun = {
    id: randomUUID(),
    agentId: spec.id,
    agentTitle: spec.title,
    engine: spec.engine,
    // Record the RESOLVED model (not just the raw override) so the Runs tab and
    // the rerun fallback reflect what actually launched.
    model: launchModel || undefined,
    persona: spec.persona,
    pipeline: spec.pipeline,
    rerun: spec.rerun,
    status: 'running',
    startedAt: ts,
    repoRoot,
    worktree,
    branch,
    output: header,
    force: spec.force,
    trace: spec.trace,
  }
  runs.set(run.id, run)
  persistMeta(run)
  appendLog(run.id, run.output)
  emit('agent:status', run)
  emitActivity(
    {
      kind: 'agent-run',
      title: `Agent started · ${spec.title}`,
      detail: `${spec.engine} · ${repoLabel}`,
      repo: repoLabel,
      repoRoot,
    },
    { notify: false },
  )

  const append = (chunk: string) => {
    if (!chunk) return
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
    // Cost capture for the Runs UI. Hermes (engine, or the OpenRouter Hermes
    // harness) writes a JSON usage report to <worktree>/.terminal-hermes-usage.json;
    // the OpenRouter Codex harness prints "or-agent: done — cost $X" instead.
    const viaHermes =
      spec.engine === 'hermes' ||
      (spec.engine === 'openrouter' && spec.openrouterHarness === 'hermes')
    if (viaHermes) {
      run.costUsd = readHermesUsageCost(join(run.worktree, HERMES_USAGE_FILE))
    } else if (spec.engine === 'openrouter') {
      const m = run.output.match(/or-agent: done[^$]*\$([0-9]+(?:\.[0-9]+)?)/)
      if (m) run.costUsd = Number(m[1])
    }
    run.evaluation = evaluateAgentRun(run, spec, status, append)
    procs.delete(run.id)
    persistMeta(run)
    if (spec.rerun?.kind === 'ticket') {
      try {
        const current = getLocalTicket(repoRoot, spec.rerun.slug)
        if (current?.run?.id === run.id) {
          updateLocalTicket(repoRoot, spec.rerun.slug, {
            run: { id: run.id, source: 'agent', status },
          })
        }
      } catch {
        /* ticket run-link status is observability-only */
      }
    }
    emit('agent:status', run)
    // Try to extract claude -p / codex exec usage from the captured output
    // and record an AIRun ledger entry. Best-effort — silent on miss.
    try {
      // cursor has no parseable usage; openrouter + hermes report their own cost
      // via run.costUsd, so they must NOT be mis-parsed as a claude-p run.
      // openai-compat (self-hosted) has no cloud billing to attribute at all.
      if (
        spec.engine !== 'cursor' &&
        spec.engine !== 'openrouter' &&
        spec.engine !== 'hermes' &&
        spec.engine !== 'openai-compat'
      ) {
        recordRunnerInvocation({
          source: spec.engine === 'codex' ? 'codex-exec' : 'claude-p',
          output: run.output,
          repoRoot,
          runId: run.id,
          agentId: spec.id,
          startedAt: run.startedAt,
          endedAt: run.endedAt!,
          exitCode: exitCode ?? -1,
          modelHint: launchModel || undefined,
        })
      }
    } catch {
      /* observability is non-critical; never block run completion */
    }
    emitActivity({
      // infra/run failures surface as 'error' (notify) so they don't hide in the
      // agent-run stream; normal completions stay 'agent-run'. The failure ping
      // carries the exit code so it's actionable from the notification alone.
      kind: status === 'failed' || status === 'interrupted' ? 'error' : 'agent-run',
      title: `Agent ${status} · ${spec.title}`,
      detail: `${spec.engine} · ${branch}${status === 'failed' && exitCode != null ? ` · exit ${exitCode}` : ''}`,
      repo: repoLabel,
      repoRoot,
      runId: run.id,
      runSource: 'agent',
    })
  }

  let stepIdx = 0
  const runStep = () => {
    const step = spec.steps[stepIdx]
    if (spec.steps.length > 1)
      append(`\n━━ step ${stepIdx + 1}/${spec.steps.length} · ${step.label} ━━\n\n`)
    // Script-first: if .agents/<id>.sh (or global ~/.config/TerMinal/scripts/<id>.sh)
    // exists, exec it directly with env vars instead of building a prompt-based
    // command from the prompt. Inside the script the operator can mix
    // deterministic shell with `claude -p` / `codex exec` however they want.
    const scriptPath = launchScriptPath
    // Resolve model in priority order: explicit spec override > per-engine
    // Settings default > nothing (engine picks its own default). Same value
    // flows into both TERMINAL_MODEL (visible to scripts) and the buildCmd
    // fallback for prompt-style agents — so a script's `--model
    // "${TERMINAL_MODEL:-sonnet}"` pattern sees the user's Settings default.
    const effectiveModel = launchModel
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Inject TerMinal's bin dir so scripts can call `terminal-cli ...`.
      PATH: `${TERMINAL_BIN_DIR()}:${process.env.PATH || ''}`,
      TERMINAL_REPO: repoRoot,
      TERMINAL_RUN_ID: run.id,
      TERMINAL_AGENT_ID: spec.id,
      TERMINAL_BRANCH: branch,
      TERMINAL_WORKTREE: worktree,
      TERMINAL_ENGINE: spec.engine,
      ...(effectiveModel ? { TERMINAL_MODEL: effectiveModel } : {}),
      // OpenRouter (or-agent) reads this; sealed Setting first, else inherited env.
      ...(resolvedOpenRouterKey() ? { OPENROUTER_API_KEY: resolvedOpenRouterKey() } : {}),
      // Self-hosted endpoint: retarget or-agent via OPENAI_BASE_URL. Keyless
      // local servers still need a placeholder ('none') — or-agent requires a
      // key value and the server ignores the Authorization header.
      ...(spec.engine === 'openai-compat'
        ? {
            OPENAI_BASE_URL: openAICompatBaseUrl(),
            OPENAI_API_KEY: resolvedOpenAICompatKey() || 'none',
          }
        : {}),
      // FORCE-MODE: passes the block-main-merge hook's env-var carve-out.
      // Only set when the agent has `force: true`; never inherited from the
      // parent process (a normal launch of TerMinal never has this var set).
      ...(spec.force ? { TERMINAL_FORCE_MAIN: '1' } : {}),
    }
    // Don't leak an inherited Claude Code session identity into spawned agents —
    // it marks them as nested child sessions. See the same strip in
    // src/main/index.ts (interactive spawn) for the full rationale.
    for (const k of Object.keys(env)) {
      if (k.startsWith('CLAUDE_CODE_')) delete env[k]
    }
    delete env.CLAUDECODE
    // For prompt-style (non-script) FORCE agents, prepend the preamble so the
    // spawned model knows it has main-push authority; script-first agents read
    // the env var directly.
    const contextEnabled = readSettings().inbox.agentContextPreamble
    const contextPrompt = scriptPath
      ? step.prompt
      : withAgentContextPreamble(repoRoot, step.prompt, contextEnabled)
    const promptForStep = spec.force && !scriptPath ? FORCE_PREAMBLE + contextPrompt : contextPrompt
    const cmd = scriptPath
      ? shq(scriptPath)
      : buildCmd(
          spec.engine,
          worktree,
          promptForStep,
          effectiveModel || undefined,
          spec.openrouterHarness,
        )
    // Wrap the spawn in `script` so engines think they're on a TTY and stream
    // output as it's generated. Without this, `claude -p` buffers everything
    // until exit and the run log shows nothing mid-run. The wrapper argv differs
    // on Linux vs macOS (see script-wrapper.ts — on Linux, missing -e makes every
    // run exit 0), so it lives in one tested helper. Pipes still carry the
    // streamed bytes back to Node for live render via agents:output IPC.
    const p = spawn('script', scriptWrapperArgs(LOGIN_SHELL, cmd), {
      cwd: worktree,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so cancel/timeout/quit reach the ENGINE and not just
      // the `script` wrapper. See killProcessGroup.
      detached: true,
    })
    procs.set(run.id, p)
    // Hard cap per step, mirroring terminal-cron (SIGKILL + exit 124). Without
    // it a hung engine leaves the run 'running' forever — and the duplicate-run
    // guard then blocks that agent permanently until the app restarts.
    const timeoutMs = resolveRunTimeoutMs(spec.timeoutSec)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      append(`\n[timeout] no completion after ${Math.round(timeoutMs / 1000)}s — killing run\n`)
      killProcessGroup(p, 'SIGKILL')
    }, timeoutMs)
    const streamDecoder = createAgentStreamDecoder(spec.engine, !scriptPath)
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    p.stdout?.on('data', (d: Buffer) => append(streamDecoder.write(stdoutDecoder.write(d))))
    p.stderr?.on('data', (d: Buffer) => append(stderrDecoder.write(d)))
    p.on('error', (err) => {
      clearTimeout(timer)
      append(`\n[spawn error] ${err.message}\n`)
      finalize('failed')
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      const stdoutTail = stdoutDecoder.end()
      const stderrTail = stderrDecoder.end()
      if (stdoutTail) append(streamDecoder.write(stdoutTail))
      append(streamDecoder.end())
      if (stderrTail) append(stderrTail)
      // Structured step-end marker (exit code) so the log formatter can pair it
      // with the start marker for collapsible steps + jump-to-failure (#3). Only
      // for multi-step runs (matches the start marker at the top of runStep).
      if (spec.steps.length > 1)
        append(`\n━━ step ${stepIdx + 1}/${spec.steps.length} end (exit ${code ?? 1}) ━━\n`)
      if (run.status === 'canceled') return finalize('canceled', code ?? undefined)
      // The timeout SIGKILLs the group, so the reported code is a signal death —
      // report the conventional 124 instead, matching terminal-cron.
      if (timedOut) return finalize('failed', AGENT_TIMEOUT_EXIT)
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
  openrouterHarness?: 'codex' | 'hermes',
  extraContext?: string,
): AgentRun | { error: string } {
  const agent = readAgents(repoRoot).find((a) => a.id === agentId)
  if (!agent) return { error: 'unknown agent' }
  const resolvedEngine = engine || agent.engine || 'codex'
  const provider = repoTicketProvider(repoRoot)
  const ticketContext =
    provider.kind === 'local'
      ? ''
      : `${ticketProviderInstructions(provider)} If this task does not involve filing or updating tickets, ignore this ticketing note.\n\n`
  const { steps, persona, pipeline } = buildSteps(
    repoRoot,
    {
      label: agent.title,
      prompt: `${ticketContext}${agent.prompt}${extraContextBlock(extraContext)}`,
    },
    personaId,
    pipelineId,
  )
  return runSpec(repoRoot, {
    id: agent.id,
    title: agent.title,
    steps,
    engine: resolvedEngine,
    persona,
    pipeline,
    inPlace: agent.inPlace,
    force: agent.force,
    model,
    agentModel: agent.model,
    modelPolicy: agent.modelPolicy ? modelPolicyFrom(agent.model, agent.modelPolicy) : undefined,
    modelPolicyEngine: agent.engine,
    openrouterHarness,
    quality: agent.quality || {
      acceptanceCriteria: agent.acceptanceCriteria,
      requiredArtifacts: agent.outputContract ? [agent.outputContract] : undefined,
    },
    rerun: {
      kind: 'agent',
      agentId: agent.id,
      engine: resolvedEngine,
      personaId,
      pipelineId,
      // Record only the explicit override — a rerun re-resolves the rest from
      // the agent's current policy/config.
      model,
    },
  })
}

/** Spawn an agent run that designs a new agent from a natural-language
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
  const targetDir = scope === 'global' ? configPath('scripts') : join(repoRoot, '.agents')
  const scopeLabel =
    scope === 'global'
      ? "TerMinal's GLOBAL script registry (~/.config/TerMinal/scripts/)"
      : `this repo's .agents/ directory`
  const prompt = `You are designing a new TerMinal agent as an EXECUTABLE BASH SCRIPT plus a small sidecar metadata JSON, per the scripts unification (see .agents/scripts.md).

Target: ${scopeLabel}
Two files to write (mkdir -p the parent dir if needed):
  ${targetDir}/<id>.sh    # the executable body — chmod 755 after writing
  ${targetDir}/<id>.json  # sidecar metadata, validated by TerMinal

Pick a kebab-case <id> from the user's description.

The sidecar JSON shape (every field optional except id + title):
  {
    "id":          "kebab-case",
    "title":       "short user-facing label (e.g. 'Audit security')",
    "description": "one-line summary",
    "icon":        "lucide-react icon name — Bot, BookText, ScanSearch, ListChecks, TestTube2, ShieldAlert, Gauge, PackageCheck, Eraser, Wrench, Activity, Zap, etc.",
    "opensPr":     true | false,
    "engine":      "claude" | "codex" | "cursor"  (hint; runtime can override),
    "model":       "haiku" | "sonnet" | "opus" | "gpt-5" | "gpt-5-codex" | "o4-mini" | "composer-2.5-fast" | "composer-2.5"  (hint; optional),
    "inPlace":     true | false  (true ONLY if the agent manages worktrees itself — rare)
  }

The script body MUST follow this shape:
  - First line: #!/usr/bin/env bash
  - Use 'set -uo pipefail' (NOT -e — you want to inspect exit codes).
  - Read these env vars the runner provides:
      TERMINAL_REPO      — the repo root
      TERMINAL_RUN_ID    — uuid of this run
      TERMINAL_AGENT_ID  — id of this agent (used as the state key)
      TERMINAL_BRANCH    — worktree branch (or "main" if inPlace)
      TERMINAL_WORKTREE  — worktree path (== TERMINAL_REPO if inPlace)
      TERMINAL_ENGINE    — hint from sidecar / schedule override (default fallback when calling an agent engine)
      TERMINAL_MODEL     — hint from sidecar / schedule override
  - For LLM calls inside the script:
      claude -p "<prompt>" --permission-mode auto --model "\${TERMINAL_MODEL:-sonnet}"
      codex exec -s danger-full-access -C "\${TERMINAL_WORKTREE}" --model "\${TERMINAL_MODEL:-gpt-5}" "<prompt>"
      cursor-agent -p --force --trust --workspace "\${TERMINAL_WORKTREE}" --model "\${TERMINAL_MODEL:-composer-2.5-fast}" "<prompt>"
  - For TerMinal helpers, use these (on PATH via ~/.config/TerMinal/bin/terminal-cli):
      terminal-cli ticket "<title>" "<body>"   # file a backlog ticket on TERMINAL_REPO
      terminal-cli hitl "<title>" "<action>"   # file a global HITL item + Telegram ping
      terminal-cli activity <kind> "<title>" "<detail>"   # emit one activity-feed event
      terminal-cli notify "<message>"          # raw Telegram message
      terminal-cli state get-sha               # last main/master sha this agent scanned ("" if first run)
      terminal-cli state mark-main             # fetch + record origin/main tip as lastScannedSha
      terminal-cli state get|set <key> [value] # arbitrary per-(repo, agent) key/value persistence
  - INCREMENTAL-SCAN PATTERN (use when the agent re-runs on a cadence and only cares about new commits):
      last=\\$(terminal-cli state get-sha)
      range="\${last:-HEAD~50}..HEAD"
      changes=\\$(git -C "\$TERMINAL_REPO" log --oneline "\$range" -- src/)
      [ -z "\$changes" ] && { echo "no new commits"; exit 0; }
      ... do the work ...
      terminal-cli state mark-main     # record where we scanned through

THE BODY MUST FOLLOW THE PROJECT'S WORKFLOW:
  - The ticket + MR workflow uniformly. The MERGE TO MAIN IS HUMAN-ONLY — never \`gh pr merge\` / \`--auto\` / \`--merge\`.
  - File backlog tickets via \`terminal-cli ticket\` for findings the script cannot fix in-pass.
  - Open a PR only when there are concrete changes. If the diff is ONLY docs/markdown/tickets/reports, apply the \`auto-mergeable\` label per .agents/forge.md.
  - Explicit success criteria (what makes the run "done"). \`exit 0\` on success; non-zero on failure.
  - HITL only for true blockers (decisions, credentials, hard blockers) via \`terminal-cli hitl\`.

CONVENTIONS TO READ BEFORE WRITING THE SCRIPT:
  1. CLAUDE.md (root) — project conventions and global rules.
  2. .agents/scripts.md — the design + helper reference.
  3. .agents/forge.md — auto-mergeable label + forge command mapping.
  4. Existing example: .agents/health.sh — the cheap-precheck-then-LLM pattern.
  5. backlog/EXAMPLE.md or .claude/skills/ticket/EXAMPLE.md — ticket schema (incl. depends_on).
  6. Existing scripts in the target dir — don't duplicate ids; pick a distinct kebab-case id.

User's description:
> ${t}

PROCESS:
  1. Read the conventions above (enough to write a faithful script).
  2. Pick the kebab-case id + title + icon + opensPr based on the description.
  3. Decide whether this agent benefits from a deterministic precheck (a "cheap-then-escalate" pattern saves tokens). If yes, write the precheck FIRST in the script.
  4. Author the bash body. Keep it small + readable; prefer terminal-cli over hand-rolled JSON manipulation.
  5. Write \`${targetDir}/<id>.sh\` with the script body. \`chmod 755\` it.
  6. Write \`${targetDir}/<id>.json\` with the sidecar metadata.
  7. Confirm by printing the absolute paths of both files and the sidecar JSON contents.

DO NOT open a PR, do not modify any existing agents, do not invent extra files.`
  return runSpec(repoRoot, {
    id: `design-${scope}`,
    title: `Design agent · ${t.slice(0, 48)}`,
    steps: [{ label: 'design agent', prompt }],
    engine,
    inPlace: true,
    model,
    rerun: { kind: 'agent-designer', text: t, engine, scope, model },
  })
}

export { saveGlobalAgent }

/** Spawn an in-place run for a global persistent memory agent. The memory
 *  directory is global, but the engine runs from the active repo so repo
 *  commands, diffs, tests, and relative paths behave like the user's current
 *  workspace. */
export function runPersistentAgent(
  repoRoot: string,
  persistentAgentId: string,
  task: string,
  engine?: Engine,
  model?: string,
): AgentRun | { error: string } {
  const prepared = persistentAgentLaunchPrompt(persistentAgentId, task, { repoRoot, engine, model })
  if ('error' in prepared) return prepared
  const resolvedEngine = engine || prepared.agent.engine
  const resolvedModel = model ?? prepared.agent.model
  return runSpec(repoRoot, {
    id: `persistent-${prepared.agent.id}`,
    title: `Persistent · ${prepared.agent.title}`,
    steps: [{ label: 'persistent agent', prompt: prepared.prompt }],
    engine: resolvedEngine,
    model: resolvedModel,
    inPlace: true,
    quality: prepared.agent.quality,
    rerun: {
      kind: 'persistent-agent',
      persistentAgentId: prepared.agent.id,
      task,
      engine: resolvedEngine,
      model: resolvedModel,
    },
  })
}

/** Spawn an in-place designer that creates a global persistent memory agent
 *  under ~/.config/TerMinal/persistent-agents. */
export function runPersistentAgentDesignerSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  return runSpec(repoRoot, {
    id: 'persistent-agent-designer',
    title: `Design persistent agent · ${t.slice(0, 48)}`,
    steps: [
      { label: 'design persistent agent', prompt: persistentAgentDesignerPrompt(t, engine, model) },
    ],
    engine,
    model,
    inPlace: true,
    rerun: { kind: 'persistent-agent-designer', text: t, engine, model },
  })
}

/** Spawn an agent run that designs a new schedule entry from a natural-
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
  const schedulesFile = configPath('schedules.json')
  const agents = readAgents(repoRoot)
  const agentSummary = agents.length
    ? agents
        .map(
          (a) =>
            `  - id: ${a.id} · title: ${a.title}${a.description ? ` · ${a.description}` : ''} · default-engine: ${a.engine || 'codex'} · opensPr: ${!!a.opensPr}`,
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

ScheduleSpec options (all fire at fixed wall-clock times — no intervals):
  { "kind": "calendar", "minute": 0, "hour": 9 }                                # every day at 9:00
  { "kind": "calendar", "minute": 30, "hour": 14, "weekdays": [1,3,5] }         # Mon/Wed/Fri 2:30pm
  { "kind": "cron",     "expr": "30 9 * * 1-5" }                                # raw 5-field cron
  { "kind": "cron",     "expr": "*/15 * * * *" }                                # sub-daily cadence → use cron steps

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
    rerun: { kind: 'schedule-designer', text: t, engine },
  })
}

/** Turn a backlog ticket into an implementation run that opens a PR. */
/** Hard ceiling on parallel lanes — fan-out spawns one engine process each. */
export const MAX_LANES = 100

type TicketRunInput = {
  slug?: string
  id: number
  title: string
  body: string
  externalKey?: string
  url?: string
  /** Prior log entries, replayed into the prompt so a run inherits what
   *  earlier runs on this ticket learned. */
  comments?: TicketComment[]
  agent?: TicketAgent
  /** The ticket's model_tier frontmatter — mapped through the owner agent's
   *  modelPolicy by resolveModel at spawn time. */
  modelTier?: string
}

/** The declared model policy of a ticket's owner agent — classic or
 *  persistent — folded for resolveModel, plus the engine its slugs target.
 *  Owners without a policy resolve to undefined so ticket runs keep the
 *  pre-policy behavior (override → engine Settings default). */
export function ticketOwnerModelPolicy(
  repoRoot: string,
  agent?: TicketAgent,
): { policy?: AgentModelPolicy; engine?: Engine } {
  const src =
    agent?.kind === 'classic'
      ? readAgents(repoRoot).find((a) => a.id === agent.id)
      : agent?.kind === 'persistent'
        ? listPersistentAgents().find((a) => a.id === agent.id)
        : undefined
  return {
    policy: src?.modelPolicy ? modelPolicyFrom(src.model, src.modelPolicy) : undefined,
    engine: src?.engine,
  }
}

export function runTicketAgent(
  repoRoot: string,
  ticket: TicketRunInput,
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
  lane?: { group: string; index: number; total: number },
  extraContext?: string,
): AgentRun | { error: string } {
  const provider = repoTicketProvider(repoRoot)
  const ref = ticket.externalKey || `#${ticket.id}`
  // Lanes are independent variant attempts: each opens its OWN MR and must NOT
  // touch the ticket (concurrent frontmatter writes would race). The judge step
  // compares lanes and links the winner. A solo run links the ticket as before.
  const ticketWriteInstr = lane
    ? `Open a PR/MR that references ticket ${ref}${ticket.url ? ` (${ticket.url})` : ''} and report its URL. Do NOT modify the ticket file, its status, or its prs — a separate judging step compares all lanes and links the winner.`
    : `Commit your work and open a PR that references ticket ${ref}${ticket.url ? ` (${ticket.url})` : ''}. If fully delivered set the ticket status to closed (else in-progress). Link or reference the PR in the ticket provider when supported.`
  const laneFraming = lane
    ? `\n\n--- LANE ${lane.index} of ${lane.total} ---\nYou are one of ${lane.total} independent variant attempts at this ticket, each in its own worktree and branch. Pursue a genuinely distinct, high-quality approach — don't converge on the obvious one. Satisfy every acceptance criterion in the ticket.`
    : ''
  // A lane must not write to the ticket (concurrent frontmatter writes race),
  // so only a solo run is told to leave one behind.
  const logInstr = lane
    ? ''
    : ` Record anything a later run would need — findings, dead ends, decisions — back onto the ticket with the comment_ticket MCP tool, not in the ticket's prose body.`
  const base = `Implement ticket ${ref}: ${ticket.title}\n\n${ticket.body}\n${promptLogBlock(ticket.comments)}\n${ticketProviderInstructions(provider)}${laneFraming}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. ${ticketWriteInstr}${logInstr} End with a short summary of what changed and the PR URL.${extraContextBlock(extraContext)}`
  const resolvedPersonaId = personaId || ticketAgentContextId(ticket.agent)
  const { steps, persona, pipeline } = buildSteps(
    repoRoot,
    { label: `implement ${ref}`, prompt: base },
    resolvedPersonaId,
    pipelineId,
  )
  const ownerQuality =
    ticket.agent?.kind === 'classic'
      ? readAgents(repoRoot).find((a) => a.id === ticket.agent?.id)?.quality
      : undefined
  const ownerPolicy = ticketOwnerModelPolicy(repoRoot, ticket.agent)
  return runSpec(repoRoot, {
    id: lane ? `ticket-${ticket.id}-L${lane.index}` : `ticket-${ticket.id}`,
    title: lane ? `Implement ${ref} · lane ${lane.index}/${lane.total}` : `Implement ${ref}`,
    steps,
    engine,
    persona,
    pipeline,
    model,
    // Only owners that DECLARE a policy route by tier; ticket runs without one
    // keep today's behavior (override → engine Settings default).
    modelPolicy: ownerPolicy.policy,
    modelPolicyEngine: ownerPolicy.engine,
    modelTier: ticket.modelTier,
    quality: ownerQuality,
    trace: { ticketSlug: ticket.slug, ticketId: ticket.id, ticketRef: ref, lane },
    // Lanes aren't individually rerunnable as the ticket (that would relaunch
    // the whole group); only solo runs carry a ticket rerun spec.
    rerun:
      ticket.slug && !lane
        ? {
            kind: 'ticket',
            slug: ticket.slug,
            engine,
            personaId: resolvedPersonaId,
            pipelineId,
            model,
          }
        : undefined,
  })
}

export type LaneFanout = { group: string | null; runs: AgentRun[]; errors?: string[] }

/** Launch `lanes` parallel variant attempts of a ticket, each in its own
 *  worktree/branch with its own MR. lanes<=1 is the classic single run. */
export function runTicketLanes(
  repoRoot: string,
  ticket: TicketRunInput,
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
  lanes?: number,
  extraContext?: string,
): LaneFanout | { error: string } {
  const n = Math.max(1, Math.min(MAX_LANES, Math.floor(lanes || 1)))
  if (n <= 1) {
    const r = runTicketAgent(
      repoRoot,
      ticket,
      engine,
      personaId,
      pipelineId,
      model,
      undefined,
      extraContext,
    )
    return 'error' in r ? r : { group: null, runs: [r] }
  }
  const group = `lane-${ticket.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const runs: AgentRun[] = []
  const errors: string[] = []
  for (let k = 1; k <= n; k++) {
    const r = runTicketAgent(
      repoRoot,
      ticket,
      engine,
      personaId,
      pipelineId,
      model,
      { group, index: k, total: n },
      extraContext,
    )
    if ('error' in r) errors.push(`lane ${k}: ${r.error}`)
    else runs.push(r)
  }
  if (!runs.length) return { error: errors.join('; ') || 'no lanes started' }
  return { group, runs, errors: errors.length ? errors : undefined }
}

/** Spawn an agent that files ONE backlog ticket from a freeform request. Runs
 *  in-place (no worktree) so the ticket lands in the active backlog immediately. */
export function runTicketSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const provider = repoTicketProvider(repoRoot)
  const prompt =
    provider.kind === 'github'
      ? `File exactly ONE new GitHub Issue for the request below using the gh CLI in this repository. Set useful labels for type/priority/status when labels exist or can be safely created. Do NOT implement anything or open a PR.\n\nRequest: ${t}`
      : provider.kind === 'linear'
        ? `File exactly ONE new Linear issue for the request below using the configured Linear MCP/CLI. Use the repo/provider conventions for team, status, and priority. Do NOT implement anything or open a PR.\n\nRequest: ${t}`
        : `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions: allocate the next id (use .claude/skills/ticket/bin/next-ticket-id if present, else the next NNNN above the highest active backlog ticket), write .TerMinal/backlog/NNNN-slug.md with valid YAML frontmatter (id, title, status: open, priority, type, horizon: now) matching the ticket example (legacy v1 repos may use backlog/), put any detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR — just file the ticket. Request: ${t}`
  return runSpec(repoRoot, {
    id: 'ticket-spawn',
    title: `File ticket · ${t.slice(0, 48)}`,
    steps: [{ label: 'file ticket', prompt }],
    engine,
    inPlace: true,
    model,
    rerun: { kind: 'ticket-spawn', text: t, engine, model },
  })
}

/** Start the /factory orchestrator as an in-place run — drives the backlog to
 *  merge-ready PRs (stacked-mr passes, gated by review), never merging to main. */
export function runFactorySpawn(repoRoot: string, engine: Engine): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const prompt = `Run the /factory orchestrator for THIS repository, following the project's /factory skill exactly. This is a no-handoff loop: continuously turn the backlog into REVIEWED, merge-ready PRs by reconciling with /merge-sync, running /stacked-mr passes (build a stack TDD-first → batch-review to the bar → handle verdicts), compacting/migrating context at phase boundaries, then continuing with any runnable independent lane. NEVER stop with "tell me when you're ready" language. Stop only if the user explicitly stops you, the goal is actually complete, or every remaining lane is blocked on human-only action. NEVER merge to main/master — the human merges. Park any TRUE human-need (decision, approval, creds, hard blocker) to the global HITL inbox with .claude/bin/hitl, then continue other work. Emit an activity event at each checkpoint. Do not invent scope. End only when the factory loop has no runnable work left.`
  return runSpec(repoRoot, {
    id: 'factory',
    title: 'Factory',
    steps: [{ label: 'factory loop', prompt }],
    engine,
    inPlace: true,
    rerun: { kind: 'factory', engine },
  })
}

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
  const reviewCtx = `This worktree is checked out at the head of ${tag} (${ref}${pr.title ? ` — "${pr.title}"` : ''}) on branch "${pr.sourceBranch}".`
  const iterateCtx = `${reviewCtx} After committing, push back to the ${f.label} with \`git push origin HEAD:${pr.sourceBranch}\`.`
  const resolvedPersonaId = kind === 'review' ? personaId || 'agent:code-review' : personaId
  const base: Step =
    kind === 'review'
      ? {
          label: `review ${f.sym}${pr.iid}`,
          prompt: `Review ${tag} using the selected code-review agent contract. ${reviewCtx} Resolve the target branch and current head commit, inspect the diff and relevant history, run the project test gate, and write the review artifacts required by the agent definition or in-repo .agents/code-review.md contract. Post or summarize the verdict for the ${f.label} when the repo workflow expects it (${noteCmd}). Do not implement fixes during review; file owner-scoped follow-up tickets for out-of-scope work. End with verdict, artifact path, test status, and key findings.`,
        }
      : {
          label: `iterate ${f.sym}${pr.iid}`,
          prompt: `Iterate on ${tag} until it is merge-ready. ${iterateCtx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases — keep changes surgical. Commit and push your work. End with the final status (tests/build green?) and a short summary of what changed.`,
        }
  const { steps, persona, pipeline } = buildSteps(repoRoot, base, resolvedPersonaId, pipelineId)
  return runSpec(repoRoot, {
    id: `pr-${kind}-${pr.iid}`,
    title: `${kind === 'review' ? 'Review' : 'Iterate'} ${f.sym}${pr.iid}`,
    steps,
    engine,
    persona,
    pipeline,
    prRef: { iid: pr.iid, sourceBranch: pr.sourceBranch },
    model,
    quality:
      kind === 'review'
        ? readAgents(repoRoot).find((a) => a.id === 'code-review')?.quality
        : undefined,
    trace: { prIid: pr.iid, prKind: kind, sourceBranch: pr.sourceBranch },
    rerun: {
      kind: 'pr',
      pr,
      prKind: kind,
      engine,
      personaId: resolvedPersonaId,
      pipelineId,
      model,
    },
  })
}

export async function rerunAgentRun(runId: string): Promise<AgentRun | { error: string }> {
  loadPersistedRuns()
  const run = runs.get(runId)
  if (!run) return { error: 'run not found' }
  if (run.status === 'running') return { error: 'run is already running' }
  const spec = run.rerun
  if (!spec) {
    const engine =
      run.engine === 'claude' ||
      run.engine === 'codex' ||
      run.engine === 'cursor' ||
      run.engine === 'openrouter' ||
      run.engine === 'hermes'
        ? run.engine
        : undefined
    return runAgent(run.repoRoot, run.agentId, engine, undefined, undefined, run.model)
  }
  if (spec.kind === 'agent')
    return runAgent(
      run.repoRoot,
      spec.agentId,
      spec.engine,
      spec.personaId,
      spec.pipelineId,
      spec.model,
    )
  if (spec.kind === 'ticket') {
    const t = await getRepoTicket(run.repoRoot, spec.slug)
    return t
      ? runTicketAgent(
          run.repoRoot,
          {
            slug: t.slug,
            id: t.id,
            title: t.title,
            body: t.body,
            externalKey: t.externalKey,
            url: t.url,
            comments: t.comments,
            agent: t.agent,
            modelTier: t.modelTier,
          },
          spec.engine,
          spec.personaId,
          spec.pipelineId,
          spec.model,
        )
      : { error: 'ticket not found' }
  }
  if (spec.kind === 'pr')
    return runPrAgent(
      run.repoRoot,
      spec.pr,
      spec.prKind,
      spec.engine,
      spec.personaId,
      spec.pipelineId,
      spec.model,
    )
  if (spec.kind === 'ticket-spawn')
    return runTicketSpawn(run.repoRoot, spec.text, spec.engine, spec.model)
  if (spec.kind === 'factory') return runFactorySpawn(run.repoRoot, spec.engine)
  if (spec.kind === 'agent-designer')
    return runDesignerSpawn(run.repoRoot, spec.text, spec.engine, spec.scope, spec.model)
  if (spec.kind === 'persistent-agent') {
    return runPersistentAgent(
      run.repoRoot,
      spec.persistentAgentId,
      spec.task,
      spec.engine,
      spec.model,
    )
  }
  if (spec.kind === 'persistent-agent-designer') {
    return runPersistentAgentDesignerSpawn(run.repoRoot, spec.text, spec.engine, spec.model)
  }
  if (spec.kind === 'schedule-designer')
    return runScheduleDesignerSpawn(run.repoRoot, spec.text, spec.engine)
  return { error: 'unsupported run type' }
}

export function cancelRun(runId: string): boolean {
  const run = runs.get(runId)
  const p = procs.get(runId)
  if (run && run.status === 'running') {
    run.status = 'canceled'
    persistMeta(run)
  }
  if (p) killProcessGroup(p, 'SIGTERM')
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
