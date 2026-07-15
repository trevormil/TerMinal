import { describe, expect, it } from 'bun:test'
import { createAgentStreamDecoder } from './agent-stream'

describe('createAgentStreamDecoder', () => {
  it('decodes Claude stream-json assistant text and tool breadcrumbs', () => {
    const decoder = createAgentStreamDecoder('claude', true)
    const out = decoder.write(
      [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hello' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Bash' }] },
        }),
        '',
      ].join('\n'),
    )

    expect(out).toBe('hello\n[tool] Bash\n')
    expect(decoder.end()).toBe('')
  })

  it('decodes Cursor stream-json text deltas split across chunks', () => {
    const decoder = createAgentStreamDecoder('cursor', true)
    const first = JSON.stringify({ type: 'text', text: 'hel' })
    const second = JSON.stringify({ type: 'text', text: 'lo' })

    expect(decoder.write(`${first}\n${second.slice(0, 8)}`)).toBe('hel')
    expect(decoder.write(`${second.slice(8)}\n`)).toBe('lo')
  })

  it('passes through non-json mode unchanged', () => {
    const decoder = createAgentStreamDecoder('codex', false)

    expect(decoder.write('plain output\n')).toBe('plain output\n')
    expect(decoder.end()).toBe('')
  })

  it('strips codex/or-agent harness noise but keeps the transcript', () => {
    const decoder = createAgentStreamDecoder('openrouter', false)
    const out = decoder.write(
      [
        'hook: PreToolUse',
        'deprecated: `[features].codex_hooks` is deprecated.',
        'ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed',
        'Reading additional input from stdin...',
        'codex',
        'I edited add.ts and ran the tests.',
        '',
      ].join('\n'),
    )
    expect(out).toBe('codex\nI edited add.ts and ran the tests.\n')
  })
})
