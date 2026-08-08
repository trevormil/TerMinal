import { describe, expect, test } from 'bun:test'
import {
  createTranscriptStatsAccumulator,
  foldTranscriptStatsLines,
  parseTranscriptFileIncremental,
  transcriptStatsFromAccumulator,
  type TranscriptStats,
  type TranscriptStatsFileParseState,
} from './data'

type Tokens = {
  input: number
  cacheCreate?: number
  cacheRead?: number
  output: number
}

function jsonl(...lines: string[]): string {
  return `${lines.join('\n')}\n`
}

function userLine(text: string): string {
  return JSON.stringify({
    cwd: '/repo',
    gitBranch: 'main',
    message: { role: 'user', content: text },
  })
}

function assistantLine(id: string, tokens: Tokens, toolName?: string): string {
  const content: Record<string, unknown>[] = [{ type: 'text', text: `assistant ${id}` }]
  if (toolName) {
    content.push({
      type: 'tool_use',
      id: `tool-${id}`,
      name: toolName,
      input: { command: `echo ${id}` },
    })
  }
  return JSON.stringify({
    uuid: `uuid-${id}`,
    message: {
      id: `msg-${id}`,
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: tokens.input,
        cache_creation_input_tokens: tokens.cacheCreate || 0,
        cache_read_input_tokens: tokens.cacheRead || 0,
        output_tokens: tokens.output,
      },
      content,
    },
  })
}

function fullStats(raw: string, mtime: number): TranscriptStats {
  const accumulator = createTranscriptStatsAccumulator('session-1')
  foldTranscriptStatsLines(accumulator, raw)
  return transcriptStatsFromAccumulator(accumulator, mtime)
}

function cumulative(stats: TranscriptStats) {
  return {
    turns: stats.turns,
    totalInputTokens: stats.totalInputTokens,
    totalOutputTokens: stats.totalOutputTokens,
    estCostUsd: stats.estCostUsd,
    toolCounts: stats.toolCounts,
  }
}

describe('incremental transcript stats parsing', () => {
  test('matches full parse after appending transcript lines', () => {
    let raw = jsonl(
      userLine('first prompt'),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Initial title' }),
      assistantLine('a', { input: 10, cacheCreate: 2, cacheRead: 3, output: 4 }, 'Bash'),
    )
    const ranges: [number, number][] = []
    const readRange = (_file: string, start: number, end: number) => {
      ranges.push([start, end])
      return raw.slice(start, end)
    }

    let state: TranscriptStatsFileParseState | null = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      null,
      raw.length,
      1,
      readRange,
    )
    const firstSize = raw.length
    raw += jsonl(
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'continue' }),
      assistantLine('b', { input: 20, cacheCreate: 1, cacheRead: 5, output: 6 }, 'Read'),
    )
    state = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      state,
      raw.length,
      2,
      readRange,
    )

    expect(cumulative(state.stats)).toEqual(cumulative(fullStats(raw, 2)))
    expect(state.stats.turns).toBe(2)
    expect(state.stats.totalInputTokens).toBe(41)
    expect(state.stats.totalOutputTokens).toBe(10)
    expect(state.stats.toolCounts).toEqual({ Bash: 1, Read: 1 })
    expect(state.stats.firstUserText).toBe('first prompt')
    expect(state.stats.aiTitle).toBe('Initial title')
    expect(state.stats.lastPrompt).toBe('continue')
    expect(ranges).toEqual([
      [0, firstSize],
      [firstSize, raw.length],
    ])
  })

  test('retains and parses a JSON line split across reads', () => {
    const line = `${assistantLine('split', { input: 3, cacheRead: 1, output: 2 })}\n`
    let raw = line.slice(0, 12)
    const readRange = (_file: string, start: number, end: number) => raw.slice(start, end)

    let state: TranscriptStatsFileParseState | null = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      null,
      raw.length,
      1,
      readRange,
    )
    expect(state.stats.turns).toBe(0)
    expect(state.pending).toBe(raw)

    raw = line
    state = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      state,
      raw.length,
      2,
      readRange,
    )
    expect(state.pending).toBe('')
    expect(state.stats.turns).toBe(1)
    expect(state.stats.totalInputTokens).toBe(4)
    expect(state.stats.totalOutputTokens).toBe(2)
  })

  test('falls back to full parse when transcript size shrinks', () => {
    let raw = jsonl(
      userLine('first prompt'),
      assistantLine('a', { input: 5, cacheRead: 1, output: 2 }, 'Bash'),
      assistantLine('b', { input: 7, cacheRead: 2, output: 3 }, 'Read'),
    )
    const ranges: [number, number][] = []
    const readRange = (_file: string, start: number, end: number) => {
      ranges.push([start, end])
      return raw.slice(start, end)
    }

    let state: TranscriptStatsFileParseState | null = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      null,
      raw.length,
      1,
      readRange,
    )
    expect(state.stats.turns).toBe(2)

    raw = jsonl(userLine('first prompt'), assistantLine('a', { input: 5, cacheRead: 1, output: 2 }))
    state = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      state,
      raw.length,
      2,
      readRange,
    )

    expect(cumulative(state.stats)).toEqual(cumulative(fullStats(raw, 2)))
    expect(state.stats.turns).toBe(1)
    expect(ranges.at(-1)).toEqual([0, raw.length])
  })
})

// The cockpit's Recent Prompts widget reads stats.recentPrompts. It polls the
// LIVE (incremental) path, so an accumulator that diverges from the full parse
// shows a different history than reopening the session would.
describe('recentPrompts', () => {
  test('collects typed prompts, newest last, and skips the noise', () => {
    const raw = jsonl(
      userLine('first prompt'),
      assistantLine('a', { input: 1, output: 1 }, 'Bash'),
      JSON.stringify({
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }],
        },
      }),
      JSON.stringify({ isSidechain: true, message: { role: 'user', content: 'subagent turn' } }),
      userLine('<task-notification>done</task-notification>'),
      userLine('second prompt'),
    )
    expect(fullStats(raw, 1).recentPrompts.map((p) => p.text)).toEqual([
      'first prompt',
      'second prompt',
    ])
  })

  test('keeps only the last 10, dropping the oldest', () => {
    // Unbounded growth would ship an entire session's prompts over IPC every
    // poll — the widget only ever renders the tail.
    const raw = jsonl(...Array.from({ length: 14 }, (_, i) => userLine(`prompt ${i}`)))
    const texts = fullStats(raw, 1).recentPrompts.map((p) => p.text)
    expect(texts).toHaveLength(10)
    expect(texts[0]).toBe('prompt 4')
    expect(texts.at(-1)).toBe('prompt 13')
  })

  test('the incremental path matches the full parse across appends', () => {
    let raw = jsonl(userLine('one'), assistantLine('a', { input: 1, output: 1 }))
    const readRange = (_f: string, start: number, end: number) => raw.slice(start, end)

    let state: TranscriptStatsFileParseState | null = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      null,
      raw.length,
      1,
      readRange,
    )
    raw += jsonl(userLine('two'), userLine('three'))
    state = parseTranscriptFileIncremental(
      'session.jsonl',
      'session-1',
      state,
      raw.length,
      2,
      readRange,
    )

    expect(state.stats.recentPrompts).toEqual(fullStats(raw, 2).recentPrompts)
    expect(state.stats.recentPrompts.map((p) => p.text)).toEqual(['one', 'two', 'three'])
  })
})
