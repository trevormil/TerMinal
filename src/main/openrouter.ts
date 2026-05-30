// OpenRouter — lightweight one-shot caller for scripts that want a cheap
// classifier / judge / health-check signal without spinning up claude-code
// or codex CLI. NOT a full coding harness; for that use the engines.
//
// Use cases this is good for:
//   - "classify this CI failure" cheap model call
//   - "summarize this log into one line"
//   - "is this commit message Claude-shaped or Cursor-shaped" classifier
//   - quick natural-language matching for routing
//
// Use cases it is NOT good for:
//   - multi-turn code editing (use claude-code / codex)
//   - tool-using agents (no tool-use support here)
//   - long planning (use claude-code which has CLAUDE.md memory)

import { readSettings } from './settings'

export type OpenRouterMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type OpenRouterResponse = {
  ok: boolean
  text?: string
  model?: string
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  error?: string
}

/** Single-shot completion. Returns the assistant message text. */
export async function openrouterChat(opts: {
  messages: OpenRouterMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<OpenRouterResponse> {
  const cfg = readSettings().openrouter
  if (!cfg.apiKey) return { ok: false, error: 'OpenRouter API key not set (Settings → OpenRouter)' }
  const model = opts.model || cfg.defaultModel || 'anthropic/claude-haiku-4.5'
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        // OpenRouter asks for these so the call attributes to TerMinal
        'http-referer': 'https://github.com/trevormil/TerMinal',
        'x-title': 'TerMinal',
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `OpenRouter ${res.status}: ${body.slice(0, 200)}` }
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    return {
      ok: true,
      text,
      model: json.model,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens || 0,
            completionTokens: json.usage.completion_tokens || 0,
            totalTokens: json.usage.total_tokens || 0,
          }
        : undefined,
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Curated free / cheap model recommendations on OpenRouter. Use these for
 *  the cheap classification calls that don't need to be Anthropic-shaped
 *  (which would otherwise route through claude -p haiku for free via Max).
 *  The :free suffix uses OpenRouter's free tier; the others are notably
 *  cheap per-million for high-volume cheap-tier work. */
export const FREE_MODEL_PRESETS = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
  { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (free)' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (free)' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 405B (free)' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small (free)' },
] as const

export const CHEAP_PAID_PRESETS = [
  { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini', inUsdPerM: 0.25 },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', inUsdPerM: 0.3 },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', inUsdPerM: 0.27 },
] as const

/** Test connectivity — sends a tiny prompt, returns the model + a quick reply. */
export async function testOpenRouter(): Promise<OpenRouterResponse> {
  return openrouterChat({
    messages: [
      { role: 'system', content: 'Reply with exactly: TerMinal connected.' },
      { role: 'user', content: 'health' },
    ],
    maxTokens: 16,
    timeoutMs: 10_000,
  })
}
