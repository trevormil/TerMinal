import { describe, expect, test } from 'bun:test'
import { parseInline } from './inline-md'

const kinds = (s: string) => parseInline(s).map((t) => t.kind)
const texts = (s: string) => parseInline(s).map((t) => t.text)

describe('parseInline', () => {
  test('plain text is a single text token', () => {
    expect(parseInline('just words')).toEqual([{ kind: 'text', text: 'just words' }])
  })

  test('recognises each inline span', () => {
    expect(kinds('`c`')).toEqual(['code'])
    expect(kinds('**b**')).toEqual(['bold'])
    expect(kinds('~~s~~')).toEqual(['strike'])
    expect(kinds('*i*')).toEqual(['italic'])
    expect(kinds('_i_')).toEqual(['italic'])
  })

  test('keeps the surrounding text in order', () => {
    expect(parseInline('a **b** c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c' },
    ])
  })

  // The bug this file exists for: the link handler closed over the loop's
  // mutable regex match, so by click time it read null and threw. Each link
  // token must carry its OWN href.
  test('every link keeps its own href', () => {
    const out = parseInline('see [one](https://a.test/1) and [two](https://b.test/2)')
    const links = out.filter((t) => t.kind === 'link')
    expect(links).toEqual([
      { kind: 'link', text: 'one', href: 'https://a.test/1' },
      { kind: 'link', text: 'two', href: 'https://b.test/2' },
    ])
  })

  test('only http(s) links are linkified', () => {
    expect(kinds('[x](javascript:alert(1))')).toEqual(['text'])
    expect(kinds('[x](file:///etc/passwd)')).toEqual(['text'])
    expect(kinds('[x](https://ok.test)')).toEqual(['link'])
  })

  test('collapses newlines so it fits one truncated row', () => {
    expect(texts('line one\n\n  line two')).toEqual(['line one line two'])
  })

  test('strips a leading heading marker', () => {
    expect(texts('## Title')).toEqual(['Title'])
    expect(parseInline('## **Title**')[0]).toEqual({ kind: 'bold', text: 'Title' })
  })

  test('a lone asterisk or underscore is left alone', () => {
    expect(kinds('2 * 3 * 4')).toEqual(['text'])
    expect(kinds('snake_case_name')).toEqual(['text'])
  })

  test('empty input yields nothing', () => {
    expect(parseInline('')).toEqual([])
  })
})
