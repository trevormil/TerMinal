import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  watch,
  type FSWatcher,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { emitActivity, type ActivityKind } from './events'
import { createTicket } from './backlog'
import { fileHitl } from './hitl'
import { runAgent, type Engine } from './agents'
import { spawnBgTask } from './bg-tasks'
import { resolvedProjectsDir, resolvedWorktreesDir } from './settings'
import { isRepoRootWithin } from './repo-allowlist'

function assertRepoRootAllowed(repoRoot: string): void {
  if (!isRepoRootWithin(repoRoot, [resolvedProjectsDir(), resolvedWorktreesDir()]))
    throw new Error(`refusing to dispatch: repoRoot is outside the projects directory: ${repoRoot}`)
}

const CFG = join(homedir(), '.config', 'TerMinal')
const ROOT = join(CFG, 'automation-inbox')
const SETTINGS = join(ROOT, 'settings.json')
const PROCESSED = join(ROOT, 'processed.json')
const DIRS = ['new', 'processing', 'done', 'failed', 'dead-letter'] as const

export type ListenerDir = (typeof DIRS)[number]
export type ListenerAction =
  | { kind: 'activity'; activityKind?: ActivityKind; title?: string; detail?: string }
  | { kind: 'file-ticket'; title?: string; body?: string; type?: string; priority?: string }
  | { kind: 'file-hitl'; title?: string; action?: string; detail?: string }
  | {
      kind: 'run-agent'
      agentId: string
      engine?: Engine
      model?: string
      mode?: 'agent' | 'background'
      prompt?: string
    }
  | { kind: 'background-task'; prompt: string; engine?: Engine; model?: string }

export type ListenerEnvelope = {
  id?: string
  listenerId?: string
  listenerName?: string
  source: string
  type: string
  title?: string
  body?: string
  repo?: string
  repoRoot?: string
  dedupeKey?: string
  createdAt?: string | number
  requestedAction?: ListenerAction
  payload?: unknown
}

export type ListenerSettings = {
  enabled: boolean
}

export type ListenerProcessedFile = ListenerEnvelope & {
  _terminal?: {
    status: 'done' | 'failed' | 'dead-letter'
    processedAt: number
    receivedAt?: number
    result?: string
    error?: string
    skipped?: boolean
    runId?: string
    runSource?: 'agent' | 'bg'
  }
}

export type ListenerStatus = {
  enabled: boolean
  inboxDir: string
  dirs: Record<ListenerDir, string>
  counts: Record<ListenerDir, number>
  listeners: {
    id: string
    source: string
    type: string
    name?: string
    total: number
    new: number
    processing: number
    done: number
    failed: number
    deadLetter: number
    lastAt: number
    lastStatus: ListenerDir
    lastTitle?: string
    lastResult?: string
    lastRunId?: string
    lastRunSource?: 'agent' | 'bg'
    repoRoot?: string
  }[]
  recent: {
    file: string
    dir: ListenerDir
    id?: string
    listenerId?: string
    listenerName?: string
    source?: string
    type?: string
    title?: string
    repo?: string
    repoRoot?: string
    processedAt?: number
    error?: string
    action?: string
    result?: string
    runId?: string
    runSource?: 'agent' | 'bg'
  }[]
}

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

function ensure(): void {
  mkdirSync(ROOT, { recursive: true })
  for (const d of DIRS) mkdirSync(join(ROOT, d), { recursive: true })
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

export function readListenerSettings(): ListenerSettings {
  ensure()
  const raw = readJson<Partial<ListenerSettings>>(SETTINGS, {})
  // Opt-in by default: the inbox auto-runs full-access agents on any dropped
  // file, so it must be enabled deliberately (never on for a fresh install).
  return { enabled: raw.enabled === true }
}

export function setListenerEnabled(enabled: boolean): ListenerSettings {
  const s = { ...readListenerSettings(), enabled }
  writeJson(SETTINGS, s)
  emitActivity({
    kind: 'check',
    title: `Listener inbox ${enabled ? 'enabled' : 'paused'}`,
    detail: ROOT,
  })
  return s
}

function processedKeys(): string[] {
  const raw = readJson<{ keys?: unknown[] } | unknown[]>(PROCESSED, [])
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.keys) ? raw.keys : []
  return arr.filter((x): x is string => typeof x === 'string')
}

