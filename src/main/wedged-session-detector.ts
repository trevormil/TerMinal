// Wedged-session detector.
//
// Scans recently-active Claude transcripts for repeated tool errors that look
// like the session is looping on the same problem. When the same normalized
// error signature recurs N times inside a sliding window, files a HITL.
//
// Cheap by design: only reads jsonl files modified in the last `freshnessMs`
// (default 30 min) and only looks at the last `tailTurns` entries (default 60).
// No LLM. Dedup marker on disk so we don't re-file for the same wedge.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileHitl } from './hitl'
import { emitActivity } from './events'

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects')
const MARKER_FILE = join(homedir(), '.config', 'TerMinal', 'wedged-sessions.json')
const FRESHNESS_MS = 30 * 60_000
const TAIL_TURNS = 60
const WINDOW_MS = 10 * 60_000
const REPEAT_FLOOR = 3
const RE_NOTIFY_MS = 6 * 60 * 60_000 // don't re-file the same (session, sig) within 6h

type ErrorTurn = { ts: number; signature: string; preview: string }

export type WedgedSession = {
  sessionId: string
  cwd: string
  signature: string
  preview: string
  repeats: number
  windowMs: number
  lastSeenAt: number
}

function readMarker(): Record<string, number> {
  try {
    const j = JSON.parse(readFileSync(MARKER_FILE, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function writeMarker(m: Record<string, number>) {
  try {
    mkdirSync(dirname(MARKER_FILE), { recursive: true })
    writeFileSync(MARKER_FILE, JSON.stringify(m, null, 2))
  } catch {
    /* best effort */
  }
}

function normalizeErrorText(s: string): { signature: string; preview: string } {
  const firstLine = (s.split('\n').find((l) => l.trim()) || '').trim()
  const cleaned = firstLine
    .replace(/\b\/[\w/.~-]+/g, '<path>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<hash>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/:\d+:\d+/g, ':<lc>')
    .replace(/:\d+\)/g, ':<l>)')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
  const signature = createHash('sha1').update(cleaned).digest('hex').slice(0, 12)
  return { signature, preview: cleaned }
}

function extractErrorTurns(file: string): ErrorTurn[] {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter((l) => l.trim())
  const tail = lines.slice(-TAIL_TURNS * 4)
  const errs: ErrorTurn[] = []
  for (const line of tail) {
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const msg = obj.message
    if (!msg || msg.role !== 'user') continue
    const content = msg.content
    if (!Array.isArray(content)) continue
    const ts = typeof obj.timestamp === 'number' ? obj.timestamp : Date.parse(obj.timestamp || '')
    for (const c of content) {
      if (c?.type !== 'tool_result') continue
      const isError = c.is_error === true
      const text =
        typeof c.content === 'string'
          ? c.content
          : Array.isArray(c.content)
            ? c.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('\n')
            : ''
      if (!text) continue
      const looksLikeError =
        isError ||
        /\b(error|exception|traceback|failed|fatal|enoent|eacces|panic|killed)\b/i.test(text.slice(0, 400))
      if (!looksLikeError) continue
      const norm = normalizeErrorText(text)
      errs.push({
        ts: Number.isFinite(ts) ? ts : Date.now(),
        signature: norm.signature,
        preview: norm.preview,
      })
    }
  }
  return errs
}

function sessionCwd(file: string): string {
  try {
    const raw = readFileSync(file, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (typeof obj.cwd === 'string') return obj.cwd
      } catch {}
    }
  } catch {}
  return ''
}

export function detectWedgedSessions(): WedgedSession[] {
  if (!existsSync(CLAUDE_PROJECTS)) return []
  const cutoff = Date.now() - FRESHNESS_MS
  const wedged: WedgedSession[] = []
  let projectDirs: string[] = []
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS)
  } catch {
    return []
  }
  for (const dir of projectDirs) {
    const p = join(CLAUDE_PROJECTS, dir)
    let files: string[] = []
    try {
      files = readdirSync(p)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const file = join(p, f)
      let mtime = 0
      try {
        mtime = statSync(file).mtimeMs
      } catch {
        continue
      }
      if (mtime < cutoff) continue
      const sessionId = f.replace(/\.jsonl$/, '')
      const errs = extractErrorTurns(file)
      if (errs.length < REPEAT_FLOOR) continue
      // Bucket by signature and find any bucket with >=REPEAT_FLOOR within WINDOW_MS
      const bySig = new Map<string, ErrorTurn[]>()
      for (const e of errs) {
        const arr = bySig.get(e.signature) || []
        arr.push(e)
        bySig.set(e.signature, arr)
      }
      for (const [sig, arr] of bySig) {
        if (arr.length < REPEAT_FLOOR) continue
        arr.sort((a, b) => a.ts - b.ts)
        // Find the first window that contains >=REPEAT_FLOOR
        for (let i = 0; i + REPEAT_FLOOR - 1 < arr.length; i++) {
          const span = arr[i + REPEAT_FLOOR - 1].ts - arr[i].ts
          if (span <= WINDOW_MS) {
            wedged.push({
              sessionId,
              cwd: sessionCwd(file),
              signature: sig,
              preview: arr[0].preview,
              repeats: arr.length,
              windowMs: arr[arr.length - 1].ts - arr[0].ts,
              lastSeenAt: arr[arr.length - 1].ts,
            })
            break
          }
        }
      }
    }
  }
  return wedged
}

export function runWedgedSessionScan(): { detected: number; filed: number } {
  const wedged = detectWedgedSessions()
  if (wedged.length === 0) return { detected: 0, filed: 0 }
  const marker = readMarker()
  const now = Date.now()
  let filed = 0
  for (const w of wedged) {
    const key = `${w.sessionId}::${w.signature}`
    const last = marker[key] || 0
    if (now - last < RE_NOTIFY_MS) continue
    fileHitl({
      source: 'wedged-detector',
      title: `Session likely wedged · same error ×${w.repeats}`,
      action: 'check the session log',
      detail:
        `session: ${w.sessionId}\n` +
        (w.cwd ? `cwd: ${w.cwd}\n` : '') +
        `repeated error: ${w.preview}\n` +
        `window: ${Math.round(w.windowMs / 1000)}s`,
      repoRoot: w.cwd || undefined,
      sessionId: w.sessionId,
    })
    emitActivity({
      kind: 'check',
      title: `Wedged session · ${w.preview.slice(0, 80)}`,
      detail: `session ${w.sessionId} · ${w.repeats}× in ${Math.round(w.windowMs / 1000)}s`,
      repoRoot: w.cwd || undefined,
      sessionId: w.sessionId,
    })
    marker[key] = now
    filed++
  }
  // Prune marker entries older than 24h to avoid unbounded growth
  for (const k of Object.keys(marker)) {
    if (now - marker[k] > 24 * 60 * 60_000) delete marker[k]
  }
  writeMarker(marker)
  return { detected: wedged.length, filed }
}
