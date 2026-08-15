// Finding repos, and finding a repo's backlog.
//
// The sidecar resolver itself is the shared generated block, reached through
// src/runner/repo-state.ts — the same module the runner and the CLI use. This
// server used to carry its own hand-copy of it; the bundler inlines the module
// now, so the artifact is still self-contained without the duplication.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { areaPath, areaPathsFor, statePathForRead } from '../runner/repo-state'
import { CFG, configuredProjectsDir } from './env'

export { areaPath, areaPathsFor as areaPaths }

// Ticket-provider config (.TerMinal/tickets.json). Every ticket op resolves its
// dir through the helpers below, so list/get/file/update all agree on where a
// repo's tickets actually live.
export function readTicketConfig(root: string): Record<string, any> {
  try {
    // Personal config — sidecar first, legacy in-repo copy as fallback.
    const p = statePathForRead(root, 'tickets.json')
    if (!existsSync(p)) return {}
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Read dirs — the repo's backlog layouts. */
export function backlogReadDirs(root: string): string[] {
  return areaPathsFor(root, 'backlog')
}

/** Write dir — the repo's canonical backlog. */
export function backlogWriteDir(root: string): string {
  return areaPath(root, 'backlog')
}

// ---------------------------------------------------------------------------
// Frontmatter parser (mirrors the renderer-side parser; minimal, regex-only)
// ---------------------------------------------------------------------------
export function parseFrontmatter(md: string): { meta: Record<string, any>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: md }
  const meta: Record<string, any> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!lm) continue
    const raw = lm[2].trim()
    if (!raw) continue
    let val: any = raw
    if (raw === 'true' || raw === 'false') val = raw === 'true'
    else if (/^-?\d+(\.\d+)?$/.test(raw)) val = Number(raw)
    else if (raw.startsWith('"') && raw.endsWith('"')) val = raw.slice(1, -1)
    else if (raw.startsWith('[') && raw.endsWith(']')) {
      val = raw
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
    meta[lm[1]] = val
  }
  return { meta, body: m[2] || '' }
}

export function knownRepoRoots(): string[] {
  // Repos known to the harness: anything with a schedule, anything in
  // prs/cache.json, anything in the workspaces persisted state, anything in
  // bg-tasks.json.
  const roots = new Set<string>()
  // schedules.json
  try {
    const sf = join(CFG(), 'schedules.json')
    if (existsSync(sf)) {
      const arr = JSON.parse(readFileSync(sf, 'utf8'))
      for (const s of arr) if (s.repoRoot) roots.add(s.repoRoot)
    }
  } catch {
    /* unreadable or malformed — the other sources still apply */
  }
  // bg-tasks.json
  try {
    const bf = join(CFG(), 'bg-tasks.json')
    if (existsSync(bf)) {
      const arr = JSON.parse(readFileSync(bf, 'utf8'))
      for (const t of arr) if (t.repoRoot) roots.add(t.repoRoot)
    }
  } catch {
    /* same */
  }
  // Walk common parent dir to find any repo not yet known
  const parent = configuredProjectsDir()
  if (existsSync(parent)) {
    try {
      for (const name of readdirSync(parent)) {
        const p = join(parent, name)
        if (name.startsWith('.')) continue
        if (existsSync(join(p, '.git'))) roots.add(p)
      }
    } catch {
      /* unreadable projects dir */
    }
  }
  return [...roots]
}

export function findRepoRoot(repoArg: string | undefined): string | null {
  if (!repoArg) return null
  const target = repoArg.toLowerCase()
  for (const root of knownRepoRoots()) {
    const b = basename(root).toLowerCase()
    if (b === target || root.toLowerCase().endsWith(target)) return root
  }
  return null
}
