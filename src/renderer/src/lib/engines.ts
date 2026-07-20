import type { Engine, SessionEngine } from './types'

export const ENGINE_LABEL: Record<Engine, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  openrouter: 'OpenRouter',
  hermes: 'Hermes',
  'openai-compat': 'Self-hosted',
}

export const SESSION_ENGINE_LABEL: Record<SessionEngine, string> = {
  local: 'Local',
  ...ENGINE_LABEL,
}

export function engineLabel(engine: Engine | string): string {
  return ENGINE_LABEL[engine as Engine] || engine
}

export type ModelOption = { id: string; label: string }

/** The per-engine model menu shown wherever a run is configured. OpenRouter is
 *  seeded from the live catalog but also accepts any slug via free-text. */
export const ENGINE_MODELS: Record<Engine, ModelOption[]> = {
  claude: [
    { id: 'haiku', label: 'haiku' },
    { id: 'sonnet', label: 'sonnet' },
    { id: 'opus', label: 'opus' },
    { id: 'fable', label: 'fable' },
  ],
  codex: [
    { id: 'gpt-5.1-codex', label: 'gpt-5.1-codex' },
    { id: 'gpt-5-codex', label: 'gpt-5-codex' },
    { id: 'gpt-5', label: 'gpt-5' },
    { id: 'o4-mini', label: 'o4-mini' },
  ],
  cursor: [
    { id: 'auto', label: 'auto' },
    { id: 'composer-2.5-fast', label: 'composer-2.5-fast' },
    { id: 'composer-2.5', label: 'composer-2.5' },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { id: 'gpt-5.3-codex-high', label: 'gpt-5.3-codex-high' },
    { id: 'gpt-5.2', label: 'gpt-5.2' },
    { id: 'gpt-5.5-medium', label: 'gpt-5.5-medium' },
    { id: 'claude-opus-4-8-high', label: 'opus-4.8' },
    { id: 'claude-opus-4-8-thinking-high', label: 'opus-4.8-thinking' },
    { id: 'claude-4.6-sonnet-medium', label: 'sonnet-4.6' },
    { id: 'gemini-3.1-pro', label: 'gemini-3.1-pro' },
    { id: 'grok-4.3', label: 'grok-4.3' },
    { id: 'kimi-k2.5', label: 'kimi-k2.5' },
  ],
  // Curated coding slugs from the live OpenRouter catalog; the model step also
  // accepts any slug via free-text. Mostly near-free, with a short frontier tail
  // for when a cheap model won't cut it — note the ~10x price jump at that line.
  // Verified against the catalog 2026-07-16; all support tool calling.
  openrouter: [
    { id: 'deepseek/deepseek-v4-flash', label: 'deepseek-v4-flash' },
    { id: 'deepseek/deepseek-v4-pro', label: 'deepseek-v4-pro' },
    { id: 'qwen/qwen3-coder-next', label: 'qwen3-coder-next' },
    { id: 'z-ai/glm-4.7-flash', label: 'glm-4.7-flash' },
    { id: 'minimax/minimax-m3', label: 'minimax-m3' },
    { id: 'moonshotai/kimi-k2.7-code', label: 'kimi-k2.7-code' },
    { id: 'mistralai/devstral-2512', label: 'devstral-2512' },
    { id: 'google/gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
    { id: 'openai/gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
    // Frontier — materially pricier than everything above.
    { id: 'moonshotai/kimi-k3', label: 'kimi-k3' },
    { id: 'z-ai/glm-5.2', label: 'glm-5.2' },
    { id: 'openai/gpt-5.6-terra', label: 'gpt-5.6-terra' },
  ],
  // Hermes targets many providers; the model step is free-text. A short list of
  // common slugs seeds it (OpenRouter-style: any provider/model slug works).
  hermes: [
    { id: 'anthropic/claude-sonnet-5', label: 'claude-sonnet-5' },
    { id: 'openai/gpt-5.6-terra', label: 'gpt-5.6-terra' },
    { id: 'deepseek/deepseek-v4-flash', label: 'deepseek-v4-flash' },
    { id: 'moonshotai/kimi-k2.7-code', label: 'kimi-k2.7-code' },
  ],
  // Self-hosted endpoints serve whatever the operator loaded — no seed list;
  // the model step is free-text (the slug must match the server's model name).
  'openai-compat': [],
}

export const ENGINE_VENDOR: Record<Engine, string> = {
  claude: 'Anthropic Claude',
  codex: 'OpenAI Codex',
  cursor: 'Cursor Agent',
  openrouter: 'OpenRouter · Codex or Hermes harness',
  hermes: 'Nous Hermes',
  'openai-compat': 'Self-hosted · OpenAI-compatible endpoint · Codex harness',
}

/** Engines that take an arbitrary model slug — their step shows a free-text field.
 *  OpenRouter (any OR slug), Hermes (any provider/model slug), and self-hosted
 *  endpoints (whatever model the server was loaded with). */
export const engineAllowsCustomModel = (engine: Engine): boolean =>
  engine === 'openrouter' || engine === 'hermes' || engine === 'openai-compat'

export function sessionEngineLabel(engine: SessionEngine | string): string {
  return SESSION_ENGINE_LABEL[engine as SessionEngine] || engine
}
