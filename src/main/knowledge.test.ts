import { describe, expect, test } from 'bun:test'
import { migrateKnowledge, parseKnowledgePreviewHtml } from './knowledge'

describe('knowledge base schema', () => {
  test('empty input gets a default category', () => {
    const kb = migrateKnowledge(null)
    expect(kb.version).toBe(1)
    expect(kb.categories.map((c) => c.id)).toEqual(['general'])
    expect(kb.items).toEqual([])
  })

  test('items with missing categories fall back to the first category', () => {
    const kb = migrateKnowledge({
      categories: [{ id: 'playbooks', title: 'Playbooks', order: 0 }],
      items: [
        { id: 'one', title: 'One', kind: 'video', categoryId: 'missing', url: 'https://example.com' },
      ],
    })
    expect(kb.items[0].categoryId).toBe('playbooks')
    expect(kb.items[0].kind).toBe('video')
  })

  test('duplicate ids are made deterministic enough to stay unique', () => {
    const kb = migrateKnowledge({
      categories: [{ id: 'general', title: 'General' }, { id: 'general', title: 'General' }],
      items: [{ id: 'same', title: 'A' }, { id: 'same', title: 'B' }],
    })
    expect(new Set(kb.categories.map((c) => c.id)).size).toBe(kb.categories.length)
    expect(new Set(kb.items.map((i) => i.id)).size).toBe(kb.items.length)
  })

  test('link previews extract visual metadata without network calls', () => {
    const preview = parseKnowledgePreviewHtml(
      'https://example.com/docs/page',
      `
        <html>
          <head>
            <title>Fallback title</title>
            <meta property="og:title" content="Open Graph title" />
            <meta name="description" content="Short page description" />
            <meta property="og:image" content="/assets/card.png" />
            <meta property="og:site_name" content="Example Docs" />
            <link rel="icon" href="/favicon.svg" />
          </head>
        </html>
      `,
    )
    expect(preview).toMatchObject({
      ok: true,
      title: 'Open Graph title',
      description: 'Short page description',
      siteName: 'Example Docs',
      thumbnailUrl: 'https://example.com/assets/card.png',
      faviconUrl: 'https://example.com/favicon.svg',
    })
  })
})
