// Loops. Long-running "let the model drive" agent loops with separated
// planner/generator/evaluator roles, an on-disk contract, and taste scoring.
// Grounded in the /loop skill set (.claude/skills/loop*). The loop is a state
// machine over phases; each step spawns one headless role turn; a watcher
// reconciles completion (by a LOOP-DONE marker in the turn log) and advances.
//
// Store:  ~/.config/TerMinal/loops.json (index of loops)
// State:  <repoRoot>/.TerMinal/loops/<id>/  (contract.md, feature_list.json,
//         progress.md, log.md, events.jsonl, scores/, turns/)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  openSync,
  readdirSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn as cpSpawn, execSync } from 'node:child_process'
import { emitActivity } from './events'
import { enginePath, resolvedWorktreesDir } from './settings'
import { gateSpawn } from './budgets'

const CFG = join(homedir(), '.config', 'TerMinal')
const LOOPS_FILE = join(CFG, 'loops.json')

export type LoopEngine = 'claude' | 'codex' | 'cursor'
export type LoopRole = 'planner' | 'generator' | 'evaluator'
export type LoopPhase = 'negotiate' | 'generate' | 'evaluate' | 'decide' | 'done' | 'stopped'
export type LoopStatus = 'idle' | 'running' | 'blocked' | 'done' | 'stopped'
// Two execution modes over the SAME loop state (contract.md, events.jsonl, …):
//   headless — TerMinal auto-steps one-shot role turns (stepLoop + watcher).
//   paired   — two live interactive sessions (a driver + a worker) drive the
//              roles themselves; the auto-stepper stays out of their way.
export type LoopMode = 'headless' | 'paired'

export type LoopRecord = {
  id: string
  repo: string // basename for display
  repoRoot: string
  goal: string
  mode: LoopMode
  engine: LoopEngine
  model?: string
  worktree: string
  branch: string
  status: LoopStatus
  phase: LoopPhase
  nextRole: LoopRole
  iteration: number
  activeRunId?: string
  activeRole?: LoopRole
  maxIterations: number
  createdAt: number
  updatedAt: number
}

function ensure(): void {
  if (!existsSync(CFG)) mkdirSync(CFG, { recursive: true })
}

function readLoops(): LoopRecord[] {
  ensure()
  if (!existsSync(LOOPS_FILE)) return []
  try {
    const a = JSON.parse(readFileSync(LOOPS_FILE, 'utf8'))
    return Array.isArray(a) ? (a as LoopRecord[]) : []
  } catch {
    return []
  }
}

function writeLoops(list: LoopRecord[]): void {
  ensure()
  writeFileSync(LOOPS_FILE, JSON.stringify(list.slice(0, 100), null, 2))
}

