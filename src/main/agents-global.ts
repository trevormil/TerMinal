import { configPath } from './config-dir'
import { CorruptStateError, readJsonState, updateJsonState } from './atomic-write'
import type { Agent } from './agents'

// Global agent registry — agents available across every repo. Lives at
// ~/.config/TerMinal/agents/global.json. Same JSON-array-of-Agent shape as
// the per-repo .agents/agents.json. Per-repo wins by id at merge time so
// individual repos can still override a global agent.

const file = () => configPath('agents', 'global.json')
const isAgentList = (v: unknown): boolean => Array.isArray(v)

/**
 * Read the registry. An unparseable file yields `[]` so the UI can still render,
 * but callers must NOT write that back — saveGlobalAgent refuses instead.
 */
export function readGlobalAgents(): Agent[] {
  return readJsonState<Agent[]>(file(), () => [], { accept: isAgentList }).value
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
  try {
    updateJsonState<Agent[]>(
      file(),
      () => [],
      (list) => {
        const next = [...list]
        const i = next.findIndex((a) => a.id === id)
        if (i >= 0) next[i] = entry
        else next.push(entry)
        return next
      },
      { accept: isAgentList },
    )
    return { ok: true }
  } catch (e) {
    // A corrupt registry is the one case where "just write it anyway" is
    // catastrophic: it replaces every other global agent with this one entry.
    if (e instanceof CorruptStateError) return { error: e.message }
    return { error: `failed to write ${file()}` }
  }
}

export function removeGlobalAgent(id: string): boolean {
  try {
    let removed = false
    updateJsonState<Agent[]>(
      file(),
      () => [],
      (list) => {
        const next = list.filter((a) => a.id !== id)
        removed = next.length !== list.length
        return removed ? next : undefined
      },
      { accept: isAgentList },
    )
    return removed
  } catch {
    return false
  }
}
