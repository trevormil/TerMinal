import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateKnowledge, writeKnowledge } from './knowledge'
import { writeNotes } from './notes'
import { scanLocalNotes } from './note-scan'

test('scans saved repo, scratch, and path notes without including a neighboring repo', () => {
  const repo = mkdtempSync(join(tmpdir(), 'note-scan-'))
  const neighbor = mkdtempSync(join(tmpdir(), 'note-scan-'))
  try {
    writeNotes('repo', 'TER-45 scratch', repo)
    writeKnowledge(
      'repo',
      repo,
      migrateKnowledge({ items: [{ id: 'one', title: 'Repo note', content: 'TER-45 knowledge' }] }),
    )
    writeKnowledge(
      { path: 'src/file.ts', repoRoot: repo },
      repo,
      migrateKnowledge({
        items: [{ id: 'path-note', title: 'src/file.ts', content: 'TER-45 path' }],
      }),
    )
    writeNotes('repo', 'NEIGHBOR', neighbor)
    const notes = scanLocalNotes(repo).filter((note) => note.scope === 'repo')
    expect(notes).toHaveLength(3)
    expect(notes.map((note) => note.view).sort()).toEqual(['knowledge', 'path', 'scratch'])
    expect(notes.find((note) => note.view === 'path')?.path).toBe('src/file.ts')
    expect(notes.some((note) => note.content.includes('NEIGHBOR'))).toBe(false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(neighbor, { recursive: true, force: true })
  }
})
