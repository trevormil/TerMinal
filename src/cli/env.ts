// The CLI's view of its environment: where state lives, and which repo/agent/run
// the invoking script belongs to.
//
// The config-dir seam is `src/runner/config.ts` — the one every standalone
// bundle shares, resolved per call so a sandboxed run can redirect it
// (ticket 108). Paths are accessors for the same reason.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { CFG } from '../runner/config'

export { CFG }

export const ACTIVITY = (): string => join(CFG(), 'activity.jsonl')
export const HITL_FILE = (): string => join(CFG(), 'hitl.json')
export const SETTINGS_FILE = (): string => join(CFG(), 'settings.json')
export const AGENT_STATE_DIR = (): string => join(CFG(), 'agent-state')
export const LISTENER_ROOT = (): string => join(CFG(), 'automation-inbox')
export const TG_SIDECAR = (): string => join(CFG(), 'telegram.local.json')
export const SLACK_SIDECAR = (): string => join(CFG(), 'slack.local.json')
export const MONITORS_FILE = (): string => join(CFG(), 'monitors.json')
export const MONITOR_STATE_DIR = (): string => join(CFG(), 'monitor-state')
export const REMOTE_DIR = (): string => join(CFG(), 'remote')
export const LOOPS_FILE = (): string => join(CFG(), 'loops.json')
export const TERMINAL_BIN = (name: string): string => join(CFG(), 'bin', name)
export const LEGACY_TG_SCRIPT = (): string =>
  join(homedir(), '.claude', 'bin', 'telegram-notify.sh')

/** The repo the runner exec'd this script for ('' outside a run). */
export const repo = (): string => process.env.TERMINAL_REPO || ''
export const repoLabel = (): string => (repo() ? basename(repo()) : '')
export const runId = (): string => process.env.TERMINAL_RUN_ID || ''
export const agentId = (): string => process.env.TERMINAL_AGENT_ID || ''

export function readSettings(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE(), 'utf8'))
  } catch {
    return {}
  }
}
