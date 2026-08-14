// Shared remote-dispatch helpers.
//
// Four IPC registrars (agents, schedules, tickets, background tasks) all need
// the same four things when a run targets a host rather than the Mac: the merged
// agent catalog, the composed persona/pipeline steps, the local-only engine
// coercion, and the host's model resolution. They live here so no registrar owns
// them and index.ts only wires them.

import { composeSteps, pipelineLabel } from './pipelines'
import { hiddenPresetIds } from './presets'
import { resolveEngineModel } from './settings'
import { DEFAULT_AGENTS, readAgentRunContexts, type Agent, type Engine } from './agents'
import { remoteAgents, type RemoteSessionRef } from './remote'

export async function remoteAgentCatalog(remote: RemoteSessionRef): Promise<Agent[]> {
  const hiddenDefaults = hiddenPresetIds('agents')
  const byId = new Map<string, Agent>()
  for (const a of DEFAULT_AGENTS.filter((a) => !hiddenDefaults.has(a.id))) {
    byId.set(a.id, { ...a, source: 'default', hasScript: false })
  }
  for (const a of await remoteAgents.list(remote).catch(() => [])) {
    byId.set(a.id, {
      ...byId.get(a.id),
      ...a,
      source: byId.has(a.id) ? ('repo-override' as const) : ('repo' as const),
    })
  }
  return [...byId.values()]
}

export function remoteSteps(
  base: { label: string; prompt: string },
  personaId?: string,
  pipelineId?: string,
) {
  const persona = personaId ? readAgentRunContexts('').find((p) => p.id === personaId) : null
  return {
    steps: composeSteps(base, persona?.prompt ?? null, pipelineId),
    persona: persona?.title,
    pipeline: pipelineLabel(pipelineId),
  }
}

// OpenRouter (or-agent) and Hermes are local-only harnesses — a remote host has
// neither, so coerce them to a universally-present engine for remote dispatch.
export function localOnlyToRemote(engine: Engine): Engine {
  // openrouter/openai-compat ride the local or-agent harness + local Settings
  // (base URL, sealed keys); hermes is a local install. None dispatch remotely.
  return engine === 'openrouter' || engine === 'hermes' || engine === 'openai-compat'
    ? 'claude'
    : engine
}

export function remoteEngineModel(
  remote: RemoteSessionRef,
  engine: Engine,
  model?: string,
): string | undefined {
  return resolveEngineModel(engine, model, remote.daemon) || undefined
}