function rememberKey(key: string): void {
  const keys = [key, ...processedKeys().filter((x) => x !== key)].slice(0, 2000)
  writeJson(PROCESSED, { keys })
}

function fileCount(dir: ListenerDir): number {
  try {
    return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

function eventKey(env: ListenerEnvelope, raw: string): string {
  return env.dedupeKey || env.id || createHash('sha256').update(raw).digest('hex')
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || randomUUID()
}

function listenerKey(env: Pick<ListenerEnvelope, 'listenerId' | 'source' | 'type'>): string {
  return env.listenerId?.trim() || `${env.source || 'unknown'}:${env.type || 'event'}`
}

export function enqueueListenerEvent(
  input: unknown,
): { ok: true; path: string } | { error: string } {
  ensure()
  if (!input || typeof input !== 'object') return { error: 'event must be an object' }
  const env = input as Partial<ListenerEnvelope>
  if (typeof env.source !== 'string' || !env.source.trim()) return { error: 'source is required' }
  if (typeof env.type !== 'string' || !env.type.trim()) return { error: 'type is required' }
  const id = typeof env.id === 'string' && env.id.trim() ? env.id.trim() : randomUUID()
  const file = `${safeFileName(id)}.json`
  const path = join(ROOT, 'new', file)
  writeJson(path, { ...env, id, createdAt: env.createdAt || new Date().toISOString() })
  return { ok: true, path }
}

function validateEnvelope(raw: unknown): ListenerEnvelope {
  if (!raw || typeof raw !== 'object') throw new Error('event must be a JSON object')
  const env = raw as ListenerEnvelope
  if (typeof env.source !== 'string' || !env.source.trim()) throw new Error('source is required')
  if (typeof env.type !== 'string' || !env.type.trim()) throw new Error('type is required')
  if (env.listenerId && typeof env.listenerId !== 'string')
    throw new Error('listenerId must be a string')
  if (env.listenerName && typeof env.listenerName !== 'string')
    throw new Error('listenerName must be a string')
  if (env.repoRoot && typeof env.repoRoot !== 'string') throw new Error('repoRoot must be a string')
  if (env.requestedAction && typeof env.requestedAction !== 'object') {
    throw new Error('requestedAction must be an object')
  }
  return env
}

function moveWithMeta(
  from: string,
  dir: ListenerDir,
  env: ListenerEnvelope,
  meta: NonNullable<ListenerProcessedFile['_terminal']>,
): string {
  const target = join(ROOT, dir, basename(from))
  writeJson(from, { ...env, _terminal: meta })
  renameSync(from, target)
  return target
}

type ListenerActionResult = { result: string; runId?: string; runSource?: 'agent' | 'bg' }

function processAction(env: ListenerEnvelope): ListenerActionResult {
  const a = env.requestedAction
  if (!a) {
    emitActivity({
      kind: 'info',
      title: `Listener event · ${env.source}`,
      detail: `${env.type}${env.title ? ` · ${env.title}` : ''}`,
      repo: env.repo,
      repoRoot: env.repoRoot,
    })
    return { result: 'logged event' }
  }

  if (a.kind === 'activity') {
    emitActivity({
      kind: a.activityKind || 'info',
      title: a.title || env.title || `Listener event · ${env.source}`,
      detail: a.detail || env.body || env.type,
      repo: env.repo,
      repoRoot: env.repoRoot,
    })
    return { result: 'emitted activity' }
  }

  if (a.kind === 'file-hitl') {
    const hitl = fileHitl({
      title: a.title || env.title || `Listener needs review · ${env.source}`,
      action: a.action || env.body || `Review ${env.type}`,
      detail: a.detail || env.body,
      repo: env.repo,
      repoRoot: env.repoRoot,
      source: 'listener',
    })
    return { result: `filed HITL ${hitl.id}` }
  }

  if (a.kind === 'file-ticket') {
    if (!env.repoRoot) throw new Error('file-ticket requires repoRoot')
    const t = createTicket(env.repoRoot, {
      title: a.title || env.title || `Listener request · ${env.type}`,
      body: a.body || env.body || '',
      type: a.type || 'feature',
      priority: a.priority || 'medium',
      status: 'open',
    })
    emitActivity({
      kind: 'ticket-filed',
      title: `Ticket filed from listener · #${t.id}`,
      detail: t.title,
      repo: env.repo,
      repoRoot: env.repoRoot,
      ref: { ticket: t.id },
    })
    return { result: `filed ticket ${t.slug}` }
  }

  if (a.kind === 'run-agent') {
    if (!env.repoRoot) throw new Error('run-agent requires repoRoot')
    if (!a.agentId) throw new Error('run-agent requires agentId')
    assertRepoRootAllowed(env.repoRoot)
    if (a.mode === 'background') {
      const prompt =
        a.prompt ||
        `Run the ${a.agentId} workflow for this listener event.\n\n${JSON.stringify(env, null, 2)}`
      const r = spawnBgTask({ repoRoot: env.repoRoot, prompt, engine: a.engine, model: a.model })
      if ('error' in r) throw new Error(r.error)
      return { result: `started background task ${r.id}`, runId: r.id, runSource: 'bg' }
    }
    const r = runAgent(env.repoRoot, a.agentId, a.engine, undefined, undefined, a.model)
    if ('error' in r) throw new Error(r.error)
    return { result: `started agent run ${r.id}`, runId: r.id, runSource: 'agent' }
  }

  if (a.kind === 'background-task') {
    if (!env.repoRoot) throw new Error('background-task requires repoRoot')
    assertRepoRootAllowed(env.repoRoot)
    const r = spawnBgTask({
      repoRoot: env.repoRoot,
      prompt: a.prompt,
      engine: a.engine,
      model: a.model,
    })
    if ('error' in r) throw new Error(r.error)
    return { result: `started background task ${r.id}`, runId: r.id, runSource: 'bg' }
  }

  throw new Error(`unknown requestedAction kind: ${(a as { kind?: string }).kind || 'missing'}`)
}

export function processListenerInbox(limit = 20): {
  processed: number
  failed: number
  skipped: number
} {
  ensure()
  if (!readListenerSettings().enabled) return { processed: 0, failed: 0, skipped: 0 }
  const files = readdirSync(join(ROOT, 'new'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, limit)
  let processed = 0
  let failed = 0
  let skipped = 0
  const keys = new Set(processedKeys())

  for (const f of files) {
    const newPath = join(ROOT, 'new', f)
    const processingPath = join(ROOT, 'processing', f)
    try {
      renameSync(newPath, processingPath)
    } catch {
      continue
    }
    const receivedAt = Date.now()
    let rawText = ''
    try {
      rawText = readFileSync(processingPath, 'utf8')
      const env = validateEnvelope(JSON.parse(rawText))
      const key = eventKey(env, rawText)
      if (keys.has(key)) {
        moveWithMeta(processingPath, 'done', env, {
          status: 'done',
          receivedAt,
          processedAt: Date.now(),
          result: 'duplicate skipped',
          skipped: true,
        })
        skipped++
        continue
      }
      const actionResult = processAction(env)
      rememberKey(key)
      keys.add(key)
      moveWithMeta(processingPath, 'done', env, {
        status: 'done',
        receivedAt,
        processedAt: Date.now(),
        ...actionResult,
      })
      processed++
    } catch (e) {
      const error = (e as Error).message
      try {
        const parsed = rawText ? JSON.parse(rawText) : { source: 'unknown', type: 'invalid' }
        moveWithMeta(processingPath, error.includes('JSON') ? 'dead-letter' : 'failed', parsed, {
          status: error.includes('JSON') ? 'dead-letter' : 'failed',
          receivedAt,
          processedAt: Date.now(),
          error,
        })
      } catch {
        const target = join(ROOT, 'dead-letter', f)
        writeFileSync(processingPath, rawText || '{}')
        renameSync(processingPath, target)
      }
      emitActivity({ kind: 'error', title: 'Listener event failed', detail: error })
      failed++
    }
  }
  return { processed, failed, skipped }
}

function recentFrom(dir: ListenerDir) {
  try {
    return readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const path = join(ROOT, dir, f)
        const env = readJson<ListenerProcessedFile>(path, {} as ListenerProcessedFile)
        const fileTs = statSync(path).mtimeMs
        const createdAt =
          typeof env.createdAt === 'number'
            ? env.createdAt
            : typeof env.createdAt === 'string'
              ? Date.parse(env.createdAt)
              : 0
        return {
          file: f,
          dir,
          id: env.id,
          listenerId: env.listenerId,
          listenerName: env.listenerName,
          source: env.source,
          type: env.type,
          title: env.title,
          repo: env.repo,
          repoRoot: env.repoRoot,
          processedAt: env._terminal?.processedAt || createdAt || fileTs,
          error: env._terminal?.error,
          action: env.requestedAction?.kind,
          result: env._terminal?.result,
          runId: env._terminal?.runId,
          runSource: env._terminal?.runSource,
        }
      })
  } catch {
    return []
  }
}

export function readListenerStatus(): ListenerStatus {
  ensure()
  const counts = Object.fromEntries(DIRS.map((d) => [d, fileCount(d)])) as Record<
    ListenerDir,
    number
  >
  const dirs = Object.fromEntries(DIRS.map((d) => [d, join(ROOT, d)])) as Record<
    ListenerDir,
    string
  >
  const all = [
    ...recentFrom('new'),
    ...recentFrom('processing'),
    ...recentFrom('done'),
    ...recentFrom('failed'),
    ...recentFrom('dead-letter'),
  ]
  const byListener = new Map<
    string,
    {
      id: string
      source: string
      type: string
      name?: string
      total: number
      new: number
      processing: number
      done: number
      failed: number
      deadLetter: number
      lastAt: number
      lastStatus: ListenerDir
      lastTitle?: string
      lastResult?: string
      lastRunId?: string
      lastRunSource?: 'agent' | 'bg'
      repoRoot?: string
    }
  >()
  for (const item of all) {
    const key = listenerKey({
      listenerId: item.listenerId,
      source: item.source || 'unknown',
      type: item.type || 'event',
    })
    const cur = byListener.get(key) || {
      id: key,
      source: item.source || 'unknown',
      type: item.type || 'event',
      name: item.listenerName,
      total: 0,
      new: 0,
      processing: 0,
      done: 0,
      failed: 0,
      deadLetter: 0,
      lastAt: 0,
      lastStatus: item.dir,
      repoRoot: item.repoRoot,
    }
    cur.total++
    if (item.dir === 'dead-letter') cur.deadLetter++
    else cur[item.dir]++
    if ((item.processedAt || 0) >= cur.lastAt) {
      cur.lastAt = item.processedAt || 0
      cur.lastStatus = item.dir
      cur.lastTitle = item.title
      cur.lastResult = item.result || item.error
      cur.lastRunId = item.runId
      cur.lastRunSource = item.runSource
      cur.repoRoot = item.repoRoot || cur.repoRoot
      cur.name = item.listenerName || cur.name
    }
    byListener.set(key, cur)
  }
  return {
    enabled: readListenerSettings().enabled,
    inboxDir: ROOT,
    dirs,
    counts,
    listeners: [...byListener.values()]
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
      .slice(0, 40),
    recent: all.sort((a, b) => (b.processedAt || 0) - (a.processedAt || 0)).slice(0, 50),
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let watcher: FSWatcher | null = null

export function startListenerInboxWatcher(): void {
  ensure()
  if (!timer) timer = setInterval(() => processListenerInbox(), 5000)
  try {
    watcher?.close()
    watcher = watch(join(ROOT, 'new'), () => setTimeout(() => processListenerInbox(), 100))
  } catch {
    /* polling still works */
  }
  processListenerInbox()
}

export function listenerExample(repoRoot = ''): ListenerEnvelope {
  return {
    id: `example-${Date.now()}`,
    listenerId: 'local-script:repo-health',
    listenerName: 'Local repo health',
    source: 'local-script',
    type: 'automation.requested',
    title: 'Run repo health',
    repoRoot,
    dedupeKey: `local-script:repo-health:${repoRoot || 'repo'}`,
    requestedAction: {
      kind: 'run-agent',
      agentId: 'health',
      engine: 'codex',
      mode: 'agent',
    },
    payload: {
      note: 'Drop JSON files like this into automation-inbox/new.',
      enqueueWithCli: `terminal-cli listener enqueue ${shq('{"source":"local-script","type":"automation.requested"}')}`,
    },
  }
}
