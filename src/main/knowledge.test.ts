import { describe, expect, test } from 'bun:test'
import {
  migrateKnowledge,
  parseKnowledgePreviewHtml,
  readKnowledge,
  writeKnowledge,
} from './knowledge'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('knowledge base schema', () => {
  test('path notes round-trip separately from repo notes and neighboring paths', () => {
    const repo = mkdtempSync(join(tmpdir(), 'terminal-path-notes-'))
    try {
      const base = migrateKnowledge({ items: [{ id: 'root', title: 'Repo note' }] })
      const note = migrateKnowledge({
        items: [{ id: 'path-note', title: 'Path note', content: 'Keep this' }],
      })
      expect(writeKnowledge('repo', repo, base)).toBe(true)
      expect(writeKnowledge({ path: './src//lib/', repoRoot: repo }, repo, note)).toBe(true)
      expect(readKnowledge({ path: 'src/lib', repoRoot: repo }, repo).items[0].content).toBe(
        'Keep this',
      )
      expect(readKnowledge({ path: 'src/lib-other', repoRoot: repo }, repo).items).toEqual([])
      expect(readKnowledge('repo', repo).items[0].title).toBe('Repo note')
      expect(writeKnowledge({ path: '../escape', repoRoot: repo }, repo, note)).toBe(false)
      expect(writeKnowledge({ path: 'src', repoRoot: '/another-repo' }, repo, note)).toBe(false)
      expect(writeKnowledge({ path: 'src', repoRoot: '' }, '', note)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
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
        {
          id: 'one',
          title: 'One',
          kind: 'video',
          categoryId: 'missing',
          url: 'https://example.com',
        },
      ],
    })
    expect(kb.items[0].categoryId).toBe('playbooks')
    expect(kb.items[0].kind).toBe('video')
  })

  test('rag items preserve their local backend configuration', () => {
    const kb = migrateKnowledge({
      categories: [{ id: 'research', title: 'Research', order: 0 }],
      items: [
        {
          id: 'research-rag',
          title: 'Research RAG',
          kind: 'rag',
          categoryId: 'research',
          rag: {
            rootDir: '/tmp/research-rag',
            command: 'uvx',
            args: ['--python', '3.11', 'knowledge-rag==3.9.0'],
            category: 'research',
            hybridAlpha: 0.5,
            maxResults: 8,
          },
        },
      ],
    })
    expect(kb.items[0].kind).toBe('rag')
    expect(kb.items[0].rag).toMatchObject({
      rootDir: '/tmp/research-rag',
      command: 'uvx',
      args: ['--python', '3.11', 'knowledge-rag==3.9.0'],
      category: 'research',
      hybridAlpha: 0.5,
      maxResults: 8,
    })
  })

  test('duplicate ids are made deterministic enough to stay unique', () => {
    const kb = migrateKnowledge({
      categories: [
        { id: 'general', title: 'General' },
        { id: 'general', title: 'General' },
      ],
      items: [
        { id: 'same', title: 'A' },
        { id: 'same', title: 'B' },
      ],
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

  test('link previews tolerate reversed attribute order and shortcut icons', () => {
    const preview = parseKnowledgePreviewHtml(
      'https://example.com/docs/page',
      `
        <html>
          <head>
            <meta content="Reverse title" property="og:title" />
            <meta content="Reverse description" name="description" />
            <meta content="cards/social.png" property="og:image" />
            <link href="/favicon.ico" rel="shortcut icon" />
          </head>
        </html>
      `,
    )
    expect(preview).toMatchObject({
      ok: true,
      title: 'Reverse title',
      description: 'Reverse description',
      thumbnailUrl: 'https://example.com/docs/cards/social.png',
      faviconUrl: 'https://example.com/favicon.ico',
    })
  })
})
