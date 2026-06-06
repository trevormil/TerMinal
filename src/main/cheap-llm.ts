// Cheap/short one-shot LLM caller with smart routing.
//
// When opts.engine is set, run that standalone coding CLI directly:
// claude -p, codex exec, or cursor-agent -p. This is used by terminal
// suggested replies so the operator can choose the same engine/model UX used
// elsewhere in the app.
//
// Anthropic models (haiku/sonnet/opus or claude-*) → `claude -p` so the call
// hits the user's Max subscription budget (free at the margin) instead of
// a separate per-token API key.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { enginePath, type EngineId } from './settings'

export type CheapMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type CheapResponse = {
  ok: boolean
  text?: string
  model?: string
  route?: 'claude-p' | 'codex-exec' | 'cursor-agent'
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

/** Is this model name something claude -p will recognize? Accepts a legacy
 *  "anthropic/" prefix so old settings still route through claude -p. */
export function normalizeAnthropicModel(model: string): string | null {
  if (!model) return null
  let m = model.toLowerCase().trim()
  if (m.startsWith('anthropic/')) m = m.slice('anthropic/'.length)
  // Map long "claude-haiku-4.5" / "claude-sonnet-4.6" etc.
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
  model: string | undefined,
  timeoutMs: number,
  cwd?: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const bin = enginePath('claude') || 'claude'
    const args = ['-p', prompt, '--permission-mode', 'auto', ...(model ? ['--model', model] : [])]
    execFile(
      bin,
      args,
      { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, cwd: cwd && existsSync(cwd) ? cwd : undefined },
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

function callStandaloneEngine(
  engine: EngineId,
  prompt: string,
  model: string | undefined,
  timeoutMs: number,
  cwd?: string,
): Promise<{ ok: boolean; text?: string; error?: string; route: CheapResponse['route'] }> {
  if (engine === 'claude') {
    return callClaudeP(prompt, model, timeoutMs, cwd).then((r) => ({ ...r, route: 'claude-p' as const }))
  }

  const runCwd = cwd && existsSync(cwd) ? cwd : undefined
  const bin = enginePath(engine) || (engine === 'cursor' ? 'cursor-agent' : engine)
  const args =
    engine === 'codex'
      ? [
          'exec',
          '-s',
          'danger-full-access',
          ...(runCwd ? ['-C', runCwd] : []),
          ...(model ? ['--model', model] : []),
          prompt,
        ]
      : [
          '-p',
          '--force',
          '--trust',
          '--output-format',
          'text',
          ...(runCwd ? ['--workspace', runCwd] : []),
          ...(model ? ['--model', model] : []),
          prompt,
        ]

  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, cwd: runCwd },
      (err, stdout, stderr) => {
        const route = engine === 'codex' ? 'codex-exec' : 'cursor-agent'
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            resolve({ ok: false, error: `${bin} CLI not installed`, route })
            return
          }
          resolve({ ok: false, error: stderr?.toString().slice(0, 240) || err.message, route })
          return
        }
        const text = (stdout || '').replace(STRIP_ANSI, '').trim()
        resolve({ ok: true, text, route })
      },
    )
  })
}

/** Smart-routed cheap LLM call. */
export async function cheapCall(opts: {
  messages: CheapMessage[]
  model?: string
  engine?: EngineId
  /** Force a specific route. Default is "anthropic-models → claude -p". */
  route?: 'auto' | 'claude-p'
  cwd?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<CheapResponse> {
  const route = opts.route || 'auto'
  const anthroModel = normalizeAnthropicModel(opts.model || '')
  const wantClaude = route === 'claude-p' || (route === 'auto' && !!anthroModel)
  const timeoutMs = opts.timeoutMs ?? 30_000
  const prompt = flattenMessages(opts.messages)

  if (opts.engine) {
    const res = await callStandaloneEngine(opts.engine, prompt, opts.model, timeoutMs, opts.cwd)
    return { ...res, model: opts.model }
  }

  if (wantClaude) {
    const cp = await callClaudeP(
      prompt,
      anthroModel || 'haiku',
      timeoutMs,
      opts.cwd,
    )
    if (cp.ok) {
      return { ok: true, text: cp.text, model: anthroModel || 'haiku', route: 'claude-p' }
    }
    return { ok: false, error: cp.error || 'claude -p failed', route: 'claude-p' }
  }

  return {
    ok: false,
    error: `No built-in cheap route for model "${opts.model || ''}". Select Claude, Codex, or Cursor as the engine for this request.`,
  }
}
