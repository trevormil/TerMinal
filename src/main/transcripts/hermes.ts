// Hermes keeps its session history in a SQLite store (`sessions` table in
// ~/.hermes/state.db), not JSONL transcripts. Read it directly (better-sqlite3
// is already a dep) and map the local interactive sources (cli/tui) to
// SessionMeta so they show up in — and resume from — the picker. Read-only and
// fully guarded: a missing store, broken schema, or absent Hermes yields [].
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'
import type { SessionMeta } from '../../shared/types/observability'

const HERMES_DB = join(homedir(), '.hermes', 'state.db')

export function listHermesSessions(): SessionMeta[] {
  if (!existsSync(HERMES_DB)) return []
  let db: Database.Database | null = null
  try {
    db = new Database(HERMES_DB, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare(
        `SELECT id, title, display_name, model, message_count, started_at, ended_at, cwd, git_branch, git_repo_root
         FROM sessions
         WHERE archived = 0 AND source IN ('cli', 'tui')
         ORDER BY COALESCE(ended_at, started_at) DESC
         LIMIT 200`,
      )
      .all() as Record<string, unknown>[]
    return rows
      .map((r): SessionMeta | null => {
        const id = typeof r.id === 'string' ? r.id : ''
        if (!id) return null
        const at =
          typeof r.ended_at === 'number'
            ? r.ended_at
            : typeof r.started_at === 'number'
              ? r.started_at
              : 0
        const str = (v: unknown) => (typeof v === 'string' ? v : '')
        return {
          id,
          engine: 'hermes',
          cwd: str(r.cwd) || str(r.git_repo_root),
          gitBranch: str(r.git_branch),
          model: str(r.model) || 'hermes',
          turns: typeof r.message_count === 'number' ? r.message_count : 0,
          firstUserText: str(r.title) || str(r.display_name),
          mtime: at ? Math.round(at * 1000) : 0,
        }
      })
      .filter((s): s is SessionMeta => !!s)
  } catch {
    return [] // store locked/malformed or better-sqlite3 unavailable — degrade quietly
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}
