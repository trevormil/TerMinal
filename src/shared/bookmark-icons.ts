// Bookmark icon rules, shared by the Browser tab (renderer) and the favicon
// cache (main). Both sides must agree on the cache filename, so the name is
// derived here — from a hash written in plain TS rather than node:crypto, which
// the renderer bundle does not carry.

/** What a bookmark stores about its icon. Both fields are optional: a bookmark
 *  saved before this feature existed simply has no entry. */
export type BookmarkIconEntry = {
  /** User override — one or two emoji. Wins over any favicon. */
  emoji?: string
  /** Filename inside `<config>/favicons/`, not a path and never a remote URL. */
  faviconFile?: string
}

/** Icon state for every bookmark, keyed by bookmark id. */
export type BookmarkIcons = Record<string, BookmarkIconEntry>

export type ResolvedBookmarkIcon =
  { kind: 'emoji'; emoji: string } | { kind: 'image'; src: string } | { kind: 'globe' }

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const EXTENSIONS = new Set(Object.values(EXT_BY_MIME))

/** FNV-1a, hex. Not a security boundary — it only has to spread a few hundred
 *  origins across distinct filenames, and it has to produce the same answer in
 *  the renderer and in main. */
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * The cache filename for a page's favicon, or '' when the page cannot have one.
 *
 * Keyed by ORIGIN, not by page URL: a site serves one favicon, so every page of
 * it shares a slot and a changed icon overwrites the old bytes instead of
 * growing the cache once per visited path.
 */
export function faviconCacheName(pageUrl: string, contentType: string): string {
  let origin: string
  try {
    const u = new URL(pageUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    origin = u.origin.toLowerCase()
  } catch {
    return ''
  }
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return `${hash(origin)}.${EXT_BY_MIME[mime] || 'png'}`
}

/** Whether a string is a name this module produced — the guard main applies
 *  before touching the filesystem with a renderer-supplied string. */
export function isFaviconCacheName(name: string): boolean {
  const m = /^([0-9a-f]{8,})\.([a-z]+)$/.exec(name)
  return !!m && EXTENSIONS.has(m[2])
}

/** Trim to at most two glyphs. Iterating the string (not slicing it) keeps a
 *  ZWJ sequence or a flag whole; slicing splits them into replacement squares. */
export function normalizeIconEmoji(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const glyphs = [...segment(trimmed)]
  return glyphs.slice(0, 2).join('')
}

function segment(value: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!Seg) return [...value] // code points: worst case a ZWJ sequence counts as several
  return [...new Seg(undefined, { granularity: 'grapheme' }).segment(value)].map((s) => s.segment)
}

const isEntry = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Read the persisted map defensively: it is localStorage JSON, so anything
 *  could be in there, and a bookmark set that predates icons has nothing. */
export function parseBookmarkIcons(raw: unknown): BookmarkIcons {
  if (!isEntry(raw)) return {}
  const out: BookmarkIcons = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!isEntry(value)) continue
    const entry: BookmarkIconEntry = {}
    if (typeof value.emoji === 'string' && value.emoji) entry.emoji = value.emoji
    if (typeof value.faviconFile === 'string' && isFaviconCacheName(value.faviconFile))
      entry.faviconFile = value.faviconFile
    if (entry.emoji || entry.faviconFile) out[id] = entry
  }
  return out
}

/** Apply a patch to one bookmark's icon. An empty string clears that field, and
 *  an entry left with nothing is dropped rather than kept as `{}`. */
export function setBookmarkIcon(
  icons: BookmarkIcons,
  id: string,
  patch: BookmarkIconEntry,
): BookmarkIcons {
  const merged: BookmarkIconEntry = { ...icons[id], ...patch }
  if (!merged.emoji) delete merged.emoji
  if (!merged.faviconFile) delete merged.faviconFile
  const next = { ...icons }
  if (merged.emoji || merged.faviconFile) next[id] = merged
  else delete next[id]
  return next
}

/**
 * Precedence: custom emoji → cached favicon → bundled preset logo → globe.
 *
 * `faviconSrc` is the loaded data URL for `entry.faviconFile`; a file whose
 * bytes have not arrived (or failed to read) falls through, so the row never
 * renders a blank tile.
 */
export function resolveBookmarkIcon(opts: {
  entry?: BookmarkIconEntry
  logo?: string
  faviconSrc?: string
}): ResolvedBookmarkIcon {
  const emoji = opts.entry?.emoji
  if (emoji) return { kind: 'emoji', emoji }
  if (opts.entry?.faviconFile && opts.faviconSrc) return { kind: 'image', src: opts.faviconSrc }
  if (opts.logo) return { kind: 'image', src: opts.logo }
  return { kind: 'globe' }
}
