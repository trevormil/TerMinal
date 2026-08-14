// Cursor agent session reader. Cursor stores one transcript per session at
// ~/.cursor/projects/<slugged-cwd>/agent-transcripts/<id>/<id>.jsonl — the
// project directory name is the only record of the session's cwd.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { messageOf, parseLine } from '../transcript-schema'
import { newestFileStats, readPickerWindow, sessionMetaCache, textOf } from './common'
import type { SessionMeta } from '../../shared/types/observability'

const CURSOR_PROJECTS_DIR = join(homedir(), '.cursor', 'projects')

function slugToPath(slug: string): string {
  if (!slug || /^\d+$/.test(slug) || slug === 'empty-window' || slug.startsWith('var-folders-'))
    return ''
  return '/' + slug.replace(/-/g, '/')
}

export function parseCursorSessionFile(file: string): SessionMeta | null {
  const win = readPickerWindow(file)
  if (!win) return null
  let id =
    file
      .split('/')
      .pop()
      ?.replace(/\.jsonl$/, '') || ''
  const parts = file.split('/')
  const projectsIdx = parts.lastIndexOf('projects')
  const slug = projectsIdx >= 0 ? parts[projectsIdx + 1] || '' : ''
  const cwd = slugToPath(slug)
  let firstUserText = ''
  let model = 'cursor'
  let turns = 0
  for (const line of win.raw.split('\n')) {
    if (!line.trim()) continue
    const obj = parseLine(line)
    if (!obj) continue
    if (typeof obj.session_id === 'string') id = obj.session_id
    if (typeof obj.model === 'string') model = obj.model
    if (obj.role === 'user' || messageOf(obj)?.role === 'user') {
      turns++
      if (!firstUserText) {
        firstUserText = textOf(messageOf(obj)?.content ?? obj.content)
          .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')
          .replace(/<\/?user_query>/g, '')
          .trim()
          .slice(0, 140)
      }
    }
  }
  if (!id || (!cwd && !firstUserText)) return null
  return {
    id,
    engine: 'cursor',
    cwd,
    gitBranch: '',
    model,
    turns,
    firstUserText,
    mtime: win.mtime,
  }
}

export function listCursorSessions(): SessionMeta[] {
  if (!existsSync(CURSOR_PROJECTS_DIR)) return []
  const files: string[] = []
  for (const project of readdirSync(CURSOR_PROJECTS_DIR)) {
    const dir = join(CURSOR_PROJECTS_DIR, project, 'agent-transcripts')
    if (!existsSync(dir)) continue
    for (const sessionDir of readdirSync(dir)) {
      const f = join(dir, sessionDir, `${sessionDir}.jsonl`)
      if (existsSync(f)) files.push(f)
    }
  }
  return newestFileStats(files)
    .map((st) =>
      sessionMetaCache().get(st.file, st.size, st.mtimeMs, () => parseCursorSessionFile(st.file)),
    )
    .filter((s): s is SessionMeta => !!s)
}
