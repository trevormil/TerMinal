// Failed-run output summarizer. When a bg-task or cron run fails, the raw log
// can be 50k lines. Calling claude-p / codex exec to summarize would be
// expensive. Use OpenRouter haiku for a one-shot summary that fits in the
// HITL action field.
//
// Falls back to a deterministic "last error cluster" extraction when no
// OpenRouter key is configured — keeps the path usable even without the key.

import { readSettings } from './settings'

const STRIP_ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g

/** Last-N-line tail with ANSI stripped. */
export function tailLines(raw: string, n = 80): string {
  return raw
    .replace(STRIP_ANSI, '')
    .split('\n')
    .slice(-n)
    .join('\n')
}

/** Deterministic fallback: find the last cluster of error-shaped lines.
 *  Walks tail-first, captures contiguous lines matching error patterns. */
export function deterministicSummary(rawLog: string): string {
  const lines = rawLog
    .replace(STRIP_ANSI, '')
    .split('\n')
    .filter((l) => l.trim())
  // Walk backwards finding the last "error-like" anchor
  const errPattern = /^(error|err|fail(ed|ure)?|panic|fatal|✗|⛔|🛑)[: !]/i
  let anchor = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (errPattern.test(lines[i])) {
      anchor = i
      break
    }
  }
  if (anchor < 0) {
    // No error anchor — return last 3 non-empty lines
    return lines.slice(-3).join(' · ').slice(0, 240)
  }
  // Cluster: anchor + up to 5 lines following
  return lines.slice(anchor, anchor + 6).join(' · ').slice(0, 280)
}

/** Cheap OpenRouter summarizer. Returns a short, one-line summary suitable
 *  for the HITL action field. Falls back to deterministic on any error. */
export async function summarizeFailedRun(opts: {
  rawLog: string
  context?: string // e.g. "Background task: fix flaky drift test"
  model?: string
  maxTokens?: number
}): Promise<string> {
  const cfg = readSettings().openrouter
  const det = deterministicSummary(opts.rawLog)
  if (!cfg.apiKey) return det
  const tail = tailLines(opts.rawLog, 80)
  try {
    const { openrouterChat } = await import('./openrouter')
    const res = await openrouterChat({
      messages: [
        {
          role: 'system',
          content:
            'You summarize failed CLI run logs into ONE concise sentence (max 25 words) suitable for an operations dashboard alert. Focus on the proximate cause. No preamble, no markdown, just the sentence.',
        },
        {
          role: 'user',
          content:
            (opts.context ? `Context: ${opts.context}\n\n` : '') +
            `Log tail (last 80 lines):\n${tail}`,
        },
      ],
      model: opts.model || cfg.defaultModel || 'anthropic/claude-haiku-4.5',
      maxTokens: opts.maxTokens || 80,
      temperature: 0.1,
      timeoutMs: 8000,
    })
    if (res.ok && res.text) return res.text.trim().slice(0, 280)
  } catch {
    /* fall through */
  }
  return det
}
