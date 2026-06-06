// Background-agent UX. Fire a task, walk away, get a Telegram ping when the
// MR is ready. Persists state across app restarts; the watcher reconciles.
//
// Storage: ~/.config/TerMinal/bg-tasks.json (single file, last 50 tasks)
// Logs:    ~/.config/TerMinal/bg-tasks/<id>.log

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn as cpSpawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { fileHitl } from './hitl'
import { emitActivity } from './events'
import { enginePath, readSettings, resolvedWorktreesDir, resolveEngineModel } from './settings'
import { sendUrl } from './telegram-api'

const CFG = join(homedir(), '.config', 'TerMinal')
const TASKS_FILE = join(CFG, 'bg-tasks.json')
const LOG_DIR = join(CFG, 'bg-tasks')

function displayArg(arg: string, prompt: string): string {
  if (arg === prompt) return '<prompt>'
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg
  return JSON.stringify(arg)
}

function displayCommand(command: { bin: string; args: string[] }, prompt: string): string {
  return [command.bin, ...command.args.map((arg) => displayArg(arg, prompt))].join(' ')
}

export type BgTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export type BgTask = {
  id: string
  repo: string // basename for display
  repoRoot: string // absolute path
  prompt: string
  engine: 'claude' | 'codex' | 'cursor'
  model?: string
  worktree: string
  branch: string
  pid?: number
  status: BgTaskStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  logFile: string
  mrUrl?: string
  /** First few lines of the prompt for tab badges + listings */
  label: string
}

