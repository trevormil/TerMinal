// Where the MCP server reads and writes.
//
// The config-dir seam is `src/runner/config.ts` — the one every standalone
// bundle shares, resolved per call so a sandboxed run can redirect it
// (ticket 108).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CFG } from '../runner/config'

export { CFG }

/** Arbitrary JSON arguments off an MCP tool call. */
export type Args = Record<string, any>

export const SETTINGS_FILE = (): string => join(CFG(), 'settings.json')
export const TG_SIDECAR = (): string => join(CFG(), 'telegram.local.json')
export const SLACK_SIDECAR = (): string => join(CFG(), 'slack.local.json')
export const HITL_FILE = (): string => join(CFG(), 'hitl.json')
export const ACTIVITY_FILE = (): string => join(CFG(), 'activity.jsonl')
export const LEGACY_TG_SCRIPT = (): string =>
  join(homedir(), '.claude', 'bin', 'telegram-notify.sh')

export function readSettings(): Record<string, any> {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE(), 'utf8'))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

export function configuredProjectsDir(): string {
  const s = readSettings()
  return typeof s.projectsDir === 'string' && s.projectsDir ? s.projectsDir : homedir()
}

export function configuredHarnessDir(): string {
  if (process.env.GT_HARNESS_DIR) return process.env.GT_HARNESS_DIR
  const s = readSettings()
  return typeof s.harnessDir === 'string' ? s.harnessDir : ''
}

export function prsRoot(): string {
  const dir = configuredHarnessDir()
  return dir ? join(dir, 'prs') : ''
}
