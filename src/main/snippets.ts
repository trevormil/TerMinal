import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// Saved prompts / snippets — reusable prompt text you inject into a session's
// terminal. Stored globally (reusable across repos).
const FILE = join(homedir(), '.config', 'gauntlet-terminal', 'snippets.json')

export type Snippet = { id: string; title: string; body: string }

export function readSnippets(): Snippet[] {
  if (!existsSync(FILE)) return []
  try {
    const a = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function writeSnippets(list: Snippet[]): boolean {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(list, null, 2))
    return true
  } catch {
    return false
  }
}
