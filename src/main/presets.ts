import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type PresetKind = 'agents' | 'snippets'
export type PresetPrefs = {
  version: number
  hidden: Record<PresetKind, string[]>
}

const FILE = join(homedir(), '.config', 'TerMinal', 'presets.json')
const VERSION = 1

const empty = (): PresetPrefs => ({ version: VERSION, hidden: { agents: [], snippets: [] } })

export function readPresetPrefs(): PresetPrefs {
  try {
    if (!existsSync(FILE)) return empty()
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<PresetPrefs>
    return {
      version: VERSION,
      hidden: {
        agents: Array.isArray(raw.hidden?.agents) ? raw.hidden.agents.filter(Boolean) : [],
        snippets: Array.isArray(raw.hidden?.snippets) ? raw.hidden.snippets.filter(Boolean) : [],
      },
    }
  } catch {
    return empty()
  }
}

function writePresetPrefs(prefs: PresetPrefs): PresetPrefs {
  const next: PresetPrefs = {
    version: VERSION,
    hidden: {
      agents: [...new Set(prefs.hidden.agents)].sort(),
      snippets: [...new Set(prefs.hidden.snippets)].sort(),
    },
  }
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n')
  return next
}

export function hiddenPresetIds(kind: PresetKind): Set<string> {
  return new Set(readPresetPrefs().hidden[kind])
}

export function hidePreset(kind: PresetKind, id: string): PresetPrefs {
  const prefs = readPresetPrefs()
  prefs.hidden[kind] = [...new Set([...prefs.hidden[kind], id])]
  return writePresetPrefs(prefs)
}

export function restorePreset(kind: PresetKind, id?: string): PresetPrefs {
  const prefs = readPresetPrefs()
  prefs.hidden[kind] = id ? prefs.hidden[kind].filter((x) => x !== id) : []
  return writePresetPrefs(prefs)
}
