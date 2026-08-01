import { describe, expect, test } from 'bun:test'
import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compileQuery,
  extractSearchableText,
  searchTranscriptFile,
  searchTranscripts,
  type SessionRef,
} from './session-search'

const ROOT = mkdtempSync(join(tmpdir(), 'tm-sessearch-'))

function transcript(name: string, lines: unknown[]): string {
  const f = join(ROOT, name)
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return f
}

const userLine = (text: string, ts = '2026-07-01T10:00:00Z') => ({
  type: 'user',
  timestamp: ts,
  message: { role: 'user', content: [{ type: 'text', text }] },
})
const asstLine = (text: string, ts = '2026-07-01T10:00:05Z') => ({
  type: 'assistant',
  timestamp: ts,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})

describe('compileQuery', () => {
  test('plain text matches case-insensitively', () => {
    const m = compileQuery('Worktree')
    expect(m!('the worktree is dirty')).toBe(true)
    expect(m!('nothing here')).toBe(false)
  })

  test('/regex/ syntax compiles to a real regex', () => {
    const m = compileQuery('/wo?rktree\\d+/')
    expect(m!('wrktree42')).toBe(true)
    expect(m!('worktree')).toBe(false)
  })

  test('an invalid regex degrades to a literal search instead of throwing', () => {
    const m = compileQuery('/unclosed([/')
    expect(m).not.toBeNull()
    expect(m!('an unclosed([ bracket')).toBe(true)
  })

  test('an empty or whitespace query compiles to null — never "match everything"', () => {
    expect(compileQuery('')).toBeNull()
    expect(compileQuery('   ')).toBeNull()
  })
})

describe('extractSearchableText', () => {
  test('pulls text out of a user turn', () => {
    expect(extractSearchableText(userLine('fix the worktree bug'))).toContain(
      'fix the worktree bug',
    )
  })

  test('pulls text out of an assistant turn', () => {
    expect(extractSearchableText(asstLine('I updated agents.ts'))).toContain('I updated agents.ts')
  })

  test('includes tool input so "which session ran that command" is answerable', () => {
    const line = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'bun run release' } }],
      },
    }
    expect(extractSearchableText(line)).toContain('bun run release')
  })

  test('a plain string content body still yields its text', () => {
    expect(extractSearchableText({ message: { role: 'user', content: 'hello there' } })).toBe(
      'hello there',
    )
  })

  test('a line with no textual payload yields empty, not "[object Object]"', () => {
    expect(extractSearchableText({ type: 'system', foo: { bar: 1 } })).toBe('')
  })
})

describe('searchTranscriptFile', () => {
  const file = transcript('a.jsonl', [
    userLine('please fix the worktree bug'),
    asstLine('Looking at the worktree handling now.'),
    asstLine('Unrelated line.'),
    userLine('thanks'),
  ])

  test('returns one hit per matching line with its line number and role', async () => {
    const hits = await searchTranscriptFile(file, compileQuery('worktree')!, { maxHits: 10 })
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ line: 1, role: 'user' })
    expect(hits[1]).toMatchObject({ line: 2, role: 'assistant' })
  })

  test('the preview centres on the match rather than truncating from line start', async () => {
    const long = transcript('long.jsonl', [
      userLine('x'.repeat(400) + ' NEEDLE ' + 'y'.repeat(400)),
    ])
    const [hit] = await searchTranscriptFile(long, compileQuery('NEEDLE')!, { maxHits: 5 })
    expect(hit.preview).toContain('NEEDLE')
    expect(hit.preview.length).toBeLessThan(400)
  })

  test('stops at maxHits so one chatty session cannot flood the results', async () => {
    const many = transcript(
      'many.jsonl',
      Array.from({ length: 50 }, () => userLine('needle')),
    )
    expect(await searchTranscriptFile(many, compileQuery('needle')!, { maxHits: 3 })).toHaveLength(
      3,
    )
  })

  test('a malformed JSON line is skipped, not fatal', async () => {
    const f = join(ROOT, 'bad.jsonl')
    writeFileSync(f, `{not json\n${JSON.stringify(userLine('needle here'))}\n`)
    expect(await searchTranscriptFile(f, compileQuery('needle')!, { maxHits: 5 })).toHaveLength(1)
  })

  test('an unreadable file yields no hits instead of throwing', async () => {
    expect(await searchTranscriptFile(join(ROOT, 'nope.jsonl'), compileQuery('x')!, {})).toEqual([])
  })

  test('skips a file past maxBytes rather than loading it', async () => {
    expect(await searchTranscriptFile(file, compileQuery('worktree')!, { maxBytes: 1 })).toEqual([])
  })
})

