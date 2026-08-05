import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { configPath } from './config-dir'

// Agent CONTRACTS (.agents/<kind>.md) describe how a cadence agent behaves:
// what it inspects, what it writes, when it files a ticket. Every repo used to
// carry all 17 of them, byte-identical, because bootstrap copied them — the
// same duplication that made per-repo skills drift, in a directory nobody
// re-ran bootstrap to refresh.
//
// They are layered instead, exactly like agent SCRIPTS already are
// (agent-registry.ts: per-repo `.agents/<id>.sh` wins over the global one):
//
//   1. <repo>/.agents/<kind>.md   — the repo's own contract, if it has one
//   2. <plugin>/agents/<kind>.md  — the shipped default
//
// A repo that wants a different contract still writes one and it wins, and it
// is still committed and shared with the team — which is what ADR-0020 was
// protecting when it kept `.agents/` in the repo. What changes is that a repo
// which never customized anything no longer carries 17 copies of the default.

export type AgentContract = {
  /** Absolute path to the contract to follow. */
  path: string
  /** Where it came from — 'repo' means this project overrides the default. */
  source: 'repo' | 'plugin'
}

/** The plugin's contract directory. Installed alongside its skills and bin. */
export function pluginAgentsDir(): string {
  return join(configPath('plugin'), 'agents')
}

/**
 * Resolve one agent contract, repo override first. Returns null when neither
 * layer has it — the caller decides whether that is an error (a run) or simply
 * nothing to show (the UI).
 */
export function agentContract(repoRoot: string, kind: string): AgentContract | null {
  // Reject anything that could climb out of the directory: `kind` reaches here
  // from agent ids and, through the CLI, from user input.
  if (!kind || kind.includes('/') || kind.includes('\\') || kind.startsWith('.')) return null

  if (repoRoot) {
    const repo = join(repoRoot, '.agents', `${kind}.md`)
    if (existsSync(repo)) return { path: repo, source: 'repo' }
  }
  const shipped = join(pluginAgentsDir(), `${kind}.md`)
  if (existsSync(shipped)) return { path: shipped, source: 'plugin' }
  return null
}

/**
 * Every contract available to a repo, by kind — the union of both layers, with
 * the repo's own winning. Used to list what a repo can actually run, which is
 * no longer answerable by reading one directory.
 */
export function listAgentContracts(repoRoot: string): Map<string, AgentContract> {
  const out = new Map<string, AgentContract>()
  const add = (dir: string, source: 'repo' | 'plugin') => {
    if (!dir || !existsSync(dir)) return
    for (const entry of readdirSafe(dir)) {
      if (!entry.endsWith('.md')) continue
      const kind = entry.slice(0, -3)
      // Plugin defaults are added first, so a repo entry overwrites; guard
      // anyway so the intent survives a reordering.
      if (source === 'plugin' && out.has(kind)) continue
      out.set(kind, { path: join(dir, entry), source })
    }
  }
  add(pluginAgentsDir(), 'plugin')
  if (repoRoot) add(join(repoRoot, '.agents'), 'repo')
  return out
}

// A missing or unreadable directory is a normal empty result — the plugin may
// not be installed yet on first launch, and a repo need not have `.agents` at
// all. (Static import: `require` throws in the ESM main bundle.)
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
