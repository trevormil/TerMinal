import { describe, expect, test } from 'bun:test'
import {
  contentBlocks,
  isTextBlock,
  isToolUseBlock,
  messageOf,
  parseLine,
  sidecarOf,
  textOf,
  timestampMs,
  toolFailed,
  usageTotals,
} from './transcript-schema'

// Ticket 91. These guards replace 47 `any` casts in data.ts. The reason that
// matters: `(block as any).text` compiles whether or not `text` exists, so the
// old code was correct only while everyone remembered the format — and it
// failed at RUNTIME, on a user's real transcript, as an empty pane rather than
// an error anyone could act on.
//
// The shapes here are taken from real Claude Code and Codex transcripts.

describe('content blocks (ticket 91)', () => {
  test('a string content becomes one text block', () => {
    // `message.content` is a string on some messages and an array on others.
    // Code that assumed one shape silently produced '' for the other, which
    // renders as "the agent said nothing".
    expect(contentBlocks('hello')).toEqual([{ type: 'text', text: 'hello' }])
    expect(contentBlocks('')).toEqual([])
  })

  test('unknown block types are dropped, not passed through half-typed', () => {
    const blocks = contentBlocks([
      { type: 'text', text: 'a' },
      { type: 'image', source: {} },
      { type: 'tool_use', name: 'Bash' },
    ])
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_use'])
  })

  test('a text block WITHOUT a string text is not a text block', () => {
    // The exact case `(b as any).text` got wrong: it type-checks, then yields
    // `undefined` and concatenates as "undefined" into the transcript.
    expect(isTextBlock({ type: 'text' })).toBe(false)
    expect(isTextBlock({ type: 'text', text: 42 })).toBe(false)
    expect(isTextBlock({ type: 'text', text: '' })).toBe(true)
  })

  test('non-arrays and junk yield nothing rather than throwing', () => {
    for (const v of [null, undefined, 42, {}, [null, 'x', 7]]) {
      expect(Array.isArray(contentBlocks(v))).toBe(true)
    }
  })

  test('textOf ignores tool traffic', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      { type: 'thinking', thinking: 'hidden reasoning' },
      { type: 'text', text: 'second' },
    ]
    expect(textOf(content, '\n')).toBe('first\nsecond')
  })

  test('isToolUseBlock does not require a name', () => {
    // Real transcripts have streamed tool_use blocks whose name arrives later.
    expect(isToolUseBlock({ type: 'tool_use' })).toBe(true)
  })
})

describe('usage totals (ticket 91)', () => {
  test('input counts fresh tokens PLUS cache creation', () => {
    // Cache-creation tokens occupy the context window and are billed. Omitting
    // them under-reports the context percentage the cockpit shows.
    expect(
      usageTotals({
        input_tokens: 100,
        cache_creation_input_tokens: 40,
        cache_read_input_tokens: 900,
        output_tokens: 25,
      }),
    ).toEqual({ input: 140, cacheRead: 900, output: 25 })
  })

  test('missing fields are 0, not NaN', () => {
    // `undefined + 0` is NaN, and NaN propagates into the percentage silently.
    expect(usageTotals({})).toEqual({ input: 0, cacheRead: 0, output: 0 })
    expect(usageTotals(undefined)).toEqual({ input: 0, cacheRead: 0, output: 0 })
  })

  test('non-numeric values are ignored rather than coerced', () => {
    expect(usageTotals({ input_tokens: '100' })).toEqual({ input: 0, cacheRead: 0, output: 0 })
  })
})

describe('tool failure needs BOTH signals (ticket 91)', () => {
  test('the block s own is_error', () => {
    expect(toolFailed({ type: 'tool_result', is_error: true }, undefined)).toBe(true)
  })

  test("Claude's toolUseResult envelope", () => {
    // The signal the block does NOT carry. Checking only is_error marks real
    // failures as successes in the run log.
    expect(toolFailed({ type: 'tool_result' }, { success: false })).toBe(true)
  })

  test('success is success', () => {
    expect(toolFailed({ type: 'tool_result' }, { success: true })).toBe(false)
    expect(toolFailed({ type: 'tool_result' }, undefined)).toBe(false)
  })

  test('a MISSING success field is not a failure', () => {
    // `!result.success` would call every envelope without the field an error.
    expect(toolFailed({ type: 'tool_result' }, {})).toBe(false)
  })
})

describe("TerMinal's own sidecar lines (ticket 91)", () => {
  test('each carries its payload', () => {
    expect(sidecarOf({ type: 'ai-title', aiTitle: 'Add rate limiting' })).toEqual({
      type: 'ai-title',
      aiTitle: 'Add rate limiting',
    })
    expect(sidecarOf({ type: 'last-prompt', lastPrompt: 'go' })?.type).toBe('last-prompt')
    expect(sidecarOf({ type: 'permission-mode', permissionMode: 'auto' })?.type).toBe(
      'permission-mode',
    )
  })

  test('the marker without its payload is not a sidecar line', () => {
    // Otherwise the reader overwrites a good title with undefined.
    expect(sidecarOf({ type: 'ai-title' })).toBeUndefined()
    expect(sidecarOf({ type: 'ai-title', aiTitle: 42 })).toBeUndefined()
  })

  test('a Claude line is not mistaken for one', () => {
    expect(sidecarOf({ type: 'assistant', message: {} })).toBeUndefined()
  })
})

describe('parseLine tolerates a live transcript (ticket 91)', () => {
  test('a truncated final line is undefined, not a throw', () => {
    // Transcripts are read WHILE the agent is still writing them, so this is
    // the normal case — not an exception. A throw here loses the whole read.
    expect(parseLine('{"type":"assist')).toBeUndefined()
  })

  test('blank lines and non-objects are skipped', () => {
    for (const l of ['', '   ', '\n', '[1,2]', '"a string"', '42', 'null']) {
      expect(parseLine(l)).toBeUndefined()
    }
  })

  test('a real line parses', () => {
    const line = parseLine('{"type":"assistant","message":{"role":"assistant"}}')
    expect(messageOf(line)?.role).toBe('assistant')
  })

  test('messageOf on a line with no message is undefined', () => {
    expect(messageOf({ type: 'assistant' })).toBeUndefined()
    expect(messageOf({ type: 'assistant', message: 'oops' })).toBeUndefined()
    expect(messageOf(null)).toBeUndefined()
  })
})

describe('timestamps come in both forms (ticket 91)', () => {
  test('ISO strings and epoch numbers both work', () => {
    expect(timestampMs('2026-08-01T12:00:00.000Z')).toBe(Date.parse('2026-08-01T12:00:00.000Z'))
    expect(timestampMs(1785582728860)).toBe(1785582728860)
  })

  test('junk falls back rather than producing NaN', () => {
    // NaN sorts unpredictably, so one bad line reorders the whole transcript.
    expect(timestampMs('not a date', 7)).toBe(7)
    expect(timestampMs(undefined, 7)).toBe(7)
    expect(timestampMs(NaN, 7)).toBe(7)
  })
})
