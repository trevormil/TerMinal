import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

// Notes:
//   global → ~/.config/TerMinal/notes.md  (unbound, spans all repos)
//   repo   → <repoRoot>/.TerMinal/notes.md (bound to the repo, gitignored)
// Both persist on disk, so they survive across sessions.

export type NotesScope = 'repo' | 'global'
export type NoteFolderEntry = { name: string; path: string; dir: boolean }

const GLOBAL = join(homedir(), '.config', 'TerMinal', 'notes.md')
const repoNotesPath = (repoRoot: string) => join(repoRoot, '.TerMinal', 'notes.md')

// keep notes.md out of git without touching the committed widgets.json
function ensureGitignored(repoRoot: string) {
  const gi = join(repoRoot, '.gitignore')
  const entry = '.TerMinal/notes.md'
  try {
    let content = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
    if (content.split('\n').some((l) => l.trim() === entry)) return
    if (content && !content.endsWith('\n')) content += '\n'
    writeFileSync(gi, content + entry + '\n')
  } catch {
    /* best effort — note still works, just not auto-ignored */
  }
}

function pathFor(scope: NotesScope, repoRoot: string): string {
  return scope === 'global' ? GLOBAL : repoRoot ? repoNotesPath(repoRoot) : ''
}

export function readNotes(scope: NotesScope, repoRoot: string): string {
  const p = pathFor(scope, repoRoot)
  if (!p || !existsSync(p)) return ''
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

export function writeNotes(scope: NotesScope, content: string, repoRoot: string): boolean {
  const p = pathFor(scope, repoRoot)
  if (!p) return false
  if (scope === 'repo') ensureGitignored(repoRoot)
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
    return true
  } catch {
    return false
  }
}

const NOTE_EXT = new Set(['.md', '.markdown', '.mdx', '.txt'])
const IGNORE = new Set(['.git', 'node_modules', '.obsidian', '.trash', '.DS_Store'])

function safe(root: string, rel: string): string | null {
  const r = resolve(root)
  const p = resolve(root, rel || '.')
  if (p !== r && !p.startsWith(r + sep)) return null
  return p
}

function noteLike(name: string): boolean {
  const lower = name.toLowerCase()
  return [...NOTE_EXT].some((ext) => lower.endsWith(ext))
}

export function listNoteFolder(root: string, rel: string): NoteFolderEntry[] {
  const abs = safe(root, rel)
  if (!abs || !existsSync(abs)) return []
  try {
    return readdirSync(abs)
      .filter((name) => !IGNORE.has(name) && !name.startsWith('.'))
      .map((name) => {
        const child = join(abs, name)
        const st = statSync(child)
        return { name, path: rel ? join(rel, name) : name, dir: st.isDirectory() }
      })
      .filter((entry) => entry.dir || noteLike(entry.name))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  } catch {
    return []
  }
}

export function readNoteFolderFile(
  root: string,
  rel: string,
): { ok: boolean; content: string; reason?: string } {
  if (!noteLike(rel)) return { ok: false, content: '', reason: 'not a note file' }
  const abs = safe(root, rel)
  if (!abs || !existsSync(abs)) return { ok: false, content: '', reason: 'not found' }
  try {
    const st = statSync(abs)
    if (st.isDirectory()) return { ok: false, content: '', reason: 'directory' }
    if (st.size > 2_000_000) return { ok: false, content: '', reason: 'file too large (>2 MB)' }
    const buf = readFileSync(abs)
    if (buf.includes(0)) return { ok: false, content: '', reason: 'binary file' }
    return { ok: true, content: buf.toString('utf8') }
  } catch (e) {
    return { ok: false, content: '', reason: (e as Error).message }
  }
}

export function writeNoteFolderFile(root: string, rel: string, content: string): boolean {
  if (!noteLike(rel)) return false
  const abs = safe(root, rel)
  if (!abs) return false
  try {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
    return true
  } catch {
    return false
  }
}
