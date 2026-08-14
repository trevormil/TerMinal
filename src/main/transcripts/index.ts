// Transcript readers, one module per engine, behind a lister registry keyed on
// EngineId. Each engine's session store has its own shape (Claude's flat
// per-project JSONL, Codex's nested rollouts, Cursor's slugged project dirs,
// Hermes's SQLite table), so each module owns its own parse; this file only
// orchestrates.
import type { EngineId } from '../../shared/engines'
import type { SessionMeta } from '../../shared/types/observability'
import { listClaudeSessions } from './claude'
import { listCodexSessions } from './codex'
import { listCursorSessions } from './cursor'
import { listHermesSessions } from './hermes'

export * from './common'
export * from './claude'
export * from './codex'
export * from './cursor'
export * from './hermes'

/** Read one engine's local session store into picker metadata, newest-first
 *  ordering left to `listSessions`. */
export type SessionLister = () => SessionMeta[]

// Which engines have a resumable local session store, and how to read it.
// An engine ABSENT from this map has none, so an explicit request for it must
// return [] rather than the other engines' sessions — resuming a foreign id
// would run e.g. `opencode -s <a-claude-session-id>`.
//
// A keyed lookup rather than a ternary chain on purpose: the chain's final
// `else` doubled as both "no engine given" and "engine I don't recognise", so
// registering opencode silently opted it into the all-engines list. An engine
// that isn't listed here now defaults to none, which is the safe direction.
// prettier-ignore
export const SESSION_LISTERS: Partial<Record<EngineId, SessionLister>> = {
  claude: listClaudeSessions,
  codex: listCodexSessions,
  cursor: listCursorSessions,
  hermes: listHermesSessions,
}

/** Sessions for the entry picker. Engine-scoped calls keep startup cheap. */
export function listSessions(engine?: EngineId): SessionMeta[] {
  const out = !engine
    ? [...listClaudeSessions(), ...listCodexSessions(), ...listCursorSessions()]
    : (SESSION_LISTERS[engine]?.() ?? [])
  return out.sort((a, b) => b.mtime - a.mtime)
}