export function listLoops(): LoopRecord[] {
  return readLoops().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getLoop(id: string): LoopRecord | undefined {
  return readLoops().find((l) => l.id === id)
}

function saveLoop(rec: LoopRecord): void {
  const list = readLoops().filter((l) => l.id !== rec.id)
  rec.updatedAt = Date.now()
  writeLoops([rec, ...list])
}

function loopDir(rec: LoopRecord): string {
  return join(rec.repoRoot, '.TerMinal', 'loops', rec.id)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

// ---------------------------------------------------------------------------
// State files (rule IV: on disk, crash-resume from three files)
// ---------------------------------------------------------------------------

function initState(rec: LoopRecord): void {
  const d = loopDir(rec)
  mkdirSync(join(d, 'scores'), { recursive: true })
  mkdirSync(join(d, 'turns'), { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  if (!existsSync(join(d, 'contract.md')))
    writeFileSync(
      join(d, 'contract.md'),
      `# Contract: ${rec.id}\nGoal: ${rec.goal}\nBoundary: (planner fills in)\n\n## Assertions\n(planner drafts 10-30 testable assertions; evaluator pushes back)\n`,
    )
  if (!existsSync(join(d, 'feature_list.json')))
    writeFileSync(
      join(d, 'feature_list.json'),
      JSON.stringify({ loopId: rec.id, iteration: 0, assertions: [] }, null, 2),
    )
  if (!existsSync(join(d, 'progress.md')))
    writeFileSync(
      join(d, 'progress.md'),
      `# Progress: ${rec.id}\nIteration: 0\nPhase: negotiate\nBottleneck: planning\nLast taste score: -\nNext: planner drafts the contract\n`,
    )
  if (!existsSync(join(d, 'log.md')))
    writeFileSync(join(d, 'log.md'), `## [${date}] init | goal: ${rec.goal}\n`)
  if (!existsSync(join(d, 'events.jsonl'))) writeFileSync(join(d, 'events.jsonl'), '')
}

function logLine(rec: LoopRecord, line: string): void {
  const date = new Date().toISOString().slice(0, 10)
  appendFileSync(join(loopDir(rec), 'log.md'), `## [${date}] ${line}\n`)
}

/** Bounded view of loop state for the cockpit widget. */
export type LoopState = {
  phase: LoopPhase
  iteration: number
  bottleneck: string
  lastScore: string
  next: string
  assertions: { total: number; pass: number; fail: number; todo: number }
  tail: string[] // last few log lines
}

export function readLoopState(id: string): LoopState | { error: string } {
  const rec = getLoop(id)
  if (!rec) return { error: 'unknown loop' }
  const d = loopDir(rec)
  const prog = existsSync(join(d, 'progress.md')) ? readFileSync(join(d, 'progress.md'), 'utf8') : ''
  const grab = (k: string): string => (prog.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] || '').trim()
  let counts = { total: 0, pass: 0, fail: 0, todo: 0 }
  try {
    const fl = JSON.parse(readFileSync(join(d, 'feature_list.json'), 'utf8'))
    for (const a of fl.assertions || []) {
      counts.total++
      if (a.status === 'pass') counts.pass++
      else if (a.status === 'fail') counts.fail++
      else counts.todo++
    }
  } catch {
    /* empty */
  }
  const log = existsSync(join(d, 'log.md')) ? readFileSync(join(d, 'log.md'), 'utf8') : ''
  const tail = log.trim().split('\n').slice(-6)
  return {
    phase: rec.phase,
    iteration: rec.iteration,
    bottleneck: grab('Bottleneck') || '-',
    lastScore: grab('Last taste score') || '-',
    next: grab('Next') || '-',
    assertions: counts,
    tail,
  }
}

// ---------------------------------------------------------------------------
// Create / restart / stop
// ---------------------------------------------------------------------------

export type CreateLoopInput = {
  repoRoot?: string
  goal: string
  mode?: LoopMode
  engine?: LoopEngine
  model?: string
  maxIterations?: number
}

function makeWorktree(repoRoot: string, id: string): { worktree: string; branch: string } {
  const repo = basename(repoRoot)
  const branch = `loop/${id}`
  const wtParent = join(resolvedWorktreesDir(), repo)
  const worktree = join(wtParent, `loop-${id}`)
  mkdirSync(wtParent, { recursive: true })
  let base = 'HEAD'
  try {
    execSync('git rev-parse --verify --quiet main', { cwd: repoRoot, stdio: 'pipe' })
    base = 'main'
  } catch {
    /* use HEAD */
  }
  if (!existsSync(worktree))
    execSync(
      `git worktree add -B ${JSON.stringify(branch)} ${JSON.stringify(worktree)} ${base}`,
      { cwd: repoRoot, stdio: 'pipe' },
    )
  return { worktree, branch }
}

export function createLoop(input: CreateLoopInput): LoopRecord | { error: string } {
  if (!input.repoRoot || !input.goal) return { error: 'repoRoot and goal are required' }
  const id = `${basename(input.repoRoot)}-${slugify(input.goal) || 'loop'}-${randomUUID().slice(0, 4)}`
  let wt: { worktree: string; branch: string }
  try {
    wt = makeWorktree(input.repoRoot, id)
  } catch (e) {
    return { error: `worktree: ${(e as Error).message}` }
  }
  const now = Date.now()
  const rec: LoopRecord = {
    id,
    repo: basename(input.repoRoot),
    repoRoot: input.repoRoot,
    goal: input.goal,
    mode: input.mode || 'headless',
    engine: input.engine || 'claude',
    model: input.model,
    worktree: wt.worktree,
    branch: wt.branch,
    status: 'idle',
    phase: 'negotiate',
    nextRole: 'planner',
    iteration: 0,
    maxIterations: input.maxIterations && input.maxIterations > 0 ? input.maxIterations : 25,
    createdAt: now,
    updatedAt: now,
  }
  initState(rec)
  saveLoop(rec)
  emitActivity({
    kind: 'info',
    title: `Loop created: ${id}`,
    detail: input.goal,
    repo: rec.repo,
    repoRoot: rec.repoRoot,
  })
  return rec
}

export function restartLoop(id: string): LoopRecord | { error: string } {
  const rec = getLoop(id)
  if (!rec) return { error: 'unknown loop' }
  // rule V: nuke the worktree, keep the contract.
  try {
    execSync(`git worktree remove --force ${JSON.stringify(rec.worktree)}`, {
      cwd: rec.repoRoot,
      stdio: 'pipe',
    })
  } catch {
    /* may already be gone */
  }
  try {
    makeWorktree(rec.repoRoot, rec.id)
  } catch (e) {
    return { error: `worktree: ${(e as Error).message}` }
  }
  // reset assertion statuses to todo but keep the contract
  const d = loopDir(rec)
  try {
    const fl = JSON.parse(readFileSync(join(d, 'feature_list.json'), 'utf8'))
    for (const a of fl.assertions || []) {
      a.status = 'todo'
      delete a.evidence
    }
    fl.iteration = rec.iteration
    writeFileSync(join(d, 'feature_list.json'), JSON.stringify(fl, null, 2))
  } catch {
    /* empty */
  }
  rec.phase = 'generate'
  rec.nextRole = 'generator'
  rec.status = 'idle'
  rec.activeRunId = undefined
  rec.activeRole = undefined
  logLine(rec, `restart | worktree reset, contract kept`)
  saveLoop(rec)
  emitActivity({
    kind: 'info',
    title: `Loop restarted: ${id}`,
    detail: 'worktree reset, contract kept',
    repo: rec.repo,
    repoRoot: rec.repoRoot,
  })
  return rec
}

export function stopLoop(id: string): LoopRecord | { error: string } {
  const rec = getLoop(id)
  if (!rec) return { error: 'unknown loop' }
  rec.status = 'stopped'
  rec.phase = 'stopped'
  rec.activeRunId = undefined
  logLine(rec, 'stop | user stopped the loop')
  saveLoop(rec)
  return rec
}

// ---------------------------------------------------------------------------
// Stepping — spawn one headless role turn
// ---------------------------------------------------------------------------

const ROLE_DIRECTIVE: Record<LoopRole, string> = {
  planner:
    'Draft/refine contract.md: goal, boundary, and 10-30 testable assertions. Do NOT write code.',
  generator:
    'Implement the next unmet assertions in this worktree. Mark them "done" (not "pass"). Do NOT grade yourself.',
  evaluator:
    'Adversarially grade: run the app, mark each touched assertion pass/fail with evidence, and (for taste work) write scores/NNNN.md. Prove it is broken.',
}

function buildTurnCommand(
  rec: LoopRecord,
  role: LoopRole,
  prompt: string,
): { bin: string; args: string[] } {
  const dir = role === 'generator' ? rec.worktree : rec.repoRoot
  const model = rec.model
  if (rec.engine === 'claude')
    return {
      bin: enginePath('claude'),
      args: [
        '-p',
        prompt,
        '--add-dir',
        dir,
        '--permission-mode',
        'auto',
        ...(model ? ['--model', model] : []),
      ],
    }
  if (rec.engine === 'cursor')
    return {
      bin: enginePath('cursor'),
      args: [
        '-p',
        '--force',
        '--trust',
        '--output-format',
        'text',
        '--workspace',
        dir,
        ...(model ? ['--model', model] : []),
        prompt,
      ],
    }
  return {
    bin: enginePath('codex'),
    args: ['exec', '-s', 'danger-full-access', '-C', dir, ...(model ? ['--model', model] : []), prompt],
  }
}

function turnPrompt(rec: LoopRecord, role: LoopRole): string {
  const d = loopDir(rec)
  return [
    `You are the ${role.toUpperCase()} in a TerMinal loop. Read and follow the /loop-${role} skill and its shared references under .claude/skills/loop/references/ (principles.md, state.md, roles.md, taste.md).`,
    ``,
    `Loop id: ${rec.id}`,
    `Goal: ${rec.goal}`,
    `Iteration: ${rec.iteration}`,
    `Loop state dir (read/write here): ${d}`,
    role === 'generator'
      ? `Your worktree is the current directory. Restart deletes it — keep nothing precious here.`
      : `Work read-only in the main repo; only the loop state dir under .TerMinal/loops/ is yours to write.`,
    ``,
    `Do exactly ONE ${role} turn:`,
    `- Read contract.md, feature_list.json, progress.md first (they are your full brief).`,
    `- ${ROLE_DIRECTIVE[role]}`,
    `- Update feature_list.json + progress.md, and append one line to log.md: "## [YYYY-MM-DD] ${role}#${rec.iteration} | <summary>".`,
    `- Append your JSONL event to events.jsonl.`,
    `- Keep every read bounded (80 lines / 12k chars); prefer file refs over pasted output.`,
    ``,
    `When your turn is complete, print this as the FINAL line, exactly:`,
    `LOOP-DONE: ${role} #${rec.iteration} <one-line summary of what you did>`,
    `Do not start another turn.`,
  ].join('\n')
}

export function stepLoop(id: string): LoopRecord | { error: string } {
  const rec = getLoop(id)
  if (!rec) return { error: 'unknown loop' }
  if (rec.mode === 'paired') return { error: 'paired loops are driven by their live sessions' }
  if (rec.status === 'stopped' || rec.phase === 'done')
    return { error: `loop is ${rec.phase}` }
  if (rec.activeRunId) return { error: 'a turn is already running' }

  // decide is deterministic — no agent turn
  if (rec.phase === 'decide') {
    decide(rec)
    return rec
  }

  const gate = gateSpawn('loop')
  if (gate.decision === 'refuse') return { error: gate.reason || 'blocked by budget' }

  const role = rec.nextRole
  const runId = randomUUID().slice(0, 8)
  const logFile = join(loopDir(rec), 'turns', `${rec.iteration}-${role}-${runId}.log`)
  const prompt = turnPrompt(rec, role)
  const command = buildTurnCommand(rec, role, prompt)
  const cwd = role === 'generator' ? rec.worktree : rec.repoRoot
  const out = openSync(logFile, 'a')
  try {
    const child = cpSpawn(command.bin, command.args, {
      cwd,
      detached: true,
      stdio: ['ignore', out, out] as const,
      env: {
        ...process.env,
        TERMINAL_REPO: rec.repoRoot,
        TERMINAL_AGENT_ID: `loop-${role}`,
        TERMINAL_RUN_ID: runId,
        TERMINAL_WORKTREE: rec.worktree,
        TERMINAL_ENGINE: rec.engine,
        ...(rec.model ? { TERMINAL_MODEL: rec.model } : {}),
      },
    })
    child.unref()
  } catch (e) {
    return { error: `spawn: ${(e as Error).message}` }
  }
  rec.status = 'running'
  rec.activeRunId = runId
  rec.activeRole = role
  ;(rec as LoopRecord & { activeLog?: string }).activeLog = logFile
  saveLoop(rec)
  emitActivity({
    kind: 'agent-run',
    title: `Loop ${rec.id}: ${role} turn`,
    detail: `iteration ${rec.iteration}`,
    repo: rec.repo,
    repoRoot: rec.repoRoot,
  })
  return rec
}

function decide(rec: LoopRecord): void {
  const d = loopDir(rec)
  let allPass = false
  try {
    const fl = JSON.parse(readFileSync(join(d, 'feature_list.json'), 'utf8'))
    const as = fl.assertions || []
    allPass = as.length > 0 && as.every((a: { status: string }) => a.status === 'pass')
  } catch {
    /* empty */
  }
  // taste plateau: last two scores within 0.02
  let plateau = true
  try {
    const files = readdirSync(join(d, 'scores'))
      .filter((f) => f.endsWith('.md'))
      .sort()
    if (files.length >= 2) {
      const val = (f: string): number =>
        parseFloat(
          (readFileSync(join(d, 'scores', f), 'utf8').match(/weighted:\s*([\d.]+)/) || [])[1] || '0',
        )
      plateau = Math.abs(val(files[files.length - 1]) - val(files[files.length - 2])) <= 0.02
    } else {
      plateau = false
    }
  } catch {
    plateau = false
  }
  if (rec.iteration >= rec.maxIterations || (allPass && plateau)) {
    rec.phase = 'done'
    rec.status = 'done'
    logLine(rec, `done | ${allPass ? 'contract met' : 'iteration cap'}${plateau ? ', taste plateaued' : ''}`)
    emitActivity({
      kind: allPass ? 'task-complete' : 'info',
      title: `Loop done: ${rec.id}`,
      detail: allPass ? 'contract met' : 'iteration cap',
      repo: rec.repo,
      repoRoot: rec.repoRoot,
    })
  } else {
    rec.phase = 'generate'
    rec.nextRole = 'generator'
    rec.iteration += 1
    rec.status = 'idle'
    logLine(rec, `decide | continue -> iteration ${rec.iteration}`)
  }
  saveLoop(rec)
}

// ---------------------------------------------------------------------------
// Watcher — reconcile in-flight turns and advance the phase
// ---------------------------------------------------------------------------

function advanceAfterTurn(rec: LoopRecord): void {
  const done = rec.activeRole
  rec.activeRunId = undefined
  rec.activeRole = undefined
  rec.status = 'idle'
  if (done === 'planner') {
    rec.nextRole = 'evaluator' // evaluator reviews the contract (still negotiate)
    rec.phase = 'negotiate'
  } else if (done === 'evaluator' && rec.phase === 'negotiate') {
    rec.phase = 'generate'
    rec.nextRole = 'generator'
    rec.iteration = Math.max(1, rec.iteration || 1)
  } else if (done === 'generator') {
    rec.phase = 'evaluate'
    rec.nextRole = 'evaluator'
  } else if (done === 'evaluator') {
    rec.phase = 'decide'
  }
  saveLoop(rec)
}

let watcherTimer: ReturnType<typeof setInterval> | null = null

export function startLoopWatcher(): void {
  if (watcherTimer) return
  watcherTimer = setInterval(() => {
    for (const rec of readLoops()) {
      if (!rec.activeRunId) continue
      const logFile = (rec as LoopRecord & { activeLog?: string }).activeLog
      if (!logFile || !existsSync(logFile)) continue
      let tail = ''
      try {
        const buf = readFileSync(logFile, 'utf8')
        tail = buf.slice(-4000)
      } catch {
        continue
      }
      if (/LOOP-DONE:/.test(tail)) {
        advanceAfterTurn(getLoop(rec.id) || rec)
      }
    }
  }, 5000)
  watcherTimer.unref?.()
}
