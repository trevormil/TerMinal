// AgentView IPC (ticket 0122 index.ts decomposition) — the per-session
// observability reads behind the AgentView tab.
//
// Remote sessions get an explicitly EMPTY snapshot rather than local data:
// remote observability indexing is not wired yet, and showing the Mac's numbers
// under a host's session would read as that host's spend.

import { handle } from '../typed-ipc'
import {
  readObservabilitySnapshot,
  readObservabilitySessionDetail,
  readObservabilityToolCallPayload,
  readObservabilityTranscriptWindow,
} from '../data'
import { type RemoteSessionRef } from '../remote'

export function registerAgentViewIpc(deps: { curRemote(): RemoteSessionRef | undefined }): void {
  handle('agentview:snapshot', (_e, limit: number = 120) =>
    deps.curRemote()
      ? {
          ts: Date.now(),
          sessions: [],
          totals: {
            sessions: 0,
            readySessions: 0,
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            toolCalls: 0,
          },
          byEngine: {},
          byRepo: {},
          topTools: [],
        }
      : readObservabilitySnapshot(limit),
  )
  handle('agentview:session', (_e, sessionId: string) =>
    deps.curRemote() ? null : readObservabilitySessionDetail(sessionId),
  )
  handle('agentview:tool-call', (_e, sessionId: string, callId: string) =>
    deps.curRemote() ? null : readObservabilityToolCallPayload(sessionId, callId),
  )
  handle(
    'agentview:transcript-window',
    (_e, sessionId: string, centerLine: number = 0, radius: number = 24) =>
      deps.curRemote() ? null : readObservabilityTranscriptWindow(sessionId, centerLine, radius),
  )
}
