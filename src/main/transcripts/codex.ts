// Codex CLI session reader. Codex writes JSONL rollouts under
// ~/.codex/sessions/<date-partitioned dirs>/rollout-<ts>-<id>.jsonl, so the
// listing walks nested directories rather than a flat per-project layout.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { isRecord, parseLine } from '../transcript-schema'
import {
  newestFileStats,
  readPickerWindow,
  sessionMetaCache,
  textOf,
  walkJsonlFiles,
} from './common'
import type { SessionMeta } from '../../shared/types/observability'

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')

export function parseCodexSessionFile(file: string): SessionMeta | null {
  const win = readPickerWindow(file)
  if (!win) return null

  let id =
    file
      .replace(/\.jsonl$/, '')
      .split('/')
      .pop() || ''
  id = id.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '')
  let cwd = ''
  let model = ''
  let firstUserText = ''
  let turns = 0

  for (const line of win.raw.split('\n')) {
    if (!line.trim()) continue
    const obj = parseLine(line)
    if (!obj) continue
    const payload = isRecord(obj.payload) ? obj.payload : {}
    if (obj.type === 'session_meta') {
      if (typeof payload.id === 'string') id = payload.id
      if (!cwd && typeof payload.cwd === 'string') cwd = payload.cwd
    } else if (obj.type === 'turn_context') {
      if (!cwd && typeof payload.cwd === 'string') cwd = payload.cwd
      if (typeof payload.model === 'string') model = payload.model
    } else if (obj.type === 'event_msg' && payload.type === 'user_message') {
      turns++
      if (!firstUserText && typeof payload.message === 'string') firstUserText = payload.message
    } else if (
      obj.type === 'response_item' &&
      payload.type === 'message' &&
      payload.role === 'user'
    ) {
      turns++
      if (!firstUserText) firstUserText = textOf(payload.content)
    }
  }

  if (!id || (!cwd && !firstUserText)) return null
  return {
    id,
    engine: 'codex',
    cwd,
    gitBranch: '',
    model: model || 'codex',
    turns,
    firstUserText,
    mtime: win.mtime,
  }
}

export function listCodexSessions(): SessionMeta[] {
  if (!existsSync(CODEX_SESSIONS_DIR)) return []
  return newestFileStats(walkJsonlFiles(CODEX_SESSIONS_DIR))
    .map((st) =>
      sessionMetaCache().get(st.file, st.size, st.mtimeMs, () => parseCodexSessionFile(st.file)),
    )
    .filter((s): s is SessionMeta => !!s)
}
