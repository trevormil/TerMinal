// ---------------------------------------------------------------------------
// Re-export facade. The implementation split into focused modules:
//
//   transcripts/claude.ts   Claude Code transcript parsing + session listing
//   transcripts/codex.ts    Codex CLI rollouts
//   transcripts/cursor.ts   Cursor agent transcripts
//   transcripts/hermes.ts   Hermes's SQLite session store
//   transcripts/common.ts   shared picker + line-level helpers
//   transcripts/index.ts    the EngineId-keyed lister registry + listSessions
//   observability-readers.ts  snapshot / detail / payload / index-record readers
//
// This file keeps `./data` working as an import path. Prefer importing from the
// module that owns the symbol in new code.
// ---------------------------------------------------------------------------
export type {
  ObservabilityAgentGraph,
  ObservabilityEventKind,
  ObservabilitySession,
  ObservabilitySessionDetail,
  ObservabilitySnapshot,
  ObservabilityTimelineEvent,
  ObservabilityTokenSnapshot,
  ObservabilityToolCall,
  ObservabilityToolCallPayload,
  ObservabilityTranscriptLine,
  ObservabilityTranscriptWindow,
  ObservabilityTurn,
  SessionMeta,
  TaskItem,
  TranscriptStats,
} from '../shared/types/observability'

export {
  createTranscriptStatsAccumulator,
  findSessionFile,
  foldTranscriptStatsLines,
  isValidSessionId,
  lastAssistantMessage,
  lastAssistantText,
  lastAssistantTurn,
  parseTranscriptDetailFile,
  parseTranscriptFile,
  parseTranscriptFileIncremental,
  readSessionTasks,
  readTranscriptStats,
  resetTranscriptStatsCacheForTests,
  transcriptStatsFromAccumulator,
  type TranscriptStatsAccumulator,
  type TranscriptStatsFileParseState,
} from './transcripts/claude'

export {
  listSessions,
  parseCodexSessionFile,
  parseCursorSessionFile,
  SESSION_LISTERS,
  type SessionLister,
} from './transcripts'

export {
  parseObservabilityIndexRecordsFile,
  readLineWindow,
  readObservabilityIndexRecords,
  readObservabilitySessionDetail,
  readObservabilitySnapshot,
  readObservabilityToolCallPayload,
  readObservabilityTranscriptWindow,
  type ObservabilityFullToolPayload,
  type ObservabilityIndexEvent,
  type ObservabilityIndexRecords,
} from './observability-readers'

// The TDD reader moved to review.ts, next to the review-artifact parsing it
// wraps (ticket 91). Re-exported for existing importers.
export { readHarnessTdd, type TddInfo } from './review'
