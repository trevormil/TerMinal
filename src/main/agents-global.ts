import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { Agent } from './agents'

// Global agent registry — agents available across every repo. Lives at
// ~/.config/TerMinal/agents/global.json. Same JSON-array-of-Agent shape as
// the per-repo .agents/agents.json. Per-repo wins by id at merge time so
// individual repos can still override a global agent.

const FILE = join(homedir(), '.config', 'TerMinal', 'agents', 'global.json')

export function readGlobalAgents(): Agent[] {
  try {
    if (!existsSync(FILE)) return []
    const a = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(a) ? (a as Agent[]) : []
  } catch {
    return []
  }
}

function writeGlobalAgents(list: Agent[]): boolean {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(list, null, 2))
    return true
  } catch {
    return false
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
  const entry: Agent = {
    id,
    title: agent.title.trim(),
    description: agent.description?.trim(),
    icon: agent.icon,
    prompt: agent.prompt,
    opensPr: !!agent.opensPr,
    engine: agent.engine,
    inPlace: agent.inPlace,
  }
  const list = readGlobalAgents()
  const i = list.findIndex((a) => a.id === id)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  if (!writeGlobalAgents(list))
    return { error: 'failed to write ~/.config/TerMinal/agents/global.json' }
  return { ok: true }
}

export function removeGlobalAgent(id: string): boolean {
  const list = readGlobalAgents()
  const next = list.filter((a) => a.id !== id)
  if (next.length === list.length) return false
  return writeGlobalAgents(next)
}
