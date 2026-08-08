// Which viewer a file gets, plus the pure parsing/formatting the viewers need.
//
// The Files tab syntax-highlighted everything and rendered nothing: a .md showed
// raw markdown, an image failed with "binary file", a CSV was a wall of commas,
// and a binary dumped garbage. This module decides the viewer and does the
// content transforms; the React components stay thin.
//
// Pure and dependency-free (no node/electron) so main and renderer share it —
// same rule as shared/engines.ts and shared/notifications.ts.

export type ViewerKind =
  | 'markdown'
  | 'image'
  | 'svg'
  | 'pdf'
  | 'csv'
  | 'json'
  | 'text' // the plain CodeMirror editor
  | 'binary' // hex dump — never render as text

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'])
const MARKDOWN_EXT = new Set(['md', 'mdx', 'markdown'])
const CSV_EXT = new Set(['csv', 'tsv'])
// Extensions that are definitely not text, so we can show a hex dump instead of
// failing. Deliberately conservative — anything unlisted is sniffed instead.
const BINARY_EXT = new Set([
  'zip',
  'gz',
  'tar',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'o',
  'a',
  'class',
  'wasm',
  'db',
  'sqlite',
  'sqlite3',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp3',
  'mp4',
  'wav',
  'flac',
  'ogg',
  'mov',
  'avi',
  'mkv',
  'webm',
  'pyc',
  'jar',
  'dmg',
  'iso',
  'pdf_',
])

export function extOf(path: string): string {
  const base = path.split('/').pop() || path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Which viewer to use for a path, from its extension alone. */
export function viewerKindFor(path: string): ViewerKind {
  const ext = extOf(path)
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (ext === 'svg') return 'svg'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (CSV_EXT.has(ext)) return 'csv'
  if (ext === 'json') return 'json'
  if (BINARY_EXT.has(ext)) return 'binary'
  return 'text'
}

/** Viewers whose bytes must come from the binary read path, not a utf8 string. */
export const needsBinaryRead = (kind: ViewerKind): boolean =>
  kind === 'image' || kind === 'pdf' || kind === 'binary'

/** Viewers that can also show the raw source behind a toggle. */
export const hasSourceToggle = (kind: ViewerKind): boolean =>
  kind === 'markdown' || kind === 'csv' || kind === 'svg' || kind === 'json'

/**
 * Whether clicking a file should open the EDITOR rather than the rendered
 * viewer. Every text-backed kind defaults to source — a .md must open as
 * editable markdown, not a preview (the render stays one toggle away). Only
 * kinds with no text behind them (image/pdf/binary) default to the viewer.
 */
export const defaultsToSource = (kind: ViewerKind): boolean => !needsBinaryRead(kind)

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

/** `data:` URL for an <img>/<iframe> src — the renderer can't read file:// paths. */
export function dataUrl(path: string, base64: string): string {
  return `data:${MIME[extOf(path)] || 'application/octet-stream'};base64,${base64}`
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---- delimited data (CSV / TSV) --------------------------------------------

/**
 * RFC4180-ish parser: honours quoted fields, escaped quotes (""), and newlines
 * inside quotes. Returns rows of raw cell strings — the caller decides which
 * row is a header.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  // Trailing cell/row — but don't invent a row for a trailing newline.
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export const delimiterFor = (path: string): string => (extOf(path) === 'tsv' ? '\t' : ',')

// ---- hex dump ---------------------------------------------------------------

export type HexLine = { offset: string; hex: string; ascii: string }

/**
 * Classic offset / hex / ASCII dump, 16 bytes per line. Capped so a huge binary
 * can't lock the renderer — the caller reports how much was shown.
 */
export function hexDump(bytes: Uint8Array, maxBytes = 64 * 1024): HexLine[] {
  const n = Math.min(bytes.length, maxBytes)
  const lines: HexLine[] = []
  for (let i = 0; i < n; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, n))
    const hex: string[] = []
    let ascii = ''
    for (let j = 0; j < 16; j++) {
      if (j < slice.length) {
        hex.push(slice[j].toString(16).padStart(2, '0'))
        // Printable ASCII only; everything else is a dot.
        ascii += slice[j] >= 0x20 && slice[j] <= 0x7e ? String.fromCharCode(slice[j]) : '.'
      } else {
        hex.push('  ')
      }
    }
    lines.push({
      offset: i.toString(16).padStart(8, '0'),
      // Group into two 8-byte halves, the conventional layout.
      hex: `${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}`,
      ascii,
    })
  }
  return lines
}

/** Decode a base64 payload to bytes without Buffer (renderer-safe). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
