import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// Tiny persisted key/value settings. Kept deliberately minimal — add a key +
// a default here, expose it via settings:get/set, and it's available app-wide.
export type Settings = {
  telegram: boolean // mirror notifications to the /notify Telegram bridge (opt-in)
  telegramControl: boolean // accept inbound commands from Telegram (AFK remote, opt-in)
}
const DEFAULTS: Settings = { telegram: false, telegramControl: false }
const FILE = join(homedir(), '.config', 'gauntlet-terminal', 'settings.json')

let cache: Settings | null = null
export function readSettings(): Settings {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Settings>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  const next = { ...readSettings(), [key]: value }
  cache = next
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(next, null, 2))
  } catch {
    /* best effort */
  }
  return next
}

export const telegramEnabled = () => readSettings().telegram
export const telegramControlEnabled = () => readSettings().telegramControl
