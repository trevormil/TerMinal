// Cron-side AIRun ledger: parse the usage summary out of the captured log and
// write a one-off record so the in-app Observability tab sees this cron-fired
// invocation alongside the in-process ones.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AI_RUNS_DIR } from './config'
import { log } from './log'
import { writeJsonAtomicShared } from './state-io'

export type Price = { in: number; out: number; cacheRead?: number }

// Per-million pricing for the cron-side AIRun writer. Mirrors the table in
// src/main/ai-pricing.ts — keep in sync by hand when prices change.
export const PER_M_PRICING: Record<string, Price> = {
  haiku: { in: 1, out: 5, cacheRead: 0.1 },
  sonnet: { in: 3, out: 15, cacheRead: 0.3 },
  opus: { in: 15, out: 75, cacheRead: 1.5 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheRead: 0.3 },
  'claude-opus-4-7': { in: 15, out: 75, cacheRead: 1.5 },
  'claude-opus-4-8': { in: 15, out: 75, cacheRead: 1.5 },
  'gpt-5': { in: 1.25, out: 10 },
  'gpt-5-codex': { in: 1.25, out: 10 },
  'gpt-5-mini': { in: 0.25, out: 2 },
  'o4-mini': { in: 0.6, out: 2.4 },
}

export function priceFor(model: string | undefined): Price {
  const m = (model || '').toLowerCase().trim()
  if (PER_M_PRICING[m]) return PER_M_PRICING[m]
  // Prefix-match
  let best: { key: string; val: Price } | null = null
  for (const [key, val] of Object.entries(PER_M_PRICING)) {
    if (m.startsWith(key) && (!best || key.length > best.key.length)) best = { key, val }
  }
  return best?.val || { in: 0, out: 0 }
}

export type ParsedUsage = { input: number; output: number; cacheRead: number; model: string }

// Parse claude -p / codex exec usage summary from the tail of the captured log.
export function parseUsageFromOutput(out: string): ParsedUsage | null {
  let input = 0
  let output = 0
  let cacheRead = 0
  let model = ''
  const lines = out.split('\n').slice(-200)
  for (const raw of lines) {
    // eslint-disable-next-line no-control-regex -- stripping the ANSI the pty wrapper emits
    const line = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    let m: RegExpMatchArray | null
    if ((m = line.match(/(?:input|prompt)\s*tokens?[:\s]+(\d[\d,]*)/i)) && input === 0) {
      input = parseInt(m[1].replace(/,/g, ''), 10)
    }
    if ((m = line.match(/(?:output|completion)\s*tokens?[:\s]+(\d[\d,]*)/i)) && output === 0) {
      output = parseInt(m[1].replace(/,/g, ''), 10)
    }
    if ((m = line.match(/cache(?:d|\s*read)?[:\s]+(\d[\d,]*)/i)) && cacheRead === 0) {
      cacheRead = parseInt(m[1].replace(/,/g, ''), 10)
    }
    if (!model && (m = line.match(/model[:\s]+([\w\-.]+)/i))) model = m[1]
  }
  return input || output ? { input, output, cacheRead, model } : null
}

export type AiRunInput = {
  engine: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  repoRoot: string
  runId: string
  agentId: string
  startedAt: number
  endedAt: number
  exitCode: number
}

export function writeAIRun(opts: AiRunInput): void {
  try {
    mkdirSync(AI_RUNS_DIR(), { recursive: true })
    const price = priceFor(opts.model)
    const cost =
      (opts.inputTokens * price.in +
        opts.outputTokens * price.out +
        (opts.cacheReadTokens || 0) * (price.cacheRead || price.in)) /
      1_000_000
    const rec = {
      id: randomUUID(),
      source: opts.engine === 'codex' ? 'codex-exec' : 'claude-p',
      startedAt: opts.startedAt,
      endedAt: opts.endedAt,
      model: opts.model || (opts.engine === 'codex' ? 'gpt-5' : 'sonnet'),
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      cacheReadTokens: opts.cacheReadTokens || 0,
      costUsd: cost,
      repoRoot: opts.repoRoot,
      runId: opts.runId,
      agentId: opts.agentId,
      durationMs: opts.endedAt - opts.startedAt,
      exitCode: opts.exitCode,
    }
    writeJsonAtomicShared(join(AI_RUNS_DIR(), `${rec.id}.json`), rec)
  } catch (e) {
    log(`ai-run write failed: ${e}`)
  }
}
