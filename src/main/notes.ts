import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { configPath } from './config-dir'
import { repoStatePathForRead, repoStatePathForWrite } from './repo-state'

// Notes:
//   global → ~/.config/TerMinal/notes.md  (unbound, spans all repos)
//   repo   → the repo's SIDECAR notes.md (personal state, never in the repo);
//            a legacy in-repo .TerMinal/notes.md stays readable until migrated.
// Both persist on disk, so they survive across sessions.

export type NotesScope = 'repo' | 'global'

const GLOBAL = (): string => configPath('notes.md')

function pathFor(scope: NotesScope, repoRoot: string, mode: 'read' | 'write'): string {
  if (scope === 'global') return GLOBAL()
  if (!repoRoot) return ''
  return mode === 'read'
    ? repoStatePathForRead(repoRoot, 'notes.md')
    : repoStatePathForWrite(repoRoot, 'notes.md')
}

export function readNotes(scope: NotesScope, repoRoot: string): string {
  const p = pathFor(scope, repoRoot, 'read')
  if (!p || !existsSync(p)) return ''
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

export function writeNotes(scope: NotesScope, content: string, repoRoot: string): boolean {
  const p = pathFor(scope, repoRoot, 'write')
  if (!p) return false
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
    return true
  } catch {
    return false
  }
}
