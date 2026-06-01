import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Engine } from './agents'
import { createEntry, listDir, readFile as readScopedFile, removeEntry, writeFile as writeScopedFile } from './files'

export const PERSISTENT_AGENTS_ROOT = join(homedir(), '.config', 'TerMinal', 'persistent-agents')

export type PersistentAgent = {
  id: string
  title: string
  description?: string
  engine: Engine
  model?: string
  tags: string[]
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  dir: string
}

export type PersistentAgentFiles = {
  instructions: string
  memory: string
  state: string
  journal: string
}

export type PersistentAgentDetail = PersistentAgent & {
  files: PersistentAgentFiles
}

export type PersistentArtifactFile = {
  name: string
  path: string
  size: number
  mtime: number
  kind: 'markdown' | 'json' | 'image' | 'html' | 'text' | 'other'
}

export type PersistentArtifact = {
  id: string
  title: string
  kind: string
  path: string
  createdAt: number
  summary?: string
  runId?: string
  primaryPath?: string
  files: PersistentArtifactFile[]
}

export type PersistentArtifactRead =
  | { ok: true; kind: PersistentArtifactFile['kind']; content: string; dataUrl?: string; path: string }
  | { ok: false; reason: string; path?: string }

export type PersistentAgentInput = {
  id?: string
  title: string
  description?: string
  engine?: Engine
  model?: string
  tags?: string[]
  instructions?: string
  memory?: string
  state?: string
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

function ensureRoot() {
  mkdirSync(PERSISTENT_AGENTS_ROOT, { recursive: true })
}

function agentDir(id: string) {
  return join(PERSISTENT_AGENTS_ROOT, id)
}

function safe(root: string, rel: string): string | null {
  const r = resolve(root)
  const p = resolve(root, rel || '.')
  if (p !== r && !p.startsWith(r + sep)) return null
  return p
}

function safeId(id: string): string {
  const v = slugify(id)
  if (!v) throw new Error('invalid id')
  return v
}

function readText(path: string, fallback = ''): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return fallback
  }
}

function defaultInstructions(input: { title: string; description?: string }): string {
  return `# ${input.title}

You are a persistent TerMinal agent. You are global, directory-backed, and memory-aware.

Purpose:
${input.description || '- Fill in this agent purpose.'}

Operating rules:
- Read MEMORY.md and STATE.md before acting.
- Treat INSTRUCTIONS.md as stable operating guidance.
- Update STATE.md with current progress and open threads before ending.
- Append a concise entry to JOURNAL.md after every run.
- Update MEMORY.md only for durable facts, preferences, decisions, or recurring lessons.
- Do not silently rewrite INSTRUCTIONS.md. If you want to improve your instructions, append a proposal to STATE.md.
- Use this directory as your persistent memory home.
- If a task needs repo work, operate in the current workspace repo provided at launch.
`
}

function defaultMemory(): string {
  return `# Memory

- No durable memories yet.
`
}

function defaultState(): string {
  return `# State

- Idle.
`
}

function defaultJournal(title: string): string {
  return `# Journal

## Created ${new Date().toISOString()}
- Persistent agent initialized: ${title}
`
}

function readMeta(id: string): PersistentAgent | null {
  const dir = agentDir(id)
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'agent.json'), 'utf8')) as Record<string, unknown>
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id
    const engine =
      raw.engine === 'codex' || raw.engine === 'cursor' || raw.engine === 'claude' ? raw.engine : 'claude'
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((x): x is string => typeof x === 'string') : []
    return {
      id,
      title,
      description: typeof raw.description === 'string' ? raw.description : '',
      engine,
      model: typeof raw.model === 'string' ? raw.model : '',
      tags,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      lastRunAt: typeof raw.lastRunAt === 'number' ? raw.lastRunAt : undefined,
      dir,
    }
  } catch {
    return null
  }
}

function writeMeta(agent: PersistentAgent) {
  const { dir: _dir, files: _files, ...json } = agent as PersistentAgent & { files?: unknown }
  writeFileSync(join(agent.dir, 'agent.json'), JSON.stringify(json, null, 2) + '\n')
}

export function listPersistentAgents(): PersistentAgent[] {
  ensureRoot()
  return readdirSync(PERSISTENT_AGENTS_ROOT)
    .filter((f) => {
      try {
        return statSync(join(PERSISTENT_AGENTS_ROOT, f)).isDirectory()
      } catch {
        return false
      }
    })
    .map((id) => readMeta(id))
    .filter((x): x is PersistentAgent => !!x)
    .sort((a, b) => (b.lastRunAt || b.updatedAt || 0) - (a.lastRunAt || a.updatedAt || 0))
}

