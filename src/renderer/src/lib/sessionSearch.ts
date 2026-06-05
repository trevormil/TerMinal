import type { SessionMeta } from './types'

const clean = (value: string) => value.trim().toLowerCase()

export function sessionMatchesQuery(session: SessionMeta, query: string): boolean {
  const q = clean(query)
  if (!q) return true
  return [
    session.firstUserText,
    session.cwd,
    session.gitBranch,
    session.model,
    session.engine,
    session.id,
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(q))
}

export function sessionUnderDir(sessionCwd: string, dir: string): boolean {
  const base = dir.replace(/\/$/, '')
  return !base || sessionCwd === base || sessionCwd.startsWith(`${base}/`)
}

export function filterSessionMetas(
  sessions: SessionMeta[],
  opts: { query?: string; filterDir?: string },
): SessionMeta[] {
  return sessions.filter(
    (session) =>
      sessionUnderDir(session.cwd, opts.filterDir || '') &&
      sessionMatchesQuery(session, opts.query || ''),
  )
}
