import { test, expect, describe } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readLineWindow } from './data'

// Reference: the old whole-file readFileSync + split('\n') + slice behavior.
// readLineWindow must reproduce it exactly (line numbers, totals, bounds) while
// only holding O(radius) lines in memory.
function reference(raw: string, centerLine: number, radius: number) {
  const allLines = raw.split('\n')
  const totalLines = allLines.length
  const center = centerLine > 0 ? Math.min(totalLines, Math.floor(centerLine)) : totalLines
  const startLine = Math.max(1, center - radius)
  const endLine = Math.min(totalLines, center + radius)
  const windowLines: { line: number; text: string }[] = []
  for (let n = startLine; n <= endLine; n++) windowLines.push({ line: n, text: allLines[n - 1] ?? '' })
  return { windowLines, startLine, endLine, totalLines }
}

describe('readLineWindow matches whole-file split semantics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'terminal-lw-'))
  const run = (raw: string, center: number, radius: number) => {
    const f = join(dir, `t-${Math.abs(hash(raw + center + radius))}.jsonl`)
    writeFileSync(f, raw)
    return readLineWindow(f, center, radius)
  }
  const hash = (s: string) => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return h
  }

  const bodies: Record<string, string> = {
    'trailing newline': Array.from({ length: 50 }, (_, i) => `{"i":${i}}`).join('\n') + '\n',
    'no trailing newline': Array.from({ length: 50 }, (_, i) => `{"i":${i}}`).join('\n'),
    'single line': '{"only":1}',
    empty: '',
    'blank lines interleaved': 'a\n\n\nb\n\nc\n',
  }

  for (const [name, raw] of Object.entries(bodies)) {
    for (const center of [0, 1, 10, 25, 49, 60]) {
      for (const radius of [4, 24]) {
        test(`${name} · center=${center} · radius=${radius}`, () => {
          expect(run(raw, center, radius)).toEqual(reference(raw, center, radius))
        })
      }
    }
  }

  test('cleanup', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
