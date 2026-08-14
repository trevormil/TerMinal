// Shared transcript utilities: the file-picker helpers every engine's session
// lister uses (claude.ts, codex.ts, cursor.ts, hermes.ts) plus the line-level
// text/preview helpers shared by the Claude parsers and the observability
// readers. Picker metadata is cached per transcript keyed by (size, mtime) —
// see session-meta-cache.ts. Without this every picker open re-read a large
// window of every transcript (hundreds of MB of I/O + parse per call).
import {
  existsSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createMetaCache } from '../session-meta-cache'
import { configPath } from '../config-dir'
import { isRecord, isTextBlock, textOf as schemaTextOf } from '../transcript-schema'
import type { ObservabilityEventKind, SessionMeta } from '../../shared/types/observability'

export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  if (!input) return ''
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return pick('description') || pick('command').slice(0, 60)
    case 'Edit':
    case 'Write':
    case 'Read':
      return pick('file_path').split('/').slice(-2).join('/')
    case 'Task':
      return pick('description')
    default:
      return (pick('file_path') || pick('path') || pick('query') || pick('pattern')).slice(0, 60)
  }
}

export function textOf(content: unknown): string {
  // Delegates to the shared guards (ticket 91). The ' ' separator is
  // load-bearing — this feeds session previews, where '' would run words
  // together across blocks.
  return schemaTextOf(content, ' ')
}

export function compactPreview(value: unknown, max = 900): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const compacted = text.replace(/\s+/g, ' ').trim()
  return compacted.length > max ? `${compacted.slice(0, max)}...` : compacted
}

export function resultText(content: unknown, toolUseResult?: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    let nonText = 0
    for (const block of content) {
      if (isTextBlock(block)) parts.push(block.text)
      else if (isRecord(block)) nonText++
    }
    if (nonText > 0) parts.push(`[${nonText} non-text block${nonText === 1 ? '' : 's'}]`)
    return parts.join('\n')
  }
  if (isRecord(toolUseResult) && toolUseResult.success === false) return 'command failed'
  return ''
}

export function timestampMs(obj: Record<string, unknown> | undefined, line: number): number {
  if (typeof obj?.timestamp === 'string') {
    const parsed = Date.parse(obj.timestamp)
    if (Number.isFinite(parsed)) return parsed
  }
  return line
}

export function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

export function stableJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function stringProp(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

export function toolCallKind(toolName: string): ObservabilityEventKind {
  if (toolName === 'Task' || toolName === 'Agent') return 'agent_launch'
  if (toolName === 'Skill') return 'skill_invoke'
  return 'tool_call'
}

export const SESSION_PICKER_LIMIT = 600
const PICKER_HEAD_BYTES = 256 * 1024
const PICKER_TAIL_BYTES = 128 * 1024

export function statMtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

export type FileStat = { file: string; size: number; mtimeMs: number }

export function newestFileStats(files: string[], limit = SESSION_PICKER_LIMIT): FileStat[] {
  const out: FileStat[] = []
  for (const file of files) {
    try {
      const st = statSync(file)
      if (st.mtimeMs > 0) out.push({ file, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

// Memoised, not eager: building it at import resolved the config path before
// any test could redirect it (ticket 108). The cache instance is still
// created once per process — just on first USE, by which time the seam is
// settled.
let _sessionMetaCache: ReturnType<typeof createMetaCache<SessionMeta>> | null = null
export const sessionMetaCache = (): ReturnType<typeof createMetaCache<SessionMeta>> =>
  (_sessionMetaCache ??= createMetaCache<SessionMeta>(configPath('session-meta-cache.json')))

export function readPickerWindow(file: string): { raw: string; mtime: number } | null {
  try {
    const st = statSync(file)
    const mtime = st.mtimeMs
    if (st.size <= PICKER_HEAD_BYTES + PICKER_TAIL_BYTES) {
      return { raw: readFileSync(file, 'utf8'), mtime }
    }

    const fd = openSync(file, 'r')
    try {
      const head = Buffer.alloc(PICKER_HEAD_BYTES)
      const tailLen = Math.min(PICKER_TAIL_BYTES, st.size)
      const tail = Buffer.alloc(tailLen)
      readSync(fd, head, 0, PICKER_HEAD_BYTES, 0)
      readSync(fd, tail, 0, tailLen, st.size - tailLen)
      return { raw: `${head.toString('utf8')}\n${tail.toString('utf8')}`, mtime }
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

/** Recursively collect every `.jsonl` file under `dir` (used by engines whose
 *  session store nests transcripts in per-session subdirectories). */
export function walkJsonlFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return out
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const p = join(dir, entry)
    try {
      const st = statSync(p)
      if (st.isDirectory()) walkJsonlFiles(p, out, depth + 1)
      else if (entry.endsWith('.jsonl')) out.push(p)
    } catch {
      /* skip */
    }
  }
  return out
}
