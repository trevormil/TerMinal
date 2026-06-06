import { describe, expect, test } from 'bun:test'
import type { KnowledgeBase } from './types'
import { appendKnowledgeItem, knowledgeSlug, singleHttpUrl } from './knowledge'

const base = (): KnowledgeBase => ({
  version: 1,
  categories: [],
  items: [],
})

describe('renderer knowledge helpers', () => {
  test('singleHttpUrl accepts exactly one http(s) URL', () => {
    expect(singleHttpUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(singleHttpUrl('ftp://example.com')).toBe('')
    expect(singleHttpUrl('https://example.com extra')).toBe('')
  })

  test('knowledgeSlug falls back for punctuation-only input', () => {
    expect(knowledgeSlug('Release Notes')).toBe('release-notes')
    expect(knowledgeSlug('!!!')).toBe('item')
  })

  test('appendKnowledgeItem creates a category and unique item ids', () => {
    const first = appendKnowledgeItem(
      base(),
      { kind: 'markdown', title: 'Same title', content: 'one', tags: [] },
      { id: 'Team Notes', title: 'Team Notes', description: '' },
    )
    const second = appendKnowledgeItem(
      first,
      { kind: 'markdown', title: 'Same title', content: 'two', tags: [] },
      { id: 'Team Notes', title: 'Team Notes', description: '' },
    )
    expect(second.categories.map((c) => c.id)).toEqual(['team-notes'])
    expect(second.items.map((i) => i.id)).toEqual(['same-title-2', 'same-title'])
    expect(second.items[0].categoryId).toBe('team-notes')
  })
})
