// Favicon cache for browser bookmarks.
//
// App chrome never hot-links a remote image: the CSP forbids it, it leaks a
// request to every bookmarked site on every render, and it leaves the sidebar
// blank offline. So the bytes are downloaded once per origin into
// `<config>/favicons/` and served back to the renderer as a data URL, the same
// way review screenshots travel (src/main/review.ts).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configPath } from './config-dir'
import { faviconCacheName, isFaviconCacheName } from '../shared/bookmark-icons'

/** Where cached icons live. Resolved at call time — never at import. */
export function faviconDir(): string {
  return configPath('favicons')
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** Just the slice of `fetch` this module uses, so tests can pass a double
 *  without restating the platform type's static members. */
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

/** An icon larger than this is a bug or an attack, not a favicon. */
const MAX_BYTES = 512_000
const TIMEOUT_MS = 6_000

/**
 * Download a page's favicon into the cache and return its filename, or '' if
 * anything at all went wrong. Failure is deliberately silent: the caller falls
 * back to the globe, and a bookmark to an offline host must not produce noise.
 */
export async function cacheFavicon(
  pageUrl: string,
  iconUrl: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<string> {
  if (!httpUrl(pageUrl) || !httpUrl(iconUrl)) return ''
  const doFetch = opts.fetchImpl || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await doFetch(iconUrl, { signal: controller.signal })
    if (!res.ok) return ''
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) return ''
    const name = faviconCacheName(pageUrl, contentType)
    if (!name) return ''
    const bytes = Buffer.from(await res.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_BYTES) return ''
    mkdirSync(faviconDir(), { recursive: true })
    // Same slot per origin, so a site that changes its icon overwrites rather
    // than accumulating. That is also why deleting a bookmark can leave a file
    // behind: the cache is keyed by origin, not by bookmark, and a stale entry
    // costs a few KB. No sweep.
    writeFileSync(join(faviconDir(), name), bytes)
    return name
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/** Read a cached icon as a data URL, or '' when the name is not one we wrote or
 *  the file is gone. The name arrives from the renderer, so it is untrusted. */
export function readFaviconDataUrl(name: string): string {
  if (!isFaviconCacheName(name)) return ''
  const mime = MIME_BY_EXT[name.split('.').pop() || '']
  if (!mime) return ''
  try {
    return `data:${mime};base64,${readFileSync(join(faviconDir(), name)).toString('base64')}`
  } catch {
    return ''
  }
}

function httpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
