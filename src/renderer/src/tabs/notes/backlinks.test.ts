import { expect, test } from 'bun:test'
import { noteBacklinks, noteNavigation } from './backlinks'
test('reverse matching shares exact identifier and slug rules', () => {
  const notes = ['#TER-37', 'TER-370', '0037-fix', 'nothing'].map((content) => ({
    title: content,
    content,
    scope: 'repo' as const,
    view: 'scratch' as const,
  }))
  expect(
    noteBacklinks(notes, { slug: '0037-fix.md', externalKey: 'TER-37' }).map((n) => n.title),
  ).toEqual(['#TER-37', '0037-fix'])
  expect(noteBacklinks(notes, { slug: 'missing' })).toEqual([])
})
test('navigation selects the exact scoped item, scratch or path', () => {
  expect(
    noteNavigation({
      title: '',
      content: '',
      scope: 'global',
      view: 'knowledge',
      itemId: 'one',
      categoryId: 'cat',
    }),
  ).toEqual({ scope: 'global', view: 'knowledge', itemId: 'one', categoryId: 'cat' })
  expect(
    noteNavigation({ title: '', content: '', scope: 'repo', view: 'path', path: 'src' }),
  ).toEqual({ path: 'src' })
  expect(noteNavigation({ title: '', content: '', scope: 'repo', view: 'scratch' })).toMatchObject({
    view: 'scratch',
    scope: 'repo',
  })
})
