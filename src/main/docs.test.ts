import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDocs, readDoc } from './docs'
import { clearRepoStateCache, repoStateRoot } from './repo-state'

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
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
      rmSync(repoStateRoot(root), { recursive: true, force: true })
    }
    clearRepoStateCache()
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

  test('v2 reports and checks surface under CANONICAL area paths, readable via readDoc', () => {
    const root = repo()
    write(root, '.TerMinal/reports/health/today.md', '# Health\n')
    write(root, '.TerMinal/checks/dead-code/today.md', '# Dead code\n')

    // Paths are area-relative aliases regardless of which layout (v1/v2/
    // sidecar) the file lives in — the UI shows one stable shape and readDoc
    // resolves it through the same area candidates.
    const reports = listDocs(root).categories.find((c) => c.id === 'reports')?.items ?? []
    expect(reports).toMatchObject([
      { path: 'checks/dead-code/today.md', category: 'reports', subgroup: 'dead-code' },
      { path: 'reports/health/today.md', category: 'reports', subgroup: 'health' },
    ])
    expect(readDoc(root, 'reports/health/today.md')).toBe('# Health\n')
    expect(readDoc(root, 'checks/dead-code/today.md')).toBe('# Dead code\n')
  })

  test('SIDECAR reports categorize + read like in-repo ones (not "other"/unreadable)', () => {
    const root = repo()
    const sidecarReports = join(repoStateRoot(root), 'reports', 'health')
    mkdirSync(sidecarReports, { recursive: true })
    writeFileSync(join(sidecarReports, 'today.md'), '# Sidecar health\n')

    const tree = listDocs(root)
    const reports = tree.categories.find((c) => c.id === 'reports')?.items ?? []
    expect(reports).toMatchObject([
      { path: 'reports/health/today.md', category: 'reports', subgroup: 'health' },
    ])
    expect(tree.categories.find((c) => c.id === 'other')?.items ?? []).toEqual([])
    expect(readDoc(root, 'reports/health/today.md')).toBe('# Sidecar health\n')
    // Traversal through the alias stays fenced.
    expect(readDoc(root, 'reports/../../../etc/passwd.md')).toBe('')
  })

  test('a sidecar copy shadows the legacy in-repo copy of the SAME report (no duplicates)', () => {
    const root = repo()
    write(root, '.TerMinal/reports/health/today.md', '# Legacy\n')
    const sidecarReports = join(repoStateRoot(root), 'reports', 'health')
    mkdirSync(sidecarReports, { recursive: true })
    writeFileSync(join(sidecarReports, 'today.md'), '# Sidecar\n')

    const reports = listDocs(root).categories.find((c) => c.id === 'reports')?.items ?? []
    expect(reports.length).toBe(1)
    // Sidecar is the highest-priority read root, so its content wins.
    expect(readDoc(root, 'reports/health/today.md')).toBe('# Sidecar\n')
  })
})
