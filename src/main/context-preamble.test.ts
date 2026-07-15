import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  buildAgentContextPreamble,
  collectAgentContextItems,
  withAgentContextPreamble,
} from './context-preamble'

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'terminal-context-'))
}

function write(root: string, rel: string, body: string): void {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

describe('agent context preamble', () => {
  test('collects learnings, decisions, and runbooks while skipping README and INDEX', () => {
    const root = tempRepo()
    try {
      write(root, 'docs/learnings/001-build.md', '# Build Gotcha\n\nRun bun, not npm.')
      write(
        root,
        'docs/decisions/0001-daemon.md',
        '---\nid: 1\n---\n# Daemon First\n\nPrefer daemon routing.',
      )
      write(root, 'docs/runbooks/release.md', '# Release\n\nRun bun run release.')
      write(root, 'docs/learnings/README.md', '# Placeholder\n\nDo not include.')
      write(root, 'docs/decisions/INDEX.md', '# Placeholder\n\nDo not include.')

      const items = collectAgentContextItems(root)
      expect(items.map((i) => i.path)).toEqual([
        'docs/decisions/0001-daemon.md',
        'docs/learnings/001-build.md',
        'docs/runbooks/release.md',
      ])
      expect(items.some((i) => i.summary.includes('Do not include'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('empty repos and placeholder-only docs produce no preamble', () => {
    const root = tempRepo()
    try {
      write(root, 'docs/learnings/index.md', '# Index\n\nPlaceholder only.')
      expect(collectAgentContextItems(root)).toEqual([])
      expect(buildAgentContextPreamble(root)).toBe('')
      expect(withAgentContextPreamble(root, 'Do work.', true)).toBe('Do work.')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('caps output and composes ahead of the prompt only when enabled', () => {
    const root = tempRepo()
    try {
      for (let i = 0; i < 10; i++) {
        write(root, `docs/learnings/${i}.md`, `# Learning ${i}\n\n${'long summary '.repeat(40)}`)
      }
      const preamble = buildAgentContextPreamble(root, { maxItems: 10, maxBytes: 360 })
      expect(Buffer.byteLength(preamble, 'utf8')).toBeLessThanOrEqual(360)
      expect(preamble).toContain('Prior context from this repo')
      expect(withAgentContextPreamble(root, 'Do work.', false)).toBe('Do work.')
      expect(withAgentContextPreamble(root, 'Do work.', true)).toContain('Do work.')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
