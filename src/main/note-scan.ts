import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readKnowledge, migrateKnowledge } from './knowledge'
import { readNotes } from './notes'
import { repoStatePathForRead } from './repo-state'
import { normalizeKnowledgePath } from '../shared/knowledge-path'
import type { LocalNote } from '../shared/types/knowledge'

export function scanLocalNotes(repoRoot: string): LocalNote[] {
  const notes: LocalNote[] = []
  for (const scope of ['repo', 'global'] as const) {
    if (scope === 'repo' && !repoRoot) continue
    notes.push({
      title: `${scope} scratch`,
      content: readNotes(scope, repoRoot),
      scope,
      view: 'scratch',
    })
    for (const item of readKnowledge(scope, repoRoot).items) {
      notes.push({
        title: item.title,
        content: [item.title, item.description, item.content].filter(Boolean).join('\n'),
        scope,
        view: 'knowledge',
        itemId: item.id,
        categoryId: item.categoryId,
      })
    }
  }
  if (!repoRoot) return notes
  const dir = repoStatePathForRead(repoRoot, 'path-notes')
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notes
    throw error
  }
  for (const file of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
    const kb = migrateKnowledge(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    const item = kb.items.find((item) => item.id === 'path-note')
    const path = item && normalizeKnowledgePath(item.title)
    if (item && path)
      notes.push({ title: path, content: item.content || '', scope: 'repo', view: 'path', path })
  }
  return notes
}
