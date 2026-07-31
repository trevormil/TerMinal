import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

// App-owned presets (built-in agents, snippets, automation packs) ship with the
// app, so they can't be deleted. "Delete" is instead a per-kind denylist of ids
// the user dismissed, which rendering code filters against.
export type PresetKind = 'agents' | 'snippets' | 'packs'
const KINDS: PresetKind[] = ['agents', 'snippets', 'packs']
export type PresetPrefs = {
  version: number
  hidden: Record<PresetKind, string[]>
}

const DEFAULT_FILE = join(homedir(), '.config', 'TerMinal', 'presets.json')

// Lazy, so a test can redirect writes to a temp dir. Mirrors cron-runs.ts.
function file(): string {
  return process.env.TERMINAL_PRESETS_FILE || DEFAULT_FILE
}
const VERSION = 1

const empty = (): PresetPrefs => ({
  version: VERSION,
  hidden: { agents: [], snippets: [], packs: [] },
})

export function readPresetPrefs(): PresetPrefs {
  try {
    if (!existsSync(file())) return empty()
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<PresetPrefs>
    const hidden = empty().hidden
    for (const kind of KINDS) {
      const v = raw.hidden?.[kind]
      hidden[kind] = Array.isArray(v) ? v.filter(Boolean) : []
    }
    return { version: VERSION, hidden }
  } catch {
    return empty()
  }
}

function writePresetPrefs(prefs: PresetPrefs): PresetPrefs {
  const hidden = empty().hidden
  for (const kind of KINDS) hidden[kind] = [...new Set(prefs.hidden[kind] || [])].sort()
  const next: PresetPrefs = { version: VERSION, hidden }
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(next, null, 2) + '\n')
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
