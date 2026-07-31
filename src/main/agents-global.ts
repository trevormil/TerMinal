import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { Agent } from './agents'

// Global agent registry — agents available across every repo. Lives at
// ~/.config/TerMinal/agents/global.json. Same JSON-array-of-Agent shape as
// the per-repo .agents/agents.json. Per-repo wins by id at merge time so
// individual repos can still override a global agent.

const DEFAULT_FILE = join(homedir(), '.config', 'TerMinal', 'agents', 'global.json')

// Resolved per call (not at module load) so tests can point the registry at a
// temp dir instead of the operator's real ~/.config/TerMinal.
export const globalAgentsFile = (): string => {
  const explicit = process.env.TERMINAL_GLOBAL_AGENTS_FILE
  if (explicit) return explicit
  const dir = process.env.TERMINAL_AGENTS_DIR
  return dir ? join(dir, 'global.json') : DEFAULT_FILE
}

export function readGlobalAgents(): Agent[] {
  try {
    const file = globalAgentsFile()
    if (!existsSync(file)) return []
    const a = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(a) ? (a as Agent[]) : []
  } catch {
    return []
  }
}

function writeGlobalAgents(list: Agent[]): boolean {
  try {
    const file = globalAgentsFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(list, null, 2))
    return true
  } catch {
    return false
  }
}

/** The persisted shape of an agent definition. Mirrors the entry built by
 *  saveAgent in agents.ts, which this used to duplicate by hand while silently
 *  dropping modelPolicy/quality/model/outputContract/acceptanceCriteria/force.
 *  Computed provenance (`source`, `hasScript`) is deliberately not persisted —
 *  it is derived at read time and a stale copy confuses the repo/global merge. */
export function normalizeAgentEntry(
  agent: Partial<Agent> & { id: string; title: string; prompt: string },
): Agent {
  return {
    id: agent.id.trim(),
    title: agent.title.trim(),
    prompt: agent.prompt.trim(),
    description: agent.description?.trim() || undefined,
    icon: agent.icon || undefined,
    engine: agent.engine,
    model: agent.model?.trim() || undefined,
    modelPolicy: agent.modelPolicy,
    quality: agent.quality,
    outputContract: agent.outputContract?.trim() || undefined,
    acceptanceCriteria: agent.acceptanceCriteria,
    opensPr: agent.opensPr,
    inPlace: agent.inPlace,
    force: agent.force,
  }
}

/** Upsert an agent into the global registry. Validates the same shape as
 *  the per-repo saveAgent in agents.ts. */
export function saveGlobalAgent(
  agent: Partial<Agent> & { id: string; title: string; prompt: string },
): { ok: true } | { error: string } {
  const id = (agent.id || '').trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: 'id must be kebab-case (a-z, 0-9, -)' }
  if (!agent.title?.trim()) return { error: 'title is required' }
  if (!agent.prompt?.trim()) return { error: 'prompt is required' }
  const entry = normalizeAgentEntry({ ...agent, id })
  const list = readGlobalAgents()
  const i = list.findIndex((a) => a.id === id)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  if (!writeGlobalAgents(list)) return { error: `failed to write ${globalAgentsFile()}` }
  return { ok: true }
}

export function removeGlobalAgent(id: string): boolean {
  const list = readGlobalAgents()
  const next = list.filter((a) => a.id !== id)
  if (next.length === list.length) return false
  return writeGlobalAgents(next)
}
