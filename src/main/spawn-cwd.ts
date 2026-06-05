import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function processSpawnCwd(cwd: string | undefined, fallback = homedir()): string {
  const requested = cwd?.trim()
  if (requested && isDirectory(requested)) return requested
  return isDirectory(fallback) ? fallback : homedir()
}
