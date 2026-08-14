// Session IPC (ticket 0122 index.ts decomposition) — the session lifecycle
// channels, the cross-session fleet snapshot, and the project-session reads.
//
// Unlike the repo-scoped registrars, this module imports src/main/session-registry
// directly rather than taking accessors: the registry IS this module's subject,
// and it is a real module, not index.ts-local state.

import { basename } from 'node:path'
import { handle } from '../typed-ipc'
import { findSessionFile, lastAssistantTurn, listSessions, readTranscriptStats } from '../data'
import { orderFleetSnapshotEntries, restoreFleetSnapshotEntryOrder } from '../fleet-snapshot'
import { repoRootOf, repoForCwd } from '../repo'
import { type Engine } from '../agents'
import {
  activeDaemon,
  activeSessionKey,
  sessions,
  setActiveSession,
  startSession,
  stopSession,
  type StartOpts,
} from '../session-registry'

export function registerSessionsIpc(): void {
  // ---- session IPC ----
  handle('sessions:list', (_e, engine?: Engine) => listSessions(engine))
  handle('session:start', (_e, key: string, opts: StartOpts) => startSession(key, opts))
  handle('session:setActive', (_e, key: string) => setActiveSession(key))
  handle('session:stop', (_e, key: string) => stopSession(key))
  // Fleet snapshot: a summary of every live session (for the cross-session
  // overview + the live status dots on the session tabs).
  function fleetSnapshot() {
    const entries = [...sessions]
    const out = []
    for (const [key, s] of orderFleetSnapshotEntries(entries, activeSessionKey())) {
      const sid = s.pinned.sessionId
      const st = readTranscriptStats(sid)
      let status: 'working' | 'idle' = 'idle'
      const f = sid ? findSessionFile(sid) : null
      if (f) {
        const t = lastAssistantTurn(f)
        if (t && !t.endTurn) status = 'working'
      }
      out.push({
        key,
        sessionId: sid,
        name:
          s.pinned.name ||
          (s.pinned.remote
            ? s.pinned.remote.label || s.pinned.remote.sshTarget
            : basename(s.pinned.cwd)) ||
          'session',
        cwd: s.pinned.cwd,
        repo: s.pinned.remote
          ? s.pinned.remote.label || s.pinned.remote.sshTarget
          : repoForCwd(s.pinned.cwd)?.path || basename(repoRootOf(s.pinned.cwd) || s.pinned.cwd),
        branch: st.gitBranch,
        model: st.model,
        status,
        contextPct: st.contextPct,
        contextTokens: st.contextTokens,
        contextLimit: st.contextLimit,
        turns: st.turns,
        aiTitle: st.aiTitle,
        lastAction: st.lastAction,
      })
    }
    return restoreFleetSnapshotEntryOrder(out, entries)
  }
  handle('fleet:list', () => fleetSnapshot())
  // ---- tabs: repo context + tickets/MRs (scoped to the session's repo) ----
  handle('sessions:project-list', () => {
    return activeDaemon().sessionsList()
  })
  handle('sessions:project-get', (_e, slug: string) => activeDaemon().sessionGet(slug))
}
