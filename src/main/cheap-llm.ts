// Cheap one-shot LLM caller with smart routing.
//
// Anthropic models (haiku/sonnet/opus or claude-*) → `claude -p` so the call
// hits the user's Max subscription budget (free at the margin) instead of
// per-token OpenRouter billing.
//
// Non-Anthropic models (gpt-*, gemini-*, deepseek/*, free OpenRouter models,
// etc.) → OpenRouter.
//
// Falls back gracefully — if claude -p isn't installed but OpenRouter is
// configured, anything routes through OpenRouter.

import { execFile } from 'node:child_process'
import { enginePath } from './settings'

export type CheapMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type CheapResponse = {
  ok: boolean
  text?: string
  model?: string
  route?: 'claude-p' | 'openrouter'
  error?: string
}

// Anthropic model aliases — claude -p accepts these (and the long
// claude-haiku-4-5 forms too).
const ANTHROPIC_ALIASES = new Set([
  'haiku',
  'sonnet',
  'opus',
  'claude-haiku',
  'claude-sonnet',
  'claude-opus',
])

/** Is this model name something claude -p will recognize? Strips OpenRouter
 *  "anthropic/" prefix so callers can pass the OpenRouter-shaped name and
 *  still get routed to claude -p. */
export function normalizeAnthropicModel(model: string): string | null {
  if (!model) return null
  let m = model.toLowerCase().trim()
  if (m.startsWith('anthropic/')) m = m.slice('anthropic/'.length)
  // Map openrouter-style "claude-haiku-4.5" / "claude-sonnet-4.6" etc.
  if (/^claude-(haiku|sonnet|opus)/.test(m)) return m.split(/[-.]/, 3).slice(0, 3).join('-')
  if (ANTHROPIC_ALIASES.has(m)) return m
  return null
}

const STRIP_ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g

function flattenMessages(msgs: CheapMessage[]): string {
  // claude -p takes a single prompt — fold the system + user into one
  // structured blob so the model still respects the system instruction.
  const parts: string[] = []
  for (const m of msgs) {
    if (m.role === 'system') parts.push(`SYSTEM:\n${m.content}`)
    else if (m.role === 'user') parts.push(`USER:\n${m.content}`)
    else parts.push(`ASSISTANT:\n${m.content}`)
  }
  return parts.join('\n\n')
}

function callClaudeP(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const bin = enginePath('claude') || 'claude'
    const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', model]
    execFile(
      bin,
      args,
      { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // Distinguish "claude not installed" from "claude ran but errored"
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            resolve({ ok: false, error: 'claude CLI not installed' })
            return
          }
          resolve({ ok: false, error: stderr?.toString().slice(0, 200) || err.message })
          return
        }
        // claude -p prints just the response text by default. Strip ANSI just
        // in case + trim.
        const text = (stdout || '').replace(STRIP_ANSI, '').trim()
        resolve({ ok: true, text })
      },
    )
  })
}

/** Smart-routed cheap LLM call. */
export async function cheapCall(opts: {
  messages: CheapMessage[]
  model?: string
  /** Force a specific route. Default is "anthropic-models → claude -p; else openrouter". */
  route?: 'auto' | 'claude-p' | 'openrouter'
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<CheapResponse> {
  const route = opts.route || 'auto'
  const anthroModel = normalizeAnthropicModel(opts.model || '')
  const wantClaude = route === 'claude-p' || (route === 'auto' && !!anthroModel)
  const timeoutMs = opts.timeoutMs ?? 30_000

  if (wantClaude) {
    const cp = await callClaudeP(
      flattenMessages(opts.messages),
      anthroModel || 'haiku',
      timeoutMs,
    )
    if (cp.ok) {
      return { ok: true, text: cp.text, model: anthroModel || 'haiku', route: 'claude-p' }
    }
    // Fall through to OpenRouter on failure (claude not installed, auth
    // issue, etc.). Important: callers shouldn't have to know whether
    // claude is set up.
  }

  // OpenRouter path
  try {
    const { openrouterChat } = await import('./openrouter')
    const res = await openrouterChat({
      messages: opts.messages,
      model: opts.model || 'anthropic/claude-haiku-4.5',
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      timeoutMs,
    })
    return { ...res, route: 'openrouter' }
  } catch (e) {
    return { ok: false, error: (e as Error).message, route: 'openrouter' }
  }
}
