import { describe, expect, test } from 'bun:test'
import { parseUsageFromOutput, priceFor } from './ai-runs'

// The runner scrapes usage out of a pty-captured log, so the input is real CLI
// output complete with ANSI escapes — and the result becomes a dollar figure in
// the Observability ledger.

describe('parseUsageFromOutput', () => {
  test('reads tokens out of a claude-style summary', () => {
    const out = ['work work', 'Input tokens: 12,345', 'Output tokens: 678', 'model: sonnet'].join(
      '\n',
    )
    expect(parseUsageFromOutput(out)).toEqual({
      input: 12345,
      output: 678,
      cacheRead: 0,
      model: 'sonnet',
    })
  })

  test('ANSI colour codes do not hide the numbers', () => {
    const out = '\x1b[1mInput tokens:\x1b[0m 100\n\x1b[32mOutput tokens:\x1b[0m 5\n'
    expect(parseUsageFromOutput(out)).toMatchObject({ input: 100, output: 5 })
  })

  test('the FIRST match of each field wins, so a later echo cannot overwrite it', () => {
    const out = 'Input tokens: 10\nOutput tokens: 2\nInput tokens: 999\n'
    expect(parseUsageFromOutput(out)).toMatchObject({ input: 10 })
  })

  test('a log with no usage line yields null rather than a zero-cost record', () => {
    expect(parseUsageFromOutput('all done\nno numbers here\n')).toBeNull()
  })

  test('only the tail is scanned — a usage line buried above 200 lines is not ours', () => {
    const out = ['Input tokens: 5', ...Array.from({ length: 250 }, (_, i) => `line ${i}`)].join(
      '\n',
    )
    expect(parseUsageFromOutput(out)).toBeNull()
  })
})

describe('priceFor', () => {
  test('an exact model id uses its own row', () => {
    expect(priceFor('claude-opus-4-8')).toEqual({ in: 15, out: 75, cacheRead: 1.5 })
  })

  test('a versioned id falls back to the LONGEST matching prefix', () => {
    // 'gpt-5-codex-2026-01' must not price as bare 'gpt-5' if a longer row fits.
    expect(priceFor('gpt-5-codex-2026-01')).toEqual({ in: 1.25, out: 10 })
    expect(priceFor('gpt-5-mini-preview')).toEqual({ in: 0.25, out: 2 })
  })

  test('an unknown model prices at zero rather than guessing', () => {
    expect(priceFor('some-new-model')).toEqual({ in: 0, out: 0 })
    expect(priceFor(undefined)).toEqual({ in: 0, out: 0 })
  })
})
