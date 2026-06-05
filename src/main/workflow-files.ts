import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { Entry, ReadResult } from './files'

const ROOTS = [
  { id: 'claude', name: '.claude', root: join(homedir(), '.claude') },
  { id: 'codex', name: '.codex', root: join(homedir(), '.codex') },
] as const

const SKIP_NAMES = new Set([
  '.DS_Store',
  '.git',
  'node_modules',
  'projects',
  'sessions',
  'shell-snapshots',
  'statsig',
  'tmp',
  'cache',
  'logs',
  'backups',
])
const MAX_FILE_BYTES = 2_000_000

function parts(rel: string): { root: (typeof ROOTS)[number]; child: string } | null {
  const [id, ...rest] = String(rel || '').split('/').filter(Boolean)
  const root = ROOTS.find((r) => r.id === id)
  return root ? { root, child: rest.join('/') } : null
}

function safe(rel: string): { root: (typeof ROOTS)[number]; abs: string; child: string } | null {
  const p = parts(rel)
  if (!p) return null
  const root = resolve(p.root.root)
  const abs = resolve(root, p.child || '.')
  if (abs !== root && !abs.startsWith(root + sep)) return null
  return { root: p.root, abs, child: p.child }
}

export function listWorkflowFiles(rel = ''): Entry[] {
  if (!rel) return ROOTS.map((r) => ({ name: r.name, path: r.id, dir: true, ignored: !existsSync(r.root) }))
  const p = safe(rel)
  if (!p || !existsSync(p.abs)) return []
  let names: string[]
  try {
    names = readdirSync(p.abs).filter((n) => !SKIP_NAMES.has(n))
  } catch {
    return []
  }
  const out: Entry[] = []
  for (const name of names) {
    const abs = join(p.abs, name)
    try {
      const st = statSync(abs)
      out.push({ name, path: p.child ? `${p.root.id}/${p.child}/${name}` : `${p.root.id}/${name}`, dir: st.isDirectory() })
    } catch {
      /* skip disappearing entries */
    }
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

export function readWorkflowFile(rel: string): ReadResult {
  const p = safe(rel)
  if (!p || !existsSync(p.abs)) return { ok: false, content: '', reason: 'not found' }
  try {
    const st = statSync(p.abs)
    if (st.isDirectory()) return { ok: false, content: '', reason: 'directory' }
    if (st.size > MAX_FILE_BYTES) return { ok: false, content: '', reason: 'file too large (>2 MB)' }
    const buf = readFileSync(p.abs)
    if (buf.includes(0)) return { ok: false, content: '', reason: 'binary file' }
    return { ok: true, content: buf.toString('utf8') }
  } catch (e) {
    return { ok: false, content: '', reason: (e as Error).message }
  }
}

export function writeWorkflowFile(rel: string, content: string): boolean {
  const p = safe(rel)
  if (!p || !existsSync(p.abs) || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return false
  try {
    if (statSync(p.abs).isDirectory()) return false
    writeFileSync(p.abs, content)
    return true
  } catch {
    return false
  }
}