// Matching the RAW JSON line before parsing is faster and silently wrong. These
// are the exact shapes it gets wrong; a search tool that confidently answers
// "no matches" is the worst possible failure, so every one of them must hit.
describe('no false negatives from raw-JSON matching', () => {
  const file = transcript('escapes.jsonl', [
    userLine('he said "hello world" to me'),
    userLine('please fix the thing'),
    userLine('first line\nsecond line'),
  ])

  test('finds text whose quotes are JSON-escaped in the raw line', async () => {
    const hits = await searchTranscriptFile(file, compileQuery('said "hello world"')!, {})
    expect(hits.map((h) => h.line)).toEqual([1])
  })

  test('an anchored regex matches the decoded TEXT, not a raw line starting with {', async () => {
    const hits = await searchTranscriptFile(file, compileQuery('/^please fix/')!, {})
    expect(hits.map((h) => h.line)).toEqual([2])
  })

  test('finds a query spanning a newline that JSON encodes as a \\n escape', async () => {
    const hits = await searchTranscriptFile(file, compileQuery('first line\nsecond')!, {})
    expect(hits.map((h) => h.line)).toEqual([3])
  })

  test('a \\u-escaped character is still findable as its plain form', async () => {
    const f = join(ROOT, 'unicode.jsonl')
    writeFileSync(f, '{"message":{"role":"user","content":"w\\u006Frktree trouble"}}\n')
    expect(await searchTranscriptFile(f, compileQuery('worktree')!, {})).toHaveLength(1)
  })
})

describe('searchTranscripts', () => {
  const sessions: SessionRef[] = [
    {
      id: 's1',
      engine: 'claude',
      cwd: '/repo/one',
      mtime: 200,
      file: transcript('s1.jsonl', [userLine('worktree please'), asstLine('done')]),
    },
    {
      id: 's2',
      engine: 'codex',
      cwd: '/repo/two',
      mtime: 100,
      file: transcript('s2.jsonl', [userLine('worktree again'), userLine('worktree thrice')]),
    },
    {
      id: 's3',
      engine: 'claude',
      cwd: '/repo/one',
      mtime: 50,
      file: transcript('s3.jsonl', [userLine('nothing relevant')]),
    },
  ]

  test('groups hits by session, newest session first, and omits sessions with none', async () => {
    const r = await searchTranscripts('worktree', sessions, {})
    expect(r.results.map((x) => x.sessionId)).toEqual(['s1', 's2'])
    expect(r.results[1].hits).toHaveLength(2)
    expect(r.totalHits).toBe(3)
  })

  test('an empty query returns nothing rather than every session', async () => {
    expect((await searchTranscripts('  ', sessions, {})).results).toEqual([])
  })

  test('filters by cwd so you can search only the repo you are in', async () => {
    const r = await searchTranscripts('worktree', sessions, { cwd: '/repo/two' })
    expect(r.results.map((x) => x.sessionId)).toEqual(['s2'])
  })

  test('filters by engine', async () => {
    const r = await searchTranscripts('worktree', sessions, { engine: 'claude' })
    expect(r.results.map((x) => x.sessionId)).toEqual(['s1'])
  })

  test('scanning is bounded by maxSessions and reports that it truncated', async () => {
    const r = await searchTranscripts('worktree', sessions, { maxSessions: 1 })
    expect(r.results.map((x) => x.sessionId)).toEqual(['s1'])
    expect(r.truncated).toBe(true)
  })

  test('an unbounded scan does not claim to be truncated', async () => {
    expect((await searchTranscripts('worktree', sessions, {})).truncated).toBe(false)
  })
})

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
