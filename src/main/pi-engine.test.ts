import { describe, expect, test } from 'bun:test'
import { createAgentStreamDecoder } from './agent-stream'
import { ENGINES, modelArgs, resumeArgs, seedArgs } from '../shared/engines'
import { parseRunLog } from '../shared/run-log/parse'
import { piAdapter } from '../shared/run-log/adapters'

// Pi (https://pi.dev) as a first-class engine.
//
// Every shape asserted here was captured from `pi -p --mode json` on 0.83.0,
// NOT from the docs. The docs are wrong or silent in three places that matter:
// they omit `--session-id`, never document the usage/cost object at all, and
// describe `-r/--resume` as if it took an id (it opens an interactive picker).

// A real emitted stream. The assistant turn errored on a billing 400, which is
// itself useful: it is the exact shape a failed pi run produces, and it carries
// the usage object on the same event as a successful one.
const REAL_SESSION_LINE =
  '{"type":"session","version":3,"id":"019fbd06-368a-76a8-969e-e209f298a89d","timestamp":"2026-08-01T11:12:08.842Z","cwd":"/private/tmp/pi-probe"}'

/** The event sequence pi emits for one successful assistant turn with a tool. */
function successStream(): string[] {
  const assistant = {
    role: 'assistant',
    content: [{ type: 'text', text: 'All done.' }],
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
    stopReason: 'stop',
  }
  return [
    REAL_SESSION_LINE,
    '{"type":"agent_start"}',
    '{"type":"turn_start"}',
    JSON.stringify({
      type: 'message_start',
      message: { role: 'user', content: [{ type: 'text', text: 'Do the thing' }] },
    }),
    JSON.stringify({
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: 'Do the thing' }] },
    }),
    '{"type":"message_start","message":{"role":"assistant","content":[]}}',
    '{"type":"message_update","message":{},"assistantMessageEvent":{"type":"text_delta","delta":"All "}}',
    '{"type":"message_update","message":{},"assistantMessageEvent":{"type":"text_delta","delta":"done."}}',
    '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{"cmd":"ls"}}',
    '{"type":"tool_execution_end","toolCallId":"t1","result":"a.ts","isError":false}',
    JSON.stringify({ type: 'message_end', message: assistant }),
    JSON.stringify({ type: 'turn_end', message: assistant, toolResults: [] }),
    JSON.stringify({ type: 'agent_end', messages: [assistant], willRetry: false }),
    '{"type":"agent_settled"}',
  ]
}

describe('pi is registered as an engine', () => {
  test('the descriptor matches the real CLI', () => {
    const pi = ENGINES.pi
    expect(pi.bin.name).toBe('pi')
    expect(pi.modelFlag).toBe('--model')
    // `pi [options] [@files...] [messages...]` — the prompt is positional.
    expect(seedArgs('pi', 'hello')).toEqual(['hello'])
    // `--model <pattern>` takes provider/id, so a fixed list would go stale.
    expect(pi.allowsCustomModel).toBe(true)
    expect(modelArgs('pi', 'anthropic/claude-opus-5')).toEqual([
      '--model',
      'anthropic/claude-opus-5',
    ])
  })

  test('resume uses --session, NOT the interactive -r picker', () => {
    // `-r/--resume` prompts the human to choose a session; handing it an id and
    // walking away would hang a headless run on a TUI nobody is watching.
    expect(resumeArgs('pi', 'abc-123')).toEqual(['--session', 'abc-123'])
    expect(ENGINES.pi.baseArgs).not.toContain('--resume')
    expect(ENGINES.pi.baseArgs).not.toContain('-r')
  })
})

describe('the live stream decoder handles pi JSONL', () => {
  const decode = (lines: string[]): string => {
    const d = createAgentStreamDecoder('pi', true)
    return d.write(lines.join('\n') + '\n') + d.end()
  }

  test('an assistant turn is rendered ONCE, not once per lifecycle event', () => {
    // The whole reason pi cannot reuse the claude branch: the same message
    // object arrives on message_start, message_update, message_end, turn_end
    // AND agent_end. Reading text off each renders the turn five times.
    const out = decode(successStream())
    expect(out.split('All done.').length - 1).toBe(1)
  })

  test('streamed deltas produce the text, and the tool call is marked', () => {
    const out = decode(successStream())
    expect(out).toContain('All done.')
    expect(out).toContain('[tool] bash')
  })

  test('a turn that never streamed deltas still yields its text', () => {
    // A cached or non-streaming provider leaves the whole turn only on
    // message_end. Without the fallback the run log would be silent.
    const out = decode([
      REAL_SESSION_LINE,
      '{"type":"message_start","message":{"role":"assistant","content":[]}}',
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Instant reply' }] },
      }),
    ])
    expect(out).toContain('Instant reply')
  })

  test('usage is summed from message_end, not double-counted at agent_end', () => {
    // agent_end replays every message; summing there would report 2x the cost.
    const out = decode(successStream())
    expect(out).toContain('$0.0030')
    expect(out).toContain('120 tok')
  })

  test('a provider error surfaces instead of vanishing into a blank turn', () => {
    const out = decode([
      REAL_SESSION_LINE,
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          errorMessage: "400 You're out of extra usage.",
        },
      }),
    ])
    expect(out).toContain('out of extra usage')
  })

  test('non-JSON lines pass through rather than being dropped', () => {
    const d = createAgentStreamDecoder('pi', true)
    expect(d.write('warning: something\n')).toContain('warning: something')
  })
})

describe('the run-log adapter replays a stored pi log', () => {
  test('one assistant entry, one prompt, one resolved tool, one summary', () => {
    const entries = piAdapter(successStream())
    const kinds = entries.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'assistant').length).toBe(1)
    expect(kinds).toContain('prompt')

    const tool = entries.find((e) => e.kind === 'tool')
    expect(tool).toMatchObject({ name: 'bash', output: 'a.ts', status: 'ok' })

    const summary = entries.find((e) => e.kind === 'summary')
    expect(summary).toMatchObject({ costUsd: 0.003, tokens: 120 })
  })

  test('a failed tool is marked error, not silently ok', () => {
    const entries = piAdapter([
      '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{}}',
      '{"type":"tool_execution_end","toolCallId":"t1","result":"boom","isError":true}',
    ])
    expect(entries.find((e) => e.kind === 'tool')).toMatchObject({ status: 'error' })
  })

  test('a truncated final line is kept, not discarded', () => {
    // A killed run cuts mid-JSONL. Dropping it loses the only evidence of why.
    const entries = piAdapter([REAL_SESSION_LINE, '{"type":"message_end","mess'])
    expect(entries.some((e) => e.kind === 'text' && e.text.includes('"mess'))).toBe(true)
  })
})

describe('engine detection routes pi logs to the pi adapter', () => {
  test('a pi log is not mistaken for a claude log', () => {
    // Both emit JSONL and the claude sniff is just /^\s*\{"type":/ — so without
    // pi's more specific session-header check every pi log would render each
    // assistant turn five times over.
    const parsed = parseRunLog(successStream().join('\n'))
    expect(parsed.engine).toBe('pi')
    expect(parsed.entries.filter((e) => e.kind === 'assistant').length).toBe(1)
  })

  test('an explicit hint still wins', () => {
    expect(parseRunLog(successStream().join('\n'), 'pi').engine).toBe('pi')
  })

  test('a claude stream-json log is unaffected', () => {
    const claude = [
      '{"type":"system","subtype":"init","model":"claude-opus-5"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
    ].join('\n')
    expect(parseRunLog(claude).engine).toBe('claude')
  })
})
