import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type ProjectLayoutVersion = 'v1' | 'v2'
export type ProjectArea = 'backlog' | 'sessions' | 'reviews' | 'checks' | 'reports' | 'agents'

export const TERMINAL_DIR = '.TerMinal'
export const PROJECT_LAYOUT_MARKER = `${TERMINAL_DIR}/template.json`

const V1_REL: Record<ProjectArea, string> = {
  backlog: 'backlog',
  sessions: 'sessions',
  reviews: '.reviews',
  checks: '.checks',
  reports: 'reports',
  agents: '.agents',
}

const V2_REL: Record<ProjectArea, string> = {
  backlog: `${TERMINAL_DIR}/backlog`,
  sessions: `${TERMINAL_DIR}/sessions`,
  reviews: `${TERMINAL_DIR}/reviews`,
  checks: `${TERMINAL_DIR}/checks`,
  reports: `${TERMINAL_DIR}/reports`,
  // Keep root .agents as the primary runtime contract for now. Claude/Codex
  // skills reference ../../../.agents today, so moving it would break engines.
  agents: '.agents',
}

export function projectAreaRel(area: ProjectArea, version: ProjectLayoutVersion): string {
  return version === 'v2' ? V2_REL[area] : V1_REL[area]
}

export function projectAreaCandidates(area: ProjectArea): string[] {
  const rels = [V2_REL[area], V1_REL[area]]
  return rels.filter((rel, index) => rels.indexOf(rel) === index)
}

export function detectProjectLayout(repoRoot: string): ProjectLayoutVersion {
  if (!repoRoot) return 'v1'
  if (existsSync(join(repoRoot, PROJECT_LAYOUT_MARKER))) return 'v2'
  for (const area of ['backlog', 'sessions', 'reviews', 'checks', 'reports'] as ProjectArea[]) {
    if (existsSync(join(repoRoot, V2_REL[area]))) return 'v2'
  }
  return 'v1'
}

export function projectAreaPath(repoRoot: string, area: ProjectArea): string {
  return join(repoRoot, projectAreaRel(area, detectProjectLayout(repoRoot)))
}

export function existingProjectAreaPaths(repoRoot: string, area: ProjectArea): string[] {
  if (!repoRoot) return []
  return projectAreaCandidates(area)
    .map((rel) => join(repoRoot, rel))
    .filter((p) => existsSync(p))
}

export function projectAreaPathForRead(repoRoot: string, area: ProjectArea): string {
  const existing = existingProjectAreaPaths(repoRoot, area)
  return existing[0] || projectAreaPath(repoRoot, area)
}

export function projectAreaPathForWrite(repoRoot: string, area: ProjectArea): string {
  const existing = existingProjectAreaPaths(repoRoot, area)
  return existing[0] || projectAreaPath(repoRoot, area)
}

export function projectAreaRelForPath(repoRoot: string, area: ProjectArea, path: string): string {
  for (const rel of projectAreaCandidates(area)) {
    if (path === join(repoRoot, rel)) return rel
  }
  return projectAreaRel(area, detectProjectLayout(repoRoot))
}

export function ensureProjectArea(repoRoot: string, area: ProjectArea): string {
  const dir = projectAreaPathForWrite(repoRoot, area)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function hasProjectArea(repoRoot: string, area: ProjectArea): boolean {
  return existingProjectAreaPaths(repoRoot, area).length > 0
}
