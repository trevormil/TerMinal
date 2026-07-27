import { test, expect, describe } from 'bun:test'
import { splitTicketBody, renderTicketLog, appendComment, type TicketComment } from './ticket-comments'

const human = (at: string, body: string): TicketComment => ({
  at,
  author: 'trevor',
  kind: 'human',
  body,
})

describe('splitTicketBody', () => {
  test('a body with no log is all prose', () => {
    const { prose, comments } = splitTicketBody('Do the thing.\n\nIt matters.\n')
    expect(prose).toBe('Do the thing.\n\nIt matters.')
    expect(comments).toEqual([])
  })

  test('parses a human comment', () => {
    const { prose, comments } = splitTicketBody(
      ['Prose here.', '', '## Log', '', '### 2026-07-27T14:02:11.000Z · trevor', 'Punting retries.', ''].join('\n'),
    )
    expect(prose).toBe('Prose here.')
    expect(comments).toEqual([
      { at: '2026-07-27T14:02:11.000Z', author: 'trevor', kind: 'human', body: 'Punting retries.' },
    ])
  })

  test('parses an agent comment with its engine/model', () => {
    const { comments } = splitTicketBody(
      ['## Log', '', '### 2026-07-27T15:40:03.000Z · agent:pr-creation (codex/gpt-5)', 'Acceptance #2 fails.', ''].join(
        '\n',
      ),
    )
    expect(comments).toEqual([
      {
        at: '2026-07-27T15:40:03.000Z',
        author: 'pr-creation',
        kind: 'agent',
        via: 'codex/gpt-5',
        body: 'Acceptance #2 fails.',
      },
    ])
  })

  test('keeps multi-line comment bodies intact and preserves order', () => {
    const { comments } = splitTicketBody(
      [
        '## Log',
        '',
        '### 2026-07-01T00:00:00.000Z · trevor',
        'line one',
        '',
        'line two',
        '',
        '### 2026-07-02T00:00:00.000Z · trevor',
        'second',
        '',
      ].join('\n'),
    )
    expect(comments.length).toBe(2)
    expect(comments[0].body).toBe('line one\n\nline two')
    expect(comments[1].body).toBe('second')
    expect(comments[0].at < comments[1].at).toBe(true)
  })

  // The delimiter must be the full header shape, or an agent pasting markdown
  // that happens to contain an h3 would silently split one comment into two.
  test('an h3 inside a comment body is not a delimiter', () => {
    const { comments } = splitTicketBody(
      ['## Log', '', '### 2026-07-01T00:00:00.000Z · trevor', 'Findings:', '', '### Root cause', 'it was DNS', ''].join(
        '\n',
      ),
    )
    expect(comments.length).toBe(1)
    expect(comments[0].body).toBe('Findings:\n\n### Root cause\nit was DNS')
  })

  test('a heading that merely starts with "## Log" is not the log marker', () => {
    const { prose, comments } = splitTicketBody('## Logging — a CLI extension\n\ndetails\n')
    expect(comments).toEqual([])
    expect(prose).toBe('## Logging — a CLI extension\n\ndetails')
  })

  test('a "## Log" inside a fenced code block is not the log marker', () => {
    const md = ['Prose.', '', '```md', '## Log', '```', ''].join('\n')
    const { prose, comments } = splitTicketBody(md)
    expect(comments).toEqual([])
    expect(prose).toBe('Prose.\n\n```md\n## Log\n```')
  })

  test('a log section with no comments yet parses as empty', () => {
    const { prose, comments } = splitTicketBody('Prose.\n\n## Log\n')
    expect(prose).toBe('Prose.')
    expect(comments).toEqual([])
  })
})

describe('appendComment', () => {
  test('creates the log section on a ticket that has none', () => {
    const out = appendComment('Prose.\n', human('2026-07-27T14:00:00.000Z', 'first note'))
    const { prose, comments } = splitTicketBody(out)
    expect(prose).toBe('Prose.')
    expect(comments.length).toBe(1)
    expect(comments[0].body).toBe('first note')
    expect(out).toContain('## Log')
  })

  test('appends after existing comments without disturbing them', () => {
    const one = appendComment('Prose.\n', human('2026-07-01T00:00:00.000Z', 'first'))
    const two = appendComment(one, human('2026-07-02T00:00:00.000Z', 'second'))
    const { prose, comments } = splitTicketBody(two)
    expect(prose).toBe('Prose.')
    expect(comments.map((c) => c.body)).toEqual(['first', 'second'])
    // Exactly one log marker, no matter how many appends.
    expect(two.match(/^## Log$/gm)?.length).toBe(1)
  })

  test('round-trips an agent comment through render and parse', () => {
    const c: TicketComment = {
      at: '2026-07-27T15:40:03.000Z',
      author: 'pr-creation',
      kind: 'agent',
      via: 'codex/gpt-5',
      body: 'done',
    }
    expect(splitTicketBody(appendComment('Prose.\n', c)).comments).toEqual([c])
  })

  test('an empty prose body still gets a well-formed log', () => {
    const { prose, comments } = splitTicketBody(
      appendComment('', human('2026-07-27T14:00:00.000Z', 'note')),
    )
    expect(prose).toBe('')
    expect(comments.length).toBe(1)
  })
})

describe('renderTicketLog', () => {
  test('no comments renders nothing', () => {
    expect(renderTicketLog([])).toBe('')
  })

  test('renders a header line per comment', () => {
    const out = renderTicketLog([
      human('2026-07-01T00:00:00.000Z', 'a'),
      { at: '2026-07-02T00:00:00.000Z', author: 'docs', kind: 'agent', via: 'claude/opus', body: 'b' },
    ])
    expect(out).toContain('### 2026-07-01T00:00:00.000Z · trevor')
    expect(out).toContain('### 2026-07-02T00:00:00.000Z · agent:docs (claude/opus)')
  })
})