function ensure(): void {
  if (!existsSync(CFG)) mkdirSync(CFG, { recursive: true })
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

function readTasks(): BgTask[] {
  ensure()
  if (!existsSync(TASKS_FILE)) return []
  try {
    const raw = JSON.parse(readFileSync(TASKS_FILE, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeTasks(tasks: BgTask[]): void {
  ensure()
  // Cap at 100; newest first.
  const sorted = [...tasks].sort((a, b) => b.startedAt - a.startedAt).slice(0, 100)
  writeFileSync(TASKS_FILE, JSON.stringify(sorted, null, 2))
}

function labelFor(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  return cleaned.length > 60 ? cleaned.slice(0, 57) + '…' : cleaned
}

export function listBgTasks(): BgTask[] {
  return readTasks()
}

export function getBgTask(id: string): BgTask | null {
  return readTasks().find((t) => t.id === id) ?? null
}

export function readBgTaskLog(id: string): string {
  const f = join(LOG_DIR, `${id}.log`)
  try {
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
  }
}

// ---- spawn ----------------------------------------------------------------

export type SpawnBgInput = {
  repoRoot: string
  prompt: string
  engine?: 'claude' | 'codex' | 'cursor'
  model?: string
}

export function spawnBgTask(input: SpawnBgInput): BgTask | { error: string } {
  if (!input.repoRoot || !existsSync(input.repoRoot)) return { error: 'invalid repoRoot' }
  if (!input.prompt?.trim()) return { error: 'empty prompt' }
  // Budget gate — refuse new spawns when daily cap is reached. Mid-turn
  // runs continue normally; only NEW background tasks are gated.
  try {
    const { gateSpawn } = require('./budgets') as typeof import('./budgets')
    const gate = gateSpawn('bg-task')
    if (gate.decision === 'refuse') {
      return {
        error: `budget gate refused: ${gate.reason}. Set /budget override or raise the cap.`,
      }
    }
  } catch {
    /* budget module unavailable — fall through and allow */
  }

  ensure()
  const id = randomUUID()
  const engine = input.engine || 'claude'
  const effectiveModel = resolveEngineModel(engine, input.model)
  const repo = basename(input.repoRoot)
  const short = id.slice(0, 6)
  const branch = `bg/${repo}-${short}`
  const wtParent = join(resolvedWorktreesDir(), repo)
  const worktree = join(wtParent, `bg-${short}`)
  mkdirSync(wtParent, { recursive: true })

  // Create the worktree branched off main (if main exists), else off HEAD.
  try {
    let base = 'HEAD'
    try {
      execSync('git rev-parse --verify --quiet main', { cwd: input.repoRoot, stdio: 'ignore' })
      base = 'main'
    } catch {
      /* HEAD it is */
    }
    execSync(`git worktree add -B ${JSON.stringify(branch)} ${JSON.stringify(worktree)} ${base}`, {
      cwd: input.repoRoot,
      stdio: 'pipe',
    })
  } catch (e) {
    return { error: `worktree setup failed: ${(e as Error).message}` }
  }

  const logFile = join(LOG_DIR, `${id}.log`)
  // Compose the CLI command. Append a post-instruction so the agent emits a
  // recognizable "MR: <url>" line on success — the watcher greps for it.
  const enrichedPrompt =
    input.prompt.trim() +
    `\n\n---\n` +
    `When you're done, if you opened a PR/MR include its URL on a line by itself in the format:\nMR: <url>\n` +
    `If you completed the task without opening a PR/MR, say so on a line starting with:\nDONE: <one-line summary>\n` +
    `If you couldn't complete the task, say so on a line starting with:\nFAILED: <one-line reason>`

  const command =
    engine === 'claude'
      ? {
          bin: enginePath('claude'),
          args: [
            '-p',
            enrichedPrompt,
            '--add-dir',
            worktree,
            '--permission-mode',
            'auto',
            ...(effectiveModel ? ['--model', effectiveModel] : []),
          ],
        }
      : engine === 'cursor'
        ? {
            bin: enginePath('cursor'),
            args: [
              '-p',
              '--force',
              '--trust',
              '--output-format',
              'text',
              '--workspace',
              worktree,
              ...(effectiveModel ? ['--model', effectiveModel] : []),
              enrichedPrompt,
            ],
          }
        : {
            bin: enginePath('codex'),
            args: [
              'exec',
              '-s',
              'danger-full-access',
              '-C',
              worktree,
              ...(effectiveModel ? ['--model', effectiveModel] : []),
              enrichedPrompt,
            ],
          }

  // Spawn the engine directly. Avoid login shells and `script(1)` here: both
  // can make macOS attribute broad home-folder probes to TerMinal and can leak
  // control markers like ^D into logs. Engine cwd + explicit workspace flags
  // keep the task scoped to the generated worktree.
  writeFileSync(
    logFile,
    `▸ Background task · ${engine}${effectiveModel ? `/${effectiveModel}` : ''}\n` +
      `▸ branch ${branch}\n` +
      `▸ worktree ${worktree}\n` +
      `▸ command ${displayCommand(command, enrichedPrompt)}\n\n`,
  )
  const out = openSync(logFile, 'a')
  const startedAt = Date.now()
  const childEnv = {
    ...process.env,
    TERMINAL_REPO: input.repoRoot,
    TERMINAL_AGENT_ID: 'bg-task',
    TERMINAL_RUN_ID: id,
    TERMINAL_BRANCH: branch,
    TERMINAL_WORKTREE: worktree,
    TERMINAL_ENGINE: engine,
    ...(effectiveModel ? { TERMINAL_MODEL: effectiveModel } : {}),
  }
  const child = cpSpawn(command.bin, command.args, {
    cwd: worktree,
    detached: true,
    stdio: ['ignore', out, out] as const,
    env: childEnv,
  })
  child.unref()

  const task: BgTask = {
    id,
    repo,
    repoRoot: input.repoRoot,
    prompt: input.prompt,
    engine,
    model: input.model,
    worktree,
    branch,
    pid: child.pid || undefined,
    status: 'running',
    startedAt,
    logFile,
    label: labelFor(input.prompt),
  }

  writeTasks([task, ...readTasks()])
  emitActivity(
    {
      kind: 'agent-run',
      title: `Background task started · ${repo}`,
      detail: `${engine}${effectiveModel ? `/${effectiveModel}` : ''} · ${task.label}`,
      repo,
      repoRoot: input.repoRoot,
      runId: id,
      runSource: 'bg',
    },
    { notify: false },
  )
  return task
}

export function cancelBgTask(id: string): { ok: boolean; error?: string } {
  const tasks = readTasks()
  const t = tasks.find((x) => x.id === id)
  if (!t) return { ok: false, error: 'not found' }
  if (t.status !== 'running' && t.status !== 'queued') return { ok: false, error: 'not running' }
  if (t.pid) {
    try {
      process.kill(t.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  const updated = tasks.map((x) =>
    x.id === id ? { ...x, status: 'canceled' as BgTaskStatus, endedAt: Date.now() } : x,
  )
  writeTasks(updated)
  emitActivity(
    {
      kind: 'agent-run',
      title: `Background task canceled · ${t.repo}`,
      detail: t.label,
      repo: t.repo,
      repoRoot: t.repoRoot,
      runId: t.id,
      runSource: 'bg',
    },
    { notify: false },
  )
  return { ok: true }
}

// ---- watcher --------------------------------------------------------------

let watchTimer: ReturnType<typeof setInterval> | null = null

function isAlive(pid?: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tailLog(file: string, lines: number = 50): string {
  try {
    const text = readFileSync(file, 'utf8')
    const split = text.split('\n')
    return split.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

function extractMrUrl(log: string): string | undefined {
  // Look for our enrichment marker first
  const tagged = log.match(/^MR:\s*(https?:\/\/\S+)/m)
  if (tagged) return tagged[1]
  // Fallback: any MR / PR URL
  const generic = log.match(
    /https?:\/\/[^\s)"]+\/(?:merge_requests|pull|pull-requests)\/\d+/,
  )
  return generic?.[0]
}

function extractFailure(log: string): string | undefined {
  const m = log.match(/^FAILED:\s*(.+)$/m)
  return m?.[1].trim()
}

function extractDone(log: string): string | undefined {
  const m = log.match(/^DONE:\s*(.+)$/m)
  return m?.[1].trim()
}

// Send a one-off Telegram message via the existing settings/auth boundary.
function telegramPing(text: string): void {
  try {
    const t = readSettings().telegram
    if (!t?.botToken || !t?.chatId) return
    fetch(sendUrl(t.botToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: t.chatId, text }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {})
  } catch {
    /* settings missing or unreadable */
  }
}

async function sweep(): Promise<void> {
  const tasks = readTasks()
  let changed = false
  for (const t of tasks) {
    if (t.status !== 'running') continue
    if (isAlive(t.pid)) continue
    // Process gone — finalize from the log tail
    const tail = tailLog(t.logFile, 200)
    const mrUrl = extractMrUrl(tail)
    const failure = extractFailure(tail)
    const done = extractDone(tail)
    t.endedAt = Date.now()
    if (mrUrl) {
      t.status = 'done'
      t.mrUrl = mrUrl
      emitActivity({
        kind: 'pr-opened',
        title: `Background task ready · ${t.repo}`,
        detail: mrUrl,
        repo: t.repo,
        repoRoot: t.repoRoot,
        runId: t.id,
        runSource: 'bg',
      })
      telegramPing(`✅ ${t.repo}: ${t.label} → ${mrUrl}`)
    } else if (done) {
      t.status = 'done'
      emitActivity({
        kind: 'task-complete',
        title: `Background task done · ${t.repo}`,
        detail: done,
        repo: t.repo,
        repoRoot: t.repoRoot,
        runId: t.id,
        runSource: 'bg',
      })
    } else if (failure) {
      t.status = 'failed'
      fileHitl({
        title: `Background task failed · ${t.repo}`,
        action: failure,
        detail: `Task: ${t.label}\nLog: ${t.logFile}`,
        repo: t.repo,
        repoRoot: t.repoRoot,
        source: 'agent',
        runId: t.id,
        runSource: 'bg',
      })
    } else {
      // No MR, no FAILED marker — treat as failed. Try to summarize the log
      // via the configured lightweight local engine; falls back to deterministic
      // "last error cluster" extraction when no engine is available.
      t.status = 'failed'
      const fullLog = (() => {
        try {
          return require('node:fs').readFileSync(t.logFile, 'utf8')
        } catch {
          return tail
        }
      })()
      let summary = `Process exited without an MR URL or FAILED marker`
      try {
        const { summarizeFailedRun } = await import('./run-summarizer')
        summary = await summarizeFailedRun({
          rawLog: fullLog,
          context: `Background task: ${t.label} in ${t.repo} (${t.engine}${
            t.model ? '/' + t.model : ''
          })`,
        })
      } catch {
        /* fall through to default summary */
      }
      fileHitl({
        title: `Background task failed · ${t.repo}`,
        action: summary,
        detail: `Task: ${t.label}\nLog: ${t.logFile}`,
        repo: t.repo,
        repoRoot: t.repoRoot,
        source: 'agent',
        runId: t.id,
        runSource: 'bg',
      })
    }
    changed = true
  }
  if (changed) writeTasks(tasks)
}

export function startBgWatcher(): void {
  if (watchTimer) return
  // Immediate sweep on boot to reconcile state if the app restarted while a
  // task was running. Then poll every 5s.
  sweep().catch(() => {})
  watchTimer = setInterval(() => {
    sweep().catch(() => {})
  }, 5000)
}

export function stopBgWatcher(): void {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
}