export function getPersistentAgent(id: string): PersistentAgentDetail | null {
  const agent = readMeta(safeId(id))
  if (!agent) return null
  return {
    ...agent,
    files: {
      instructions: readText(join(agent.dir, 'INSTRUCTIONS.md')),
      memory: readText(join(agent.dir, 'MEMORY.md')),
      state: readText(join(agent.dir, 'STATE.md')),
      journal: readText(join(agent.dir, 'JOURNAL.md')),
    },
  }
}

export function savePersistentAgent(input: PersistentAgentInput): PersistentAgentDetail | { error: string } {
  try {
    ensureRoot()
    const id = safeId(input.id || input.title)
    const now = Date.now()
    const dir = agentDir(id)
    mkdirSync(dir, { recursive: true })
    const existing = readMeta(id)
    const agent: PersistentAgent = {
      id,
      title: input.title.trim(),
      description: input.description?.trim() || '',
      engine: input.engine || existing?.engine || 'claude',
      model: input.model ?? existing?.model ?? '',
      tags: input.tags || existing?.tags || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt,
      dir,
    }
    writeMeta(agent)
    const instructionsPath = join(dir, 'INSTRUCTIONS.md')
    const memoryPath = join(dir, 'MEMORY.md')
    const statePath = join(dir, 'STATE.md')
    const journalPath = join(dir, 'JOURNAL.md')
    mkdirSync(join(dir, 'artifacts'), { recursive: true })
    if (input.instructions !== undefined || !existsSync(instructionsPath)) {
      writeFileSync(instructionsPath, input.instructions?.trim() || defaultInstructions(agent))
    }
    if (input.memory !== undefined || !existsSync(memoryPath)) {
      writeFileSync(memoryPath, input.memory?.trim() || defaultMemory())
    }
    if (input.state !== undefined || !existsSync(statePath)) {
      writeFileSync(statePath, input.state?.trim() || defaultState())
    }
    if (!existsSync(journalPath)) writeFileSync(journalPath, defaultJournal(agent.title))
    return getPersistentAgent(id)!
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export function removePersistentAgent(id: string): boolean {
  try {
    rmSync(agentDir(safeId(id)), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function updatePersistentAgentFile(
  id: string,
  file: keyof PersistentAgentFiles,
  body: string,
): PersistentAgentDetail | { error: string } {
  const agent = readMeta(safeId(id))
  if (!agent) return { error: 'agent not found' }
  const fileName =
    file === 'instructions'
      ? 'INSTRUCTIONS.md'
      : file === 'memory'
        ? 'MEMORY.md'
        : file === 'state'
          ? 'STATE.md'
          : 'JOURNAL.md'
  writeFileSync(join(agent.dir, fileName), body)
  agent.updatedAt = Date.now()
  writeMeta(agent)
  return getPersistentAgent(agent.id)!
}

export type PersistentAgentLaunchOptions = {
  repoRoot?: string
  engine?: Engine
  model?: string
}

export function persistentAgentLaunchPrompt(
  id: string,
  task: string,
  opts: PersistentAgentLaunchOptions = {},
): { agent: PersistentAgent; prompt: string } | { error: string } {
  const detail = getPersistentAgent(id)
  if (!detail) return { error: 'agent not found' }
  const runId = randomUUID()
  const now = Date.now()
  detail.lastRunAt = now
  detail.updatedAt = now
  writeMeta(detail)
  const taskText = task.trim() || 'Review your current STATE.md and continue the most important open thread.'
  const repoLine = opts.repoRoot
    ? `Active workspace repo:\n${opts.repoRoot}`
    : 'Active workspace repo:\n- Not provided. Ask for the target repo before making repo changes.'
  const engine = opts.engine || detail.engine
  const model = opts.model ?? detail.model
  const prompt = `You are running as persistent TerMinal agent "${detail.title}".

Persistent agent memory home:
${detail.dir}

${repoLine}

Run id:
${runId}

Task:
${taskText}

Files available in this directory:
- agent.json: metadata.
- INSTRUCTIONS.md: stable operating instructions.
- MEMORY.md: durable memories and preferences.
- STATE.md: current state and open threads.
- JOURNAL.md: append-only run history.
- artifacts/: optional output files.

Required workflow:
1. Read INSTRUCTIONS.md, MEMORY.md, STATE.md, and the latest JOURNAL.md entries.
2. Do the requested work. If repo work is needed, explicitly navigate to the target repo.
3. Before ending, update STATE.md with current status and next actions.
4. Append a dated entry to JOURNAL.md with what you did, decisions made, and files changed.
5. Update MEMORY.md only for durable facts or lessons that should affect future runs.
6. Put human-readable run outputs in artifacts/<date-or-run-id>/report.md. Add artifacts/<date-or-run-id>/artifact.json when there are multiple files or useful display metadata.
7. Do not silently rewrite INSTRUCTIONS.md. If your instructions should change, add a proposal under "Instruction improvement proposals" in STATE.md.

Preferred engine/model:
${engine}${model ? ` / ${model}` : ''}
`
  return { agent: detail, prompt }
}

export function persistentAgentDesignerPrompt(text: string, engine: Engine, model?: string): string {
  const t = text.trim()
  return `Create a new global persistent TerMinal memory agent from this request:

${t}

Persistent agents are global, directory-backed, and memory-aware. They are stored under:
${PERSISTENT_AGENTS_ROOT}

Create exactly one new directory:
${PERSISTENT_AGENTS_ROOT}/<kebab-case-id>/

Required files:
- agent.json
- INSTRUCTIONS.md
- MEMORY.md
- STATE.md
- JOURNAL.md
- artifacts/

agent.json schema:
{
  "id": "<kebab-case-id>",
  "title": "<short label>",
  "description": "<one-line purpose>",
  "engine": "claude" | "codex" | "cursor",
  "model": "<optional model alias>",
  "tags": [],
  "createdAt": <epoch ms>,
  "updatedAt": <epoch ms>
}

Use this selected engine/model unless the user request clearly says otherwise:
${engine}${model ? ` / ${model}` : ''}

File guidance:
- INSTRUCTIONS.md: stable operating instructions for this agent.
- MEMORY.md: durable facts, preferences, decisions, recurring lessons. Start sparse.
- STATE.md: current state and open threads. Start with Idle plus suggested first actions.
- JOURNAL.md: append-only run log. Add an initial creation entry.
- artifacts/: empty directory for future output files. Future runs should write artifacts/<date-or-run-id>/report.md and optional artifact.json metadata.

Rules:
- Do not modify this repo except if the user explicitly requested repo changes. The target is the global TerMinal config directory above.
- Do not create more than one persistent agent.
- Do not open a PR/MR.
- Keep the files concise and immediately useful.
- End with the created agent id and absolute directory path.`
}

export function listPersistentAgentFiles(id: string, rel = '') {
  const agent = readMeta(safeId(id))
  if (!agent) return []
  return listDir(agent.dir, rel)
}

export function readPersistentAgentFile(id: string, rel: string) {
  const agent = readMeta(safeId(id))
  if (!agent) return { ok: false, content: '', reason: 'agent not found' }
  return readScopedFile(agent.dir, rel)
}

export function writePersistentAgentFile(id: string, rel: string, content: string): boolean {
  const agent = readMeta(safeId(id))
  if (!agent) return false
  const ok = writeScopedFile(agent.dir, rel, content)
  if (ok) {
    agent.updatedAt = Date.now()
    writeMeta(agent)
  }
  return ok
}

export function createPersistentAgentFile(id: string, rel: string, dir = false): boolean {
  const agent = readMeta(safeId(id))
  if (!agent) return false
  const ok = createEntry(agent.dir, rel, dir)
  if (ok) {
    agent.updatedAt = Date.now()
    writeMeta(agent)
  }
  return ok
}

export function removePersistentAgentFile(id: string, rel: string): boolean {
  const agent = readMeta(safeId(id))
  if (!agent) return false
  if (['agent.json', 'INSTRUCTIONS.md', 'MEMORY.md', 'STATE.md', 'JOURNAL.md'].includes(rel)) return false
  const ok = removeEntry(agent.dir, rel)
  if (ok) {
    agent.updatedAt = Date.now()
    writeMeta(agent)
  }
  return ok
}

function artifactKind(path: string): PersistentArtifactFile['kind'] {
  const ext = extname(path).toLowerCase()
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown'
  if (ext === '.json') return 'json'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (['.txt', '.log', '.csv', '.yaml', '.yml', '.toml'].includes(ext)) return 'text'
  return 'other'
}

function imageMime(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.svg') return 'image/svg+xml'
  return 'image/png'
}

function walkFiles(root: string, rel = '', depth = 0): PersistentArtifactFile[] {
  if (depth > 4) return []
  const dir = safe(root, rel)
  if (!dir || !existsSync(dir)) return []
  const out: PersistentArtifactFile[] = []
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  for (const name of names) {
    if (name === '.DS_Store') continue
    const path = rel ? join(rel, name) : name
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) out.push(...walkFiles(root, path, depth + 1))
    else out.push({ name, path, size: st.size, mtime: st.mtimeMs, kind: artifactKind(path) })
  }
  return out.sort((a, b) => {
    const ak = a.name === 'artifact.json' ? 1 : 0
    const bk = b.name === 'artifact.json' ? 1 : 0
    if (ak !== bk) return ak - bk
    return a.path.localeCompare(b.path)
  })
}

function artifactPrimary(files: PersistentArtifactFile[], metaPrimary?: string): string | undefined {
  if (metaPrimary && files.some((f) => f.path === metaPrimary)) return metaPrimary
  const preferred =
    files.find((f) => basename(f.path).toLowerCase() === 'report.md') ||
    files.find((f) => basename(f.path).toLowerCase() === 'readme.md') ||
    files.find((f) => f.kind === 'markdown') ||
    files.find((f) => f.kind === 'json' && basename(f.path) !== 'artifact.json') ||
    files.find((f) => f.kind === 'image') ||
    files.find((f) => f.kind === 'html') ||
    files.find((f) => f.kind === 'text') ||
    files.find((f) => basename(f.path) !== 'artifact.json')
  return preferred?.path
}

export function listPersistentAgentArtifacts(id: string): PersistentArtifact[] {
  const agent = readMeta(safeId(id))
  if (!agent) return []
  const root = join(agent.dir, 'artifacts')
  if (!existsSync(root)) return []
  const entries = listDir(agent.dir, 'artifacts')
  const artifacts: PersistentArtifact[] = []
  for (const entry of entries) {
    const artifactRel = entry.path
    const files = entry.dir
      ? walkFiles(agent.dir, artifactRel)
      : [{
          name: entry.name,
          path: artifactRel,
          size: statSync(join(agent.dir, artifactRel)).size,
          mtime: statSync(join(agent.dir, artifactRel)).mtimeMs,
          kind: artifactKind(artifactRel),
        }]
    if (!files.length) continue
    let meta: Record<string, unknown> = {}
    const metaFile = files.find((f) => basename(f.path) === 'artifact.json')
    if (metaFile) {
      try {
        meta = JSON.parse(readFileSync(join(agent.dir, metaFile.path), 'utf8')) as Record<string, unknown>
      } catch {
        meta = {}
      }
    }
    const newest = Math.max(...files.map((f) => f.mtime))
    const createdRaw = meta.createdAt
    const createdAt =
      typeof createdRaw === 'number'
        ? createdRaw
        : typeof createdRaw === 'string' && Number.isFinite(Date.parse(createdRaw))
          ? Date.parse(createdRaw)
          : newest
    const primaryPath = artifactPrimary(files, typeof meta.primaryPath === 'string' ? meta.primaryPath : undefined)
    artifacts.push({
      id: entry.path.replace(/^artifacts\//, ''),
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : entry.name,
      kind: typeof meta.kind === 'string' && meta.kind.trim() ? meta.kind.trim() : files.find((f) => f.path === primaryPath)?.kind || 'artifact',
      path: artifactRel,
      createdAt,
      summary: typeof meta.summary === 'string' ? meta.summary : undefined,
      runId: typeof meta.runId === 'string' ? meta.runId : undefined,
      primaryPath,
      files,
    })
  }
  return artifacts.sort((a, b) => b.createdAt - a.createdAt)
}

export function readPersistentAgentArtifact(id: string, rel: string): PersistentArtifactRead {
  const agent = readMeta(safeId(id))
  if (!agent) return { ok: false, reason: 'agent not found' }
  if (!rel.startsWith('artifacts/')) return { ok: false, reason: 'not an artifact path', path: rel }
  const abs = safe(agent.dir, rel)
  if (!abs || !existsSync(abs)) return { ok: false, reason: 'not found', path: rel }
  try {
    const st = statSync(abs)
    if (st.isDirectory()) return { ok: false, reason: 'directory', path: rel }
    if (st.size > 5_000_000) return { ok: false, reason: 'file too large (>5 MB)', path: rel }
    const kind = artifactKind(rel)
    const buf = readFileSync(abs)
    if (kind === 'image') {
      return { ok: true, kind, content: '', dataUrl: `data:${imageMime(rel)};base64,${buf.toString('base64')}`, path: rel }
    }
    if (buf.includes(0)) return { ok: false, reason: 'binary file', path: rel }
    return { ok: true, kind, content: buf.toString('utf8'), path: rel }
  } catch (e) {
    return { ok: false, reason: (e as Error).message, path: rel }
  }
}
