import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeJsonAtomic } from './atomic-write'
import { configPath } from './config-dir'

// The never-die Stop hook, registered GLOBALLY in ~/.claude/settings.json.
//
// The hook parks a phone-spawned session between turns so it stays reachable
// (docs/runbooks/remote-never-die-hook.md). A repo that carries no
// .claude/settings.json gets no listener, so a session started from the phone
// in that repo answers once and then goes quiet.
//
// Auto-installing it was deliberately rejected: the app does not silently write
// to ~/.claude. What it does now is the explicit variant — the phone (or a
// caller on the Mac) ASKS for it, once, and gets told exactly what was written.
// Idempotent, additive (never clobbers another tool's Stop hooks), and undoable
// through uninstallGlobalHook.

/** Seconds Claude Code lets the Stop hook block before it re-fires. */
export const HOOK_TIMEOUT_SECONDS = 3600

export type GlobalHookOpts = {
  /** Defaults to ~/.claude/settings.json (TERMINAL_CLAUDE_DIR overrides). */
  settingsPath?: string
  /** Defaults to the installed tm plugin's remote-check.sh. */
  command?: string
}

export type GlobalHookStatus = {
  installed: boolean
  settingsPath: string
  command: string
  /** False when the tm plugin has not been installed on this Mac yet. */
  commandExists: boolean
}

export type GlobalHookResult =
  | {
      ok: true
      /** False when the call was a no-op — already in the wanted state. */
      changed: boolean
      installed: boolean
      settingsPath: string
      command: string
      /** Exactly what was (or was not) written, for the caller to show. */
      message: string
    }
  | { ok: false; error: string }

type HookEntry = { type?: string; command?: string; timeout?: number; async?: boolean }
type HookGroup = { matcher?: string; hooks?: HookEntry[] }
type ClaudeSettings = { hooks?: { Stop?: HookGroup[] } } & Record<string, unknown>

function claudeDir(): string {
  const override = process.env.TERMINAL_CLAUDE_DIR?.trim()
  return override || join(homedir(), '.claude')
}

function resolve(opts?: GlobalHookOpts): { settingsPath: string; command: string } {
  return {
    settingsPath: opts?.settingsPath ?? join(claudeDir(), 'settings.json'),
    command: opts?.command ?? configPath('plugin', 'hooks', 'remote-check.sh'),
  }
}

/** Read the settings file. Missing ⇒ {}; unreadable ⇒ null (never overwrite). */
function readSettings(settingsPath: string): ClaudeSettings | null {
  if (!existsSync(settingsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ClaudeSettings
  } catch {
    return null
  }
}

function stopGroups(settings: ClaudeSettings): HookGroup[] {
  const stop = settings.hooks?.Stop
  return Array.isArray(stop) ? stop : []
}

function hasHook(settings: ClaudeSettings, command: string): boolean {
  return stopGroups(settings).some((g) => (g.hooks ?? []).some((h) => h.command === command))
}

export function globalHookStatus(opts?: GlobalHookOpts): GlobalHookStatus {
  const { settingsPath, command } = resolve(opts)
  const settings = readSettings(settingsPath)
  return {
    installed: settings ? hasHook(settings, command) : false,
    settingsPath,
    command,
    commandExists: existsSync(command),
  }
}

export function installGlobalHook(opts?: GlobalHookOpts): GlobalHookResult {
  const { settingsPath, command } = resolve(opts)
  // Registering a path that isn't there would make every Claude session run a
  // missing command on Stop — worse than not installing.
  if (!existsSync(command)) {
    return {
      ok: false,
      error: `the hook script isn't on this Mac yet (${command}) — open TerMinal once so it installs the tm plugin, then try again`,
    }
  }
  const settings = readSettings(settingsPath)
  if (!settings) {
    return {
      ok: false,
      error: `${settingsPath} isn't readable JSON — fix or move it aside, then try again (nothing was written)`,
    }
  }
  if (hasHook(settings, command)) {
    return {
      ok: true,
      changed: false,
      installed: true,
      settingsPath,
      command,
      message: `Already installed — ${settingsPath} runs ${command} on Stop.`,
    }
  }
  // Appended as its own group, never merged into someone else's: a matcher or
  // an `async` flag on an existing group belongs to whatever put it there.
  const groups = [
    ...stopGroups(settings),
    { hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] },
  ]
  const next: ClaudeSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}), Stop: groups },
  }
  try {
    writeJsonAtomic(settingsPath, next)
  } catch (e) {
    return { ok: false, error: `could not write ${settingsPath}: ${(e as Error).message}` }
  }
  return {
    ok: true,
    changed: true,
    installed: true,
    settingsPath,
    command,
    message: `Added a Stop hook to ${settingsPath} → ${command} (timeout ${HOOK_TIMEOUT_SECONDS}s). Sessions in every repo now stay reachable from your phone.`,
  }
}

export function uninstallGlobalHook(opts?: GlobalHookOpts): GlobalHookResult {
  const { settingsPath, command } = resolve(opts)
  const settings = readSettings(settingsPath)
  if (!settings) {
    return {
      ok: false,
      error: `${settingsPath} isn't readable JSON — fix or move it aside, then try again (nothing was written)`,
    }
  }
  if (!hasHook(settings, command)) {
    return {
      ok: true,
      changed: false,
      installed: false,
      settingsPath,
      command,
      message: `Nothing to remove — ${settingsPath} has no TerMinal Stop hook.`,
    }
  }
  // Only OUR command goes; a group that also held someone else's hook keeps it.
  const groups = stopGroups(settings)
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => h.command !== command) }))
    .filter((g) => g.hooks.length > 0)
  const hooks: Record<string, unknown> = { ...(settings.hooks ?? {}) }
  if (groups.length) hooks.Stop = groups
  else delete hooks.Stop
  const next: ClaudeSettings = { ...settings }
  if (Object.keys(hooks).length) next.hooks = hooks as ClaudeSettings['hooks']
  else delete next.hooks
  try {
    writeJsonAtomic(settingsPath, next)
  } catch (e) {
    return { ok: false, error: `could not write ${settingsPath}: ${(e as Error).message}` }
  }
  return {
    ok: true,
    changed: true,
    installed: false,
    settingsPath,
    command,
    message: `Removed the TerMinal Stop hook from ${settingsPath}.`,
  }
}
