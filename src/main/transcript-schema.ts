// The shapes of the agent transcript files TerMinal reads (ticket 91).
//
// `data.ts` carried 47 `any`s, and all of them were the same thing: JSONL
// arriving from another tool's writer with no type at the boundary. `any` then
// spreads — `(block as any).text` compiles whether or not `text` exists, so the
// reader is only correct as long as everyone remembers the format, and it fails
// at RUNTIME, on a user's real transcript, as an empty pane rather than an error.
//
// These are not OUR formats. Claude Code and Codex own them and can change them,
// which is exactly why the assumptions belong somewhere explicit and testable
// rather than scattered across 2,300 lines as casts.
//
// Everything here is `unknown`-in, narrowed by guards — never a cast. A cast
// asserts; a guard checks. The whole point is that a transcript line which does
// NOT match is detected rather than believed.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

// ---------------------------------------------------------------------------
// Content blocks (Claude Code `message.content[]`)
// ---------------------------------------------------------------------------

export type TextBlock = { type: 'text'; text: string }
export type ThinkingBlock = { type: 'thinking'; thinking?: string }
export type ToolUseBlock = { type: 'tool_use'; id?: string; name?: string; input?: unknown }
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

/** A text block WITH a usable string — the `text` field is what callers want. */
export function isTextBlock(v: unknown): v is TextBlock {
  return isRecord(v) && v.type === 'text' && typeof v.text === 'string'
}

export function isThinkingBlock(v: unknown): v is ThinkingBlock {
  return isRecord(v) && v.type === 'thinking'
}

export function isToolUseBlock(v: unknown): v is ToolUseBlock {
  return isRecord(v) && v.type === 'tool_use'
}

export function isToolResultBlock(v: unknown): v is ToolResultBlock {
  return isRecord(v) && v.type === 'tool_result'
}

/**
 * `message.content` is either a plain string or an array of blocks, depending
 * on the message. Callers that assumed one shape silently produced '' for the
 * other, which reads as "the agent said nothing".
 */
export function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  return content.filter(
    (b): b is ContentBlock =>
      isTextBlock(b) || isThinkingBlock(b) || isToolUseBlock(b) || isToolResultBlock(b),
  )
}

/** Concatenated text of a message's content, ignoring tool traffic. */
export function textOf(content: unknown, sep = ''): string {
  return contentBlocks(content)
    .filter(isTextBlock)
    .map((b) => b.text)
    .join(sep)
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function isUsage(v: unknown): v is Usage {
  return isRecord(v)
}

/** Context-window tokens: fresh input + cache creation, plus cache reads. */
export function usageTotals(u: unknown): { input: number; cacheRead: number; output: number } {
  if (!isRecord(u)) return { input: 0, cacheRead: 0, output: 0 }
  return {
    input: (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0),
    cacheRead: num(u.cache_read_input_tokens) ?? 0,
    output: num(u.output_tokens) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Claude Code transcript lines
// ---------------------------------------------------------------------------

export type ClaudeMessage = {
  role?: string
  model?: string
  id?: string
  content?: unknown
  usage?: unknown
}

export type ClaudeLine = {
  type?: string
  uuid?: string
  timestamp?: string | number
  cwd?: string
  gitBranch?: string
  requestId?: string
  message?: ClaudeMessage
  /** Claude's own tool-result envelope, carrying `success` for failures. */
  toolUseResult?: unknown
}

export function isClaudeLine(v: unknown): v is ClaudeLine {
  return isRecord(v)
}

export function messageOf(line: unknown): ClaudeMessage | undefined {
  if (!isRecord(line) || !isRecord(line.message)) return undefined
  return line.message as ClaudeMessage
}

/**
 * Did this tool call fail?
 *
 * Two independent signals, and BOTH are needed: the block's own `is_error`, and
 * Claude's `toolUseResult.success === false` envelope. Checking only one marks
 * real failures as successes in the run log.
 */
export function toolFailed(block: unknown, toolUseResult: unknown): boolean {
  const blockError = isRecord(block) && block.is_error === true
  const envelopeError = isRecord(toolUseResult) && toolUseResult.success === false
  return blockError || envelopeError
}

// ---------------------------------------------------------------------------
// TerMinal's own sidecar lines
// ---------------------------------------------------------------------------
//
// Written by TerMinal into the same JSONL, so the reader sees them interleaved
// with Claude's. These ARE our format, and the only ones here we control.

export type SidecarLine =
  | { type: 'ai-title'; aiTitle: string }
  | { type: 'permission-mode'; permissionMode: string }
  | { type: 'last-prompt'; lastPrompt: string }

export function sidecarOf(line: unknown): SidecarLine | undefined {
  if (!isRecord(line)) return undefined
  const t = line.type
  if (t === 'ai-title' && str(line.aiTitle))
    return { type: 'ai-title', aiTitle: line.aiTitle as string }
  if (t === 'permission-mode' && str(line.permissionMode))
    return { type: 'permission-mode', permissionMode: line.permissionMode as string }
  if (t === 'last-prompt' && str(line.lastPrompt))
    return { type: 'last-prompt', lastPrompt: line.lastPrompt as string }
  return undefined
}

// ---------------------------------------------------------------------------
// Codex transcript lines
// ---------------------------------------------------------------------------
//
// A different vocabulary for the same job. Kept separate rather than unified:
// pretending two vendors' formats are one type is how a field that only exists
// in one of them becomes optional in both and stops being checked.

export type CodexLine = {
  type?: string
  timestamp?: string | number
  payload?: unknown
  model?: string
  session_id?: string
}

export function isCodexLine(v: unknown): v is CodexLine {
  return isRecord(v)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse one JSONL line, or `undefined`.
 *
 * A truncated final line is NORMAL — transcripts are read while the agent is
 * still writing them — so a parse failure here is expected, not exceptional,
 * and must never take out the whole read.
 */
export function parseLine(line: string): Record<string, unknown> | undefined {
  const t = line.trim()
  if (!t || t[0] !== '{') return undefined
  try {
    const parsed: unknown = JSON.parse(t)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Milliseconds from a transcript timestamp — ISO string or epoch number. */
export function timestampMs(v: unknown, fallback = 0): number {
  const n = num(v)
  if (n !== undefined) return n
  const s = str(v)
  if (!s) return fallback
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : fallback
}
