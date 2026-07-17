// Structured run-log entry model — the ONE shared shape every engine adapter
// parses into and every run-output surface renders from (ticket 0020).

export type RunLogEntryStatus = 'ok' | 'error' | 'unknown'

export type RunLogStepStatus = 'running' | 'ok' | 'failed'

export type RunLogEntry =
  /** Leading `▸` header lines the runner writes (title/branch/worktree/command). */
  | { kind: 'meta'; lines: string[] }
  /** Multi-step boundary (`━━ step N/M · label ━━`), paired with its end marker. */
  | {
      kind: 'step'
      n: number
      total: number
      label: string
      exitCode?: number
      status: RunLogStepStatus
    }
  /** Engine chatter: version banner, config block, harness status lines. */
  | { kind: 'banner'; lines: string[] }
  /** The prompt / user instructions fed to the engine. */
  | { kind: 'prompt'; text: string }
  /** Assistant prose. */
  | { kind: 'assistant'; text: string }
  /** Model reasoning ("thinking") sections. */
  | { kind: 'reasoning'; text: string }
  /** A tool call, optionally paired with its result. */
  | { kind: 'tool'; name: string; input?: string; output?: string; status: RunLogEntryStatus }
  /** A shell command execution with captured output. */
  | {
      kind: 'command'
      command: string
      cwd?: string
      output?: string
      exitCode?: number
      durationMs?: number
      status: RunLogEntryStatus
    }
  /** An error surfaced by the run (spawn failure, FAILED: line, ...). */
  | { kind: 'error'; text: string }
  /** Final usage/result summary (cost, duration, tokens, closing message). */
  | { kind: 'summary'; text: string; costUsd?: number; durationMs?: number; tokens?: number }
  /** Anything unparseable — rendered as plain text, never dropped. */
  | { kind: 'text'; text: string }

export type ParsedRunLog = {
  /** Resolved engine ('' when unknown): hint > meta-header sniff > content sniff. */
  engine: string
  entries: RunLogEntry[]
  /**
   * True when the log yielded real structure (steps/messages/tools/commands/…).
   * False → surfaces should default to the raw view.
   */
  structured: boolean
}
