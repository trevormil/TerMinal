// Failed-run output summarizer. When a bg-task or cron run fails, the raw log
// can be 50k lines. Use the configured lightweight local engine for a short
// one-shot summary that fits in the HITL action field.
//
// Falls back to a deterministic "last error cluster" extraction when no engine
// is available — keeps the path usable without extra setup.

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

/** Cheap LLM summarizer routed through cheap-llm (claude -p haiku by default).
 *  Falls back to deterministic on any error. */
export async function summarizeFailedRun(opts: {
  rawLog: string
  context?: string // e.g. "Background task: fix flaky drift test"
  model?: string
  maxTokens?: number
}): Promise<string> {
  const det = deterministicSummary(opts.rawLog)
  const tail = tailLines(opts.rawLog, 80)
  try {
    const { cheapCall } = await import('./cheap-llm')
    const res = await cheapCall({
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
      model: opts.model || 'haiku',
      maxTokens: opts.maxTokens || 80,
      temperature: 0.1,
      timeoutMs: 10_000,
    })
    if (res.ok && res.text) return res.text.trim().slice(0, 280)
  } catch {
    /* fall through */
  }
  return det
}
