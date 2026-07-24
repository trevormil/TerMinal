import { describe, expect, test } from 'bun:test'
import { parseAnsi, parseCiLog } from './ciLogFormat'

describe('parseAnsi', () => {
  test('splits coloured segments into spans', () => {
    const spans = parseAnsi('plain \x1b[32mgreen\x1b[0m tail')
    expect(spans).toEqual([{ text: 'plain ' }, { text: 'green', fg: 'green' }, { text: ' tail' }])
  })
  test('bold + colour combine, reset clears', () => {
    const spans = parseAnsi('\x1b[1;31mERR\x1b[0mok')
    expect(spans[0]).toEqual({ text: 'ERR', fg: 'red', bold: true })
    expect(spans[1]).toEqual({ text: 'ok' })
  })
  test('plain line is a single unstyled span', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello' }])
  })
})

describe('parseCiLog', () => {
  const log = [
    '2026-07-24T16:30:19.1234567Z ##[group]Run tests',
    '2026-07-24T16:30:20.0000000Z \x1b[32mPASS\x1b[0m suite',
    '2026-07-24T16:30:21.0000000Z ##[error]1 test failed',
    '2026-07-24T16:30:22.0000000Z ##[endgroup]',
    '2026-07-24T16:30:23.0000000Z after the group',
  ].join('\n')

  test('folds ##[group] into a named section and strips timestamps', () => {
    const p = parseCiLog(log)
    expect(p.sections[0].name).toBe('Run tests')
    expect(p.sections[0].lines[0].ts).toBe('16:30:20')
    expect(p.sections[0].lines[0].spans).toEqual([
      { text: 'PASS', fg: 'green' },
      { text: ' suite' },
    ])
  })
  test('classifies error/warning lines and counts them', () => {
    const p = parseCiLog(log)
    const err = p.sections[0].lines.find((l) => l.kind === 'error')
    expect(err?.spans[0].text).toBe('1 test failed')
    expect(p.errorCount).toBe(1)
  })
  test('content after endgroup falls into an ungrouped section', () => {
    const p = parseCiLog(log)
    const last = p.sections[p.sections.length - 1]
    expect(last.name).toBe('')
    expect(last.lines[0].spans[0].text).toBe('after the group')
  })
  test('a bare log with no groups yields one ungrouped section', () => {
    const p = parseCiLog('just one line\nand another')
    expect(p.sections).toHaveLength(1)
    expect(p.sections[0].name).toBe('')
    expect(p.sections[0].lines).toHaveLength(2)
  })
})
