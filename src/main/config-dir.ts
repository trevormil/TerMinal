import { homedir } from 'node:os'
import { join } from 'node:path'

// Single resolution point for ~/.config/TerMinal.
//
// It exists to be overridable. Every state module used to bake
// `join(homedir(), '.config', 'TerMinal', ...)` into a module-level const, which
// meant a test importing the module was wired to the developer's REAL state
// before its first line ran — and one such test did overwrite a real global
// agent registry. Resolving lazily through `TERMINAL_CONFIG_DIR` gives tests a
// temp dir to point at, and gives multi-profile/CI runs somewhere else to live.

export function terminalConfigDir(): string {
  const override = process.env.TERMINAL_CONFIG_DIR?.trim()
  return override || join(homedir(), '.config', 'TerMinal')
}

/** A path inside the TerMinal config dir. Call at use time, never at import. */
export function configPath(...parts: string[]): string {
  return join(terminalConfigDir(), ...parts)
}
