import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { configPath } from './config-dir'
import { hiddenPresetIds } from './presets'
import { normalizeAgentEntry, readGlobalAgents } from './agents-global'
import { DEFAULT_AGENTS } from './agent-catalog'
import type { Agent } from './agent-types'

// The agent DEFINITION registry (ticket 91): read, layer-merge, save and reset
// of Agent entries across default → global → repo. Extracted from agents.ts so
// the layering logic is testable without dragging in the spawn runtime (and,
// transitively, electron). The RUNTIME (runs, spawning, logs) stays in
// agents.ts; the global-registry file IO stays in agents-global.ts.

function readRepoAgents(repoRoot: string): Agent[] {
  const f = join(repoRoot, '.agents', 'agents.json')
  if (!existsSync(f)) return []
  try {
    const a = JSON.parse(readFileSync(f, 'utf8'))
    const list = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : []
    return list.filter((x: Agent) => x && x.id && x.title && x.prompt)
  } catch {
    return []
  }
}

// Discover script-only agents from a directory: any `<id>.sh` paired with an
// optional sidecar `<id>.json` of metadata. No JSON entry in agents.json
// required — drop the .sh and the agent shows up.
function readScriptAgents(dir: string): Agent[] {
  if (!existsSync(dir)) return []
  const out: Agent[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  for (const f of entries) {
    if (!f.endsWith('.sh')) continue
    const id = f.slice(0, -3)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue
    // Sidecar JSON (optional) provides metadata; otherwise we synthesize sane defaults.
    let meta: Partial<Agent> = {}
    const sidecar = join(dir, `${id}.json`)
    if (existsSync(sidecar)) {
      try {
        meta = JSON.parse(readFileSync(sidecar, 'utf8'))
      } catch {
        /* malformed sidecar — fall back to defaults */
      }
    }
    out.push({
      id,
      title: meta.title || id,
      description: meta.description,
      icon: meta.icon || 'Wrench',
      // The prompt is the canonical "what does this agent do" surface in the UI;
      // for script-only agents we point at the file rather than duplicate the bash.
      prompt: meta.prompt || `Script-based agent · body in ${dir.replace(homedir(), '~')}/${f}`,
      opensPr: meta.opensPr,
      engine: meta.engine,
      model: meta.model,
      modelPolicy: meta.modelPolicy,
      quality: meta.quality,
      outputContract: meta.outputContract,
      acceptanceCriteria: meta.acceptanceCriteria,
      inPlace: meta.inPlace,
      force: meta.force,
    })
  }
  return out
}

// An agent's executable body. Per-repo .agents/<id>.sh wins so a repo can
// override a global agent's body. The runner branches: if a script exists,
// exec it with env vars; else fall back to the prompt-based agent.
const GLOBAL_SCRIPTS_DIR = (): string => configPath('scripts')
export function locateScript(repoRoot: string, agentId: string): string | null {
  const perRepo = join(repoRoot, '.agents', `${agentId}.sh`)
  if (existsSync(perRepo)) return perRepo
  const global = join(GLOBAL_SCRIPTS_DIR(), `${agentId}.sh`)
  if (existsSync(global)) return global
  return null
}

/** Built-in defaults, with the repo's .agents/agents.json overriding by id.
 *  Each agent is annotated with its `source` so the UI can distinguish a stock
 *  default, a default this repo has customized, and a repo-only agent. */
export function readAgents(repoRoot: string): Agent[] {
  type Layered = { agent: Agent; layers: Set<'default' | 'global' | 'repo'> }
  const byId = new Map<string, Layered>()
  const hiddenDefaults = hiddenPresetIds('agents')
  const merge = (a: Agent, layer: 'default' | 'global' | 'repo') => {
    const existing = byId.get(a.id)
    if (existing) {
      existing.layers.add(layer)
      // later layer wins for individual fields (only override fields it sets)
      existing.agent = { ...existing.agent, ...a }
    } else {
      byId.set(a.id, { agent: { ...a }, layers: new Set([layer]) })
    }
  }
  // Layer order: defaults → global (json then scripts) → repo (json then scripts).
  // Script bodies are independent from the JSON metadata; the runtime branches
  // on file existence, but the agent list cares only about the merged metadata.
  for (const a of DEFAULT_AGENTS) if (!hiddenDefaults.has(a.id)) merge(a, 'default')
  for (const a of readGlobalAgents()) merge(a, 'global')
  for (const a of readScriptAgents(GLOBAL_SCRIPTS_DIR())) merge(a, 'global')
  if (repoRoot) for (const a of readRepoAgents(repoRoot)) merge(a, 'repo')
  if (repoRoot) for (const a of readScriptAgents(join(repoRoot, '.agents'))) merge(a, 'repo')

  const out: Agent[] = []
  for (const { agent, layers } of byId.values()) {
    let source: Agent['source']
    if (layers.has('repo'))
      source = layers.has('default') || layers.has('global') ? 'repo-override' : 'repo'
    else if (layers.has('global')) source = layers.has('default') ? 'global-override' : 'global'
    else source = 'default'
    out.push({ ...agent, source, hasScript: !!locateScript(repoRoot, agent.id) })
  }
  return out
}

/** Upsert an agent into <repo>/.agents/agents.json (creates it). Overriding a
 *  built-in default = writing an entry with the same id. */
export function saveAgent(
  repoRoot: string,
  agent: Partial<Agent> & { id: string; title: string; prompt: string },
): { ok: true } | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const id = (agent.id || '').trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: 'id must be kebab-case (a-z, 0-9, -)' }
  if (!agent.title?.trim()) return { error: 'title is required' }
  if (!agent.prompt?.trim()) return { error: 'prompt is required' }
  // ONE definition of the persisted shape, shared with the global registry
  // (ticket 96). The two used to be identical hand-written literals, which is
  // exactly the state in which duplication is invisible — and #78 exists
  // because an earlier divergence silently dropped modelPolicy, quality, model,
  // outputContract, acceptanceCriteria and force on every save.
  const entry = normalizeAgentEntry({ ...agent, id })
  const dir = join(repoRoot, '.agents')
  const f = join(dir, 'agents.json')
  const list = readRepoAgents(repoRoot).filter((a) => a.id !== id)
  list.push(entry)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(f, JSON.stringify(list, null, 2) + '\n')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Remove an agent override from .agents/agents.json — a customized default
 *  reverts to the built-in; a repo-only agent is deleted. */
export function resetAgent(repoRoot: string, id: string): { ok: true } | { error: string } {
  const f = join(repoRoot, '.agents', 'agents.json')
  if (!existsSync(f)) return { ok: true }
  try {
    const list = readRepoAgents(repoRoot).filter((a) => a.id !== id)
    writeFileSync(f, JSON.stringify(list, null, 2) + '\n')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// every git repo gets the default agents
export function hasAgents(repoRoot: string): boolean {
  return !!repoRoot
}
