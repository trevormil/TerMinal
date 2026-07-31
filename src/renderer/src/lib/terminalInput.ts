// Pure helpers for turning dropped/pasted file paths into terminal-insertable
// text. Kept free of DOM/Electron so it's unit-testable; the Terminal component
// resolves the actual OS paths (via webUtils) and feeds them here.

// Characters that are safe to leave unescaped on a POSIX shell command line.
// Anything else gets a backslash — this matches what macOS Finder inserts when
// you drag a file into Terminal.app.
const SAFE_CHAR = /[A-Za-z0-9_./@%+=:,~-]/

export function shellEscapePath(path: string): string {
  let out = ''
  for (const ch of path) {
    // Non-ASCII (unicode filenames) are safe as-is; only ASCII metacharacters
    // and whitespace need a backslash.
    out += ch.charCodeAt(0) > 0x7f || SAFE_CHAR.test(ch) ? ch : `\\${ch}`
  }
  return out
}

// Join one or more resolved file paths into a single insertion string:
// each path shell-escaped, space-separated, with a trailing space so the
// operator can keep typing. Empty/blank paths are dropped.
export function formatDroppedPaths(paths: string[]): string {
  const escaped = paths
    .map((p) => p.trim())
    .filter(Boolean)
    .map(shellEscapePath)
  return escaped.length ? `${escaped.join(' ')} ` : ''
}

const clean = (xs?: string[]) => (xs ?? []).map((x) => x.trim()).filter(Boolean)

/** A web link is not a path — escaping would mangle its query string. */
function isWebUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^file:\/\//i.test(s)
}

/** `file:///Users/me/a%20b.txt` → `/Users/me/a b.txt`. */
function fileUriToPath(s: string): string {
  if (!/^file:\/\//i.test(s)) return s
  try {
    return decodeURIComponent(s.replace(/^file:\/\/[^/]*/i, ''))
  } catch {
    return s
  }
}

export type DroppedPaths = {
  /** Repo-relative paths from an in-app drag (the Files tree/column). */
  rel?: string[]
  /** Absolute OS paths resolved from a Finder drop's File objects. */
  abs?: string[]
  /** Raw `text/uri-list` or `text/plain` payload, when neither of the above. */
  text?: string
}

/**
 * The text a terminal drop should insert — a path, never file contents, and
 * never submitted (the caller writes it as if typed; the human hits enter).
 *
 * Source precedence encodes the relative-vs-absolute rule: an in-app drag knows
 * the workspace, so its repo-relative path wins — shorter, and what an agent
 * prompt actually wants. A Finder drop has no workspace context, so it stays
 * absolute. Multiple paths join space-separated, each shell-escaped.
 */
export function droppedPathText(src: DroppedPaths): string {
  const rel = clean(src.rel)
  if (rel.length) return formatDroppedPaths(rel)
  const abs = clean(src.abs)
  if (abs.length) return formatDroppedPaths(abs)
  // text/uri-list is newline-delimited and allows '#' comment lines.
  const lines = clean(src.text?.split(/\r?\n/)).filter((l) => !l.startsWith('#'))
  if (!lines.length) return ''
  if (lines.every(isWebUrl)) return `${lines.join(' ')} `
  return formatDroppedPaths(lines.map(fileUriToPath))
}
