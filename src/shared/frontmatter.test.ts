import { describe, expect, test } from 'bun:test'
import { splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  test('splits a typical ticket header from the body', () => {
    const doc = [
      '---',
      'id: 44',
      'title: "File viewers"',
      'status: backlog',
      '---',
      '',
      '## Description',
      'body text',
    ].join('\n')
    const { frontmatter, body } = splitFrontmatter(doc)
    expect(frontmatter).toEqual([
      ['id', '44'],
      ['title', 'File viewers'], // quotes stripped for display
      ['status', 'backlog'],
    ])
    expect(body.trim().startsWith('## Description')).toBe(true)
  })

  test('collapses a block list under its key', () => {
    const doc = ['---', 'refs:', '  - src/a.ts', '  - src/b.ts', 'id: 7', '---', 'body'].join('\n')
    const { frontmatter } = splitFrontmatter(doc)
    expect(frontmatter).toContainEqual(['refs', 'src/a.ts, src/b.ts'])
    expect(frontmatter).toContainEqual(['id', '7'])
  })

  test('handles inline lists and TOML +++ fences', () => {
    expect(splitFrontmatter('---\ntags: [a, b]\n---\nx').frontmatter).toEqual([['tags', 'a, b']])
    expect(splitFrontmatter('+++\ntitle = x\nkey: v\n+++\nx').frontmatter).toEqual([['key', 'v']])
  })

  test('a document with NO frontmatter is returned untouched', () => {
    const doc = '# Heading\n\nsome text'
    expect(splitFrontmatter(doc)).toEqual({ frontmatter: [], body: doc })
  })

  test('a leading horizontal rule is not mistaken for frontmatter', () => {
    // `---` used as an <hr>, with prose after it — must not be swallowed.
    const doc = '---\n\nJust prose, no key/value pairs.\n\n---\n'
    const { frontmatter, body } = splitFrontmatter(doc)
    expect(frontmatter).toEqual([])
    expect(body).toBe(doc)
  })

  test('comments and blank lines inside the block are ignored', () => {
    const { frontmatter } = splitFrontmatter('---\n# a comment\n\nid: 1\n---\nx')
    expect(frontmatter).toEqual([['id', '1']])
  })

  test('CRLF line endings work', () => {
    expect(splitFrontmatter('---\r\nid: 2\r\n---\r\nbody').frontmatter).toEqual([['id', '2']])
  })

  test('values containing colons survive (URLs, times)', () => {
    expect(splitFrontmatter('---\nurl: https://x.test/a\n---\n').frontmatter).toEqual([
      ['url', 'https://x.test/a'],
    ])
  })
})
