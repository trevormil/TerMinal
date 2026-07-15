import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  renameSync,
} from 'node:fs'
import { join, resolve, sep, dirname } from 'node:path'
import { execFile, execFileSync } from 'node:child_process'

// Scoped file access for the Files tab. Every path is validated to stay within
// the root (the attached session's repo/cwd) — no traversal out.

const IGNORE = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  '.next',
  '.cache',
  '.turbo',
  '.vite',
  'coverage',
  '.DS_Store',
])

export type Entry = { name: string; path: string; dir: boolean; ignored?: boolean }

function safe(root: string, rel: string): string | null {
  const r = resolve(root)
  const p = resolve(root, rel || '.')
  if (p !== r && !p.startsWith(r + sep)) return null
  return p
}

// Which of these repo-relative paths git ignores. Best-effort: empty set if the
// root isn't a git repo (check-ignore exits non-zero → no stdout to parse).
function gitIgnored(root: string, relPaths: string[]): Set<string> {
  if (relPaths.length === 0) return new Set()
  const parse = (out: unknown) =>
    new Set(
      typeof out === 'string'
        ? out
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
  try {
    return parse(
      execFileSync('git', ['-C', root, 'check-ignore', '--', ...relPaths], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch (e) {
    // exit 1 = nothing ignored, exit 128 = not a repo — both throw with empty stdout
    return parse((e as { stdout?: string }).stdout)
  }
}

export function listDir(root: string, rel: string): Entry[] {
  const abs = safe(root, rel)
  if (!abs || !existsSync(abs)) return []
  let names: string[]
  try {
    names = readdirSync(abs)
  } catch {
    return []
  }
  const out: Entry[] = []
  for (const n of names) {
    if (IGNORE.has(n)) continue
    let dir = false
    try {
      dir = statSync(join(abs, n)).isDirectory()
    } catch {
      continue
    }
    out.push({ name: n, path: rel ? join(rel, n) : n, dir })
  }
  const ignored = gitIgnored(
    root,
    out.map((e) => e.path),
  )
  for (const e of out) if (ignored.has(e.path)) e.ignored = true
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

export type ReadResult = { ok: boolean; content: string; reason?: string }
export function readFile(root: string, rel: string): ReadResult {
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
    return { ok: false, content: '', reason: String((e as Error).message) }
  }
}

export function writeFile(root: string, rel: string, content: string): boolean {
  const abs = safe(root, rel)
  if (!abs) return false
  try {
    writeFileSync(abs, content)
    return true
  } catch {
    return false
  }
}

export function createEntry(root: string, rel: string, dir: boolean): boolean {
  const abs = safe(root, rel)
  if (!abs || existsSync(abs)) return false
  try {
    if (dir) mkdirSync(abs, { recursive: true })
    else {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, '')
    }
    return true
  } catch {
    return false
  }
}

export function renameEntry(root: string, from: string, to: string): boolean {
  const a = safe(root, from)
  const b = safe(root, to)
  if (!a || !b || !existsSync(a) || existsSync(b)) return false
  try {
    mkdirSync(dirname(b), { recursive: true })
    renameSync(a, b)
    return true
  } catch {
    return false
  }
}

export function removeEntry(root: string, rel: string): boolean {
  const abs = safe(root, rel)
  if (!abs || abs === resolve(root) || !existsSync(abs)) return false
  try {
    rmSync(abs, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export type SearchHit = { file: string; line: number; text: string }
const MAX_HITS = 300
export function searchRepo(root: string, query: string): Promise<SearchHit[]> {
  return new Promise((res) => {
    const q = query.trim()
    if (q.length < 2) return res([]) // 1-char queries match everything — skip
    const parse = (out: string): SearchHit[] =>
      out
        .split('\n')
        .filter(Boolean)
        .slice(0, MAX_HITS)
        .map((l) => {
          const m = l.match(/^(.*?):(\d+):(.*)$/)
          return m ? { file: m[1], line: Number(m[2]), text: m[3].slice(0, 240) } : null
        })
        .filter((x): x is SearchHit => !!x)
    // git grep first (respects .gitignore, fast). `-F` = fixed string (literal,
    // no regex surprises from special chars); `-m 30` caps matches per file so a
    // common term can't flood the buffer. Falls back to plain grep outside a repo.
    execFile(
      'git',
      [
        '-C',
        root,
        'grep',
        '-n',
        '-I',
        '--no-color',
        '--untracked',
        '-F',
        '-i',
        '-m',
        '30',
        '-e',
        q,
      ],
      { timeout: 8_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (gerr, gout) => {
        if (gout) return res(parse(gout))
        // git grep exit 1 = no matches (in a repo). If git failed entirely
        // (not a repo), try plain grep.
        if (gerr && (gerr as { code?: number }).code !== 1) {
          execFile(
            'grep',
            [
              '-rnI',
              '-F',
              '-i',
              '-m',
              '30',
              '--exclude-dir=.git',
              '--exclude-dir=node_modules',
              q,
              root,
            ],
            { timeout: 8_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
            (_e, out) => res(out ? parse(out.replaceAll(root + sep, '')) : []),
          )
          return
        }
        res([])
      },
    )
  })
}
