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
