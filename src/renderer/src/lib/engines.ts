import type { Engine, SessionEngine } from './types'

export const ENGINE_LABEL: Record<Engine, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
}

export const SESSION_ENGINE_LABEL: Record<SessionEngine, string> = {
  local: 'Local',
  ...ENGINE_LABEL,
}

export function engineLabel(engine: Engine | string): string {
  return ENGINE_LABEL[engine as Engine] || engine
}

export function sessionEngineLabel(engine: SessionEngine | string): string {
  return SESSION_ENGINE_LABEL[engine as SessionEngine] || engine
}
