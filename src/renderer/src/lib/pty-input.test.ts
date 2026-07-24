import { describe, expect, test } from 'bun:test'
import { frameInitialInput } from './pty-input'

describe('frameInitialInput', () => {
  test('single-line input passes through unframed', () => {
    expect(frameInitialInput('fix the login bug')).toBe('fix the login bug')
  })

  test('multiline input is one bracketed-paste payload', () => {
    expect(frameInitialInput('line one\nline two')).toBe('\x1b[200~line one\nline two\x1b[201~')
  })

  test('CRLF is normalized and trailing newlines are stripped', () => {
    // A trailing newline would otherwise fire an extra empty submission after
    // the caller's \r.
    expect(frameInitialInput('a\r\nb\n\n')).toBe('\x1b[200~a\nb\x1b[201~')
    expect(frameInitialInput('only one line\n')).toBe('only one line')
  })
})
