import { describe, expect, test } from 'bun:test'
import {
  findingsByLocation,
  formatFindingComment,
  isKnownSeverity,
  normalizeFinding,
  normalizeSeverity,
  severityRank,
} from './findings'

describe('normalizeSeverity', () => {
  test('maps the vocabularies reviewers actually write', () => {
    expect(normalizeSeverity('CRITICAL')).toBe('critical')
    expect(normalizeSeverity('blocker')).toBe('critical')
    expect(normalizeSeverity('High')).toBe('high')
    expect(normalizeSeverity('major')).toBe('high')
    expect(normalizeSeverity('med')).toBe('medium')
    expect(normalizeSeverity('minor')).toBe('low')
    expect(normalizeSeverity('nit')).toBe('info')
    expect(normalizeSeverity('suggestion')).toBe('info')
  })

  test('an ABSENT severity is "info" — the artifact asserted nothing', () => {
    expect(normalizeSeverity(undefined)).toBe('info')
    expect(normalizeSeverity('')).toBe('info')
  })

  // Silently demoting a vocabulary we don't know to "info" is backwards for a
  // gate: `warning` / `P1` / `error` would render grey and get scrolled past.
  test('an UNRECOGNIZED severity lands at "medium", not "info"', () => {
    expect(normalizeSeverity('warning')).toBe('medium')
    expect(normalizeSeverity('P1')).toBe('medium')
    expect(normalizeSeverity('error')).toBe('medium')
  })

  test('never silently escalates an unknown to critical either', () => {
    expect(normalizeSeverity('spicy')).not.toBe('critical')
  })

  test('isKnownSeverity distinguishes a mapped vocabulary from a guess', () => {
    expect(isKnownSeverity('blocker')).toBe(true)
    expect(isKnownSeverity('')).toBe(true)
    expect(isKnownSeverity('P1')).toBe(false)
  })

  test('rank orders worst-first', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('high'))
    expect(severityRank('high')).toBeLessThan(severityRank('medium'))
    expect(severityRank('medium')).toBeLessThan(severityRank('low'))
    expect(severityRank('low')).toBeLessThan(severityRank('info'))
  })
})

describe('rawSeverity', () => {
  test('an unrecognized severity is preserved verbatim for the UI to flag', () => {
    const f = normalizeFinding({ severity: 'P1', title: 'x' })
    expect(f.severity).toBe('medium')
    expect(f.rawSeverity).toBe('P1')
  })

  test('a recognized severity carries no rawSeverity noise', () => {
    expect(normalizeFinding({ severity: 'blocker', title: 'x' }).rawSeverity).toBeUndefined()
  })

  test('the posted comment admits when it mapped an unrecognized severity', () => {
    const md = formatFindingComment(normalizeFinding({ severity: 'P1', title: 'x', body: 'y' }))
    expect(md).toContain('reported as "P1"')
  })
})

describe('normalizeFinding', () => {
  test('accepts the reviewer artifact shape and keeps file/line addressable', () => {
    const f = normalizeFinding({
      id: 'F1',
      severity: 'High',
      title: 'Unvalidated input',
      body: 'The handler trusts req.body.',
      file: 'src/api/handler.ts',
      line: 42,
    })
    expect(f).toMatchObject({
      id: 'F1',
      severity: 'high',
      title: 'Unvalidated input',
      file: 'src/api/handler.ts',
      line: 42,
    })
    expect(f.body).toBe('The handler trusts req.body.')
  })

  test('falls back from body to text, and from title to the first line of the body', () => {
    const f = normalizeFinding({ text: 'Race between the two writes.\nMore detail.' })
    expect(f.body).toBe('Race between the two writes.\nMore detail.')
    expect(f.title).toBe('Race between the two writes.')
  })

  test('synthesizes an id when the artifact omits one, so posts stay idempotent-checkable', () => {
    const a = normalizeFinding({ title: 'X', file: 'a.ts', line: 1 })
    const b = normalizeFinding({ title: 'X', file: 'a.ts', line: 1 })
    expect(a.id).toBe(b.id)
    expect(normalizeFinding({ title: 'Y', file: 'a.ts', line: 1 }).id).not.toBe(a.id)
  })

  test('a non-numeric line is dropped rather than posted as line NaN', () => {
    expect(
      normalizeFinding({ title: 'x', file: 'a.ts', line: 'top' as never }).line,
    ).toBeUndefined()
  })
})

describe('findingsByLocation', () => {
  const raw = [
    { severity: 'low', title: 'nit', file: 'src/a.ts', line: 10 },
    { severity: 'critical', title: 'boom', file: 'src/a.ts', line: 10 },
    { severity: 'high', title: 'elsewhere', file: 'src/b.ts', line: 3 },
    { severity: 'high', title: 'unanchored' },
  ]

  test('groups by file:line with the worst severity first', () => {
    const m = findingsByLocation(raw)
    expect(m['src/a.ts:10'].map((f) => f.title)).toEqual(['boom', 'nit'])
    expect(m['src/b.ts:3']).toHaveLength(1)
  })

  test('findings with no file/line are not smuggled into a location bucket', () => {
    const m = findingsByLocation(raw)
    expect(Object.keys(m).sort()).toEqual(['src/a.ts:10', 'src/b.ts:3'])
  })

  test('normalizes a leading ./ or a/ b/ diff prefix so diff paths match', () => {
    const m = findingsByLocation([{ title: 'x', file: 'b/src/a.ts', line: 4 }])
    expect(Object.keys(m)).toEqual(['src/a.ts:4'])
  })
})

describe('formatFindingComment', () => {
  const f = normalizeFinding({
    id: 'F3',
    severity: 'high',
    title: 'Missing auth check',
    body: 'The route is public.',
    file: 'src/api/x.ts',
    line: 9,
  })

  test('leads with the severity and stays attributable to TerMinal, not a human', () => {
    const md = formatFindingComment(f)
    expect(md).toContain('**high**')
    expect(md).toContain('Missing auth check')
    expect(md).toContain('The route is public.')
    expect(md.toLowerCase()).toContain('terminal')
  })

  test('an inline comment omits the file:line header the API already anchors', () => {
    expect(formatFindingComment(f, { inline: true })).not.toContain('src/api/x.ts:9')
    expect(formatFindingComment(f, { inline: false })).toContain('src/api/x.ts:9')
  })

  test('carries the finding id so a re-post can be detected', () => {
    expect(formatFindingComment(f)).toContain('F3')
  })
})
