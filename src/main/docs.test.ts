import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDocs } from './docs'

describe('listDocs', () => {
  const roots: string[] = []
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-docs-'))
    roots.push(root)
    return root
  }
  const write = (root: string, rel: string, body = '# Title\n') => {
    const file = join(root, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, body)
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test('categorizes docs/decisions as Decisions', () => {
    const root = repo()
    write(root, 'docs/decisions/0001-record.md', '# Pick SQLite\n')

    const decisions = listDocs(root).categories.find((c) => c.id === 'decisions')
    expect(decisions?.label).toBe('Decisions')
    expect(decisions?.items).toMatchObject([
      { path: 'docs/decisions/0001-record.md', title: 'Pick SQLite', category: 'decisions' },
    ])
  })

  test('keeps existing category regressions stable', () => {
    const root = repo()
    write(root, 'CHANGELOG.md', '# Changelog\n')
    write(root, 'docs/maintainer/ops.md')
    write(root, 'docs/developer/api.md')
    write(root, 'docs/personal/notes.md')
    write(root, 'reports/health/today.md')
    write(root, 'docs/runbooks/release.md')

    const tree = listDocs(root)
    const count = (id: string) => tree.categories.find((c) => c.id === id)?.items.length
    expect(count('changelog')).toBe(1)
    expect(count('maintainer')).toBe(1)
    expect(count('developer')).toBe(1)
    expect(count('personal')).toBe(1)
    expect(count('reports')).toBe(1)
    expect(count('other')).toBe(1)
  })
})
