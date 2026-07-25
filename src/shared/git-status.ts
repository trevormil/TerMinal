// Per-file git status for the file tree, parsed from `git status --porcelain`.
//
// The tree previously showed only "ignored" dimming, so you couldn't see what
// an agent had actually touched without opening the diff. Decorating the tree
// is the cheapest way to answer "what changed?" at a glance — and it has to
// roll up to parent folders, or a change nested five levels deep is invisible
// while the folder is collapsed.
//
// Pure and dependency-free so it can be unit tested and shared.

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

/** path → status. Paths are repo-relative, matching what files.list() returns. */
export type StatusMap = Record<string, FileStatus>

// Order matters when rolling up: the most "urgent" status wins for a folder.
const RANK: Record<FileStatus, number> = {
  conflicted: 5,
  deleted: 4,
  added: 3,
  renamed: 2,
  modified: 1,
  untracked: 0,
}

function codeToStatus(x: string, y: string): FileStatus | null {
  // Unmerged combinations — both sides modified, or added by one side.
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'))
    return 'conflicted'
  if (x === '?' && y === '?') return 'untracked'
  // Index status wins over worktree status when both are set.
  const c = x !== ' ' && x !== '?' ? x : y
  switch (c) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    case 'T':
      return 'modified'
    default:
      return null
  }
}

/**
 * Parse `git status --porcelain` (v1) output.
 *
 * Format is `XY <path>`, with renames as `R  old -> new`. Quoted paths (git
 * quotes anything with special characters) are unquoted.
 */
export function parsePorcelain(text: string): StatusMap {
  const out: StatusMap = {}
  for (const raw of text.split('\n')) {
    if (raw.length < 4) continue
    const x = raw[0]
    const y = raw[1]
    let path = raw.slice(3)
    // Renames/copies report "old -> new"; the new path is what's on disk.
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.startsWith('"') && path.endsWith('"')) {
      try {
        path = JSON.parse(path)
      } catch {
        path = path.slice(1, -1)
      }
    }
    const status = codeToStatus(x, y)
    if (status && path) out[path] = status
  }
  return out
}

/**
 * Add an entry for every ancestor directory, so a collapsed folder still shows
 * that something inside it changed. The highest-ranked descendant status wins.
 */
export function rollUpDirs(map: StatusMap): StatusMap {
  const out: StatusMap = { ...map }
  for (const [path, status] of Object.entries(map)) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      if (!dir) continue
      const cur = out[dir]
      if (!cur || RANK[status] > RANK[cur]) out[dir] = status
    }
  }
  return out
}

/** Parse + roll up in one call — what the tree actually consumes. */
export const fileStatuses = (porcelain: string): StatusMap => rollUpDirs(parsePorcelain(porcelain))

/** Single-letter badge shown next to the name. */
export const statusBadge = (s: FileStatus): string =>
  ({ modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!' })[s]

/** Tailwind text colour per status — matches the app's status palette. */
export const statusColor = (s: FileStatus): string =>
  ({
    modified: 'text-[var(--gt-yellow)]',
    added: 'text-[var(--gt-green)]',
    deleted: 'text-[var(--gt-red)]',
    renamed: 'text-[var(--gt-accent-2)]',
    untracked: 'text-[var(--gt-green)]',
    conflicted: 'text-[var(--gt-red)]',
  })[s]
