import { configPath } from './config-dir'
import { CorruptStateError, readJsonState, updateJsonState } from './atomic-write'
import type { Agent } from './agents'

// Global agent registry — agents available across every repo. Lives at
// ~/.config/TerMinal/agents/global.json. Same JSON-array-of-Agent shape as
// the per-repo .agents/agents.json. Per-repo wins by id at merge time so
// individual repos can still override a global agent.

// Resolved per call (not at module load) through the one config-dir seam, so a
// test can point the whole registry at a temp dir. See src/main/config-dir.ts.
export const globalAgentsFile = (): string => configPath('agents', 'global.json')
const isAgentList = (v: unknown): boolean => Array.isArray(v)

/**
 * Read the registry. An unparseable file yields `[]` so the UI can still render,
 * but callers must NOT write that back — saveGlobalAgent refuses instead.
 */
export function readGlobalAgents(): Agent[] {
  return readJsonState<Agent[]>(globalAgentsFile(), () => [], { accept: isAgentList }).value
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
  try {
    updateJsonState<Agent[]>(
      globalAgentsFile(),
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
    return { error: `failed to write ${globalAgentsFile()}` }
  }
}

export function removeGlobalAgent(id: string): boolean {
  try {
    let removed = false
    updateJsonState<Agent[]>(
      globalAgentsFile(),
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
