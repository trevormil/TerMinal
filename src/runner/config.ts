// Single resolution point for the config dir, honouring TERMINAL_CONFIG_DIR the
// same way src/main/config-dir.ts does. These are SEPARATE PROCESSES writing the
// same files as the app, so a sandboxed run that only redirected the app would
// still have this script clobbering real state — which is precisely how an agent
// script would do it (ticket 108). Resolved on call rather than at import: each
// invocation is a fresh short-lived process, so the two are observationally the
// same, and call-time resolution keeps the unit tests off the developer's real
// state.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function CFG(): string {
  return process.env.TERMINAL_CONFIG_DIR?.trim() || join(homedir(), '.config', 'TerMinal')
}

export const SCHED_FILE = (): string => join(CFG(), 'schedules.json')
export const RUNS_DIR = (): string => join(CFG(), 'cron-runs')
export const WT_DIR = (): string => join(CFG(), 'cron-worktrees')
export const AI_RUNS_DIR = (): string => join(CFG(), 'ai-runs')
export const ACTIVITY_FILE = (): string => join(CFG(), 'activity.jsonl')
export const CRON_LOG = (): string => join(CFG(), 'cron.log')
export const HITL_FILE = (): string => join(CFG(), 'hitl.json')
export const SETTINGS_FILE = (): string => join(CFG(), 'settings.json')
export const TG_SIDECAR = (): string => join(CFG(), 'telegram.local.json')
export const SLACK_SIDECAR = (): string => join(CFG(), 'slack.local.json')
export const DISABLED_FILE = (): string => join(CFG(), 'agents', 'disabled.json')
export const MONITOR_LOG = (): string => join(CFG(), 'monitor.log')
export const RETENTION_MARKER = (): string => join(CFG(), 'retention.last.json')
export const REVIEW_PATTERNS_MARKER = (): string => join(CFG(), 'review-patterns.last.json')
export const TERMINAL_BIN_DIR = (): string => join(CFG(), 'bin')
export const LEGACY_TG_SCRIPT = (): string =>
  join(homedir(), '.claude', 'bin', 'telegram-notify.sh')

/** Read a JSON file, or `null` when absent/unparseable. Never throws. */
export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}
