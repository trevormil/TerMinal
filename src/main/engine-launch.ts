import { randomUUID } from 'node:crypto'
import { modelArgs, resumeArgs } from '../shared/engines'
import type { Engine } from './agent-types'

// The per-engine launch ladder (ticket 91): session-id policy + argv per
// engine, extracted from startSession so the ~10 branches are directly
// testable instead of only exercisable by spawning real sessions. PURE apart
// from the injectable id mint — no fs, no settings reads; the caller resolves
// the model and base URL and keeps the side-effectful parts (statusline
// settings, launch seeding, env assembly) where the session state lives.

export type SessionEngine = Engine | 'local'

const CLAUDE_AUTO_FLAGS = ['--permission-mode', 'auto']

export type EngineLaunchInput = {
  engine: SessionEngine
  mode: '' | 'new' | 'resume'
  sessionId?: string
  name?: string
  /** Already-resolved model (per-session pick or the engine default). */
  model?: string
  openrouterHarness?: 'codex' | 'hermes'
  /** Required for openai-compat; the builder throws without it. */
  openAICompatBaseUrl?: string
  /** Injectable for tests. */
  newSessionId?: () => string
}

export function buildEngineLaunch(input: EngineLaunchInput): {
  sessionId: string
  args: string[]
} {
  const { engine, model: defaultModel } = input
  const mint = input.newSessionId ?? randomUUID
  const args: string[] = []
  let sessionId: string

  if (engine === 'local') {
    sessionId = input.sessionId || mint()
  } else if (engine === 'codex') {
    args.push('-s', 'danger-full-access', '-a', 'never')
    if (input.mode === 'resume' && input.sessionId) {
      sessionId = input.sessionId
      args.push('resume', sessionId)
    } else {
      sessionId = mint()
    }
  } else if (engine === 'cursor') {
    if (input.mode === 'resume' && input.sessionId) {
      sessionId = input.sessionId
      args.push('--resume', sessionId)
    } else {
      sessionId = input.sessionId || mint()
    }
  } else if (engine === 'hermes') {
    // Interactive Hermes TUI. Resume attaches to an existing ~/.hermes session
    // (`hermes --resume <id> --tui`); -m applies to --tui per hermes(1).
    args.push('--tui')
    if (input.mode === 'resume' && input.sessionId) {
      sessionId = input.sessionId
      args.push('--resume', sessionId)
    } else {
      sessionId = input.sessionId || mint()
    }
    if (defaultModel) args.push('-m', defaultModel)
  } else if (engine === 'openrouter') {
    // Interactive OpenRouter via the chosen harness (default codex). enginePath
    // ('openrouter') is the one-shot or-agent — NOT usable interactively — so the
    // spawn binary is resolved from the harness by the caller.
    sessionId = input.sessionId || mint()
    if ((input.openrouterHarness || 'codex') === 'hermes') {
      args.push('--tui', '--provider', 'openrouter')
      if (defaultModel) args.push('-m', defaultModel)
    } else {
      args.push('-c', 'model_provider=openrouter', '-s', 'danger-full-access', '-a', 'never')
      if (defaultModel) args.push('-m', defaultModel)
    }
  } else if (engine === 'openai-compat') {
    // Interactive self-hosted endpoint: the Codex TUI with an inline
    // OpenAI-compatible provider (mirrors or-agent's one-shot definition; the
    // one-shot or-agent binary itself is not usable interactively).
    const baseUrl = input.openAICompatBaseUrl
    if (!baseUrl)
      throw new Error('openai-compat: no base URL configured (Settings → Engines → Self-hosted)')
    sessionId = input.sessionId || mint()
    args.push(
      '-c',
      'model_provider=openai-compat',
      '-c',
      'model_providers.openai-compat.name=OpenAI-compatible',
      '-c',
      `model_providers.openai-compat.base_url=${baseUrl}`,
      '-c',
      'model_providers.openai-compat.env_key=OPENAI_API_KEY',
      '-c',
      'model_providers.openai-compat.wire_api=chat',
      '-s',
      'danger-full-access',
      '-a',
      'never',
    )
    if (defaultModel) args.push('-m', defaultModel)
  } else if (engine === 'opencode') {
    // opencode starts its TUI by default; `-s <id>` continues a session. Model
    // (`-m provider/model`) and the launch seed (`--prompt`) come from the
    // registry, so this branch only owns session-id policy.
    if (input.mode === 'resume' && input.sessionId) {
      sessionId = input.sessionId
      args.push(...resumeArgs('opencode', sessionId))
    } else {
      sessionId = input.sessionId || mint()
    }
  } else if (input.mode === 'resume' && input.sessionId) {
    sessionId = input.sessionId
    args.push('--resume', sessionId)
  } else {
    sessionId = mint()
    args.push('--session-id', sessionId)
    if (input.name) args.push('--name', input.name)
  }
  if (engine === 'claude') args.push(...CLAUDE_AUTO_FLAGS)
  // Model flag comes from the registry (--model vs -m vs none) instead of the
  // negative list this replaced, which silently gave any new engine `--model`.
  // hermes/openrouter/openai-compat already pushed their own `-m` above.
  if (
    defaultModel &&
    engine !== 'local' &&
    engine !== 'hermes' &&
    engine !== 'openrouter' &&
    engine !== 'openai-compat'
  )
    args.push(...modelArgs(engine, defaultModel))
  return { sessionId, args }
}
