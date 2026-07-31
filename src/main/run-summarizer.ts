import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Failed-run output summarizer. When a bg-task or cron run fails, the raw log
// can be 50k lines. Use the configured lightweight local engine for a short
// one-shot summary that fits in the HITL action field.
//
// Falls back to a deterministic "last error cluster" extraction when no engine
// is available — keeps the path usable without extra setup.

const STRIP_ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g

/** Last-N-line tail with ANSI stripped. */
export function tailLines(raw: string, n = 80): string {
  return raw.replace(STRIP_ANSI, '').split('\n').slice(-n).join('\n')
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
  return lines
    .slice(anchor, anchor + 6)
    .join(' · ')
    .slice(0, 280)
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

// ---- outcome summaries (every completed run, not just failures) ------------
//
// The Runs list shows status but never "what actually got done", so a long
// successful run is as opaque as a failed one. A short outcome summary is
// written onto every SETTLED run, stored in a side-car keyed by run id so no
// existing run record shape has to change.
//
// This path is strictly best-effort and cost-capped. It is fired and forgotten
// after the run has already been finalized: it can never block, slow, or fail a
// run, and a failure to summarize simply means no summary. The failure-summary
// path above is untouched.

const DEFAULT_SUMMARIES_DIR = join(homedir(), '.config', 'TerMinal', 'run-summaries')

/** Resolved per call so tests can point at a temp dir. */
export const outcomeSummariesDir = (): string =>
  process.env.TERMINAL_RUN_SUMMARIES_DIR || DEFAULT_SUMMARIES_DIR

/** Runs shorter than this have nothing worth spending a model call on. */
export const OUTCOME_MIN_LOG_CHARS = 400
/** Hard ceiling on summaries per rolling hour — the cost cap. */
export const OUTCOME_HOURLY_CAP = 30
/** Max stored summary length. Two lines in a list row, not a report. */
const OUTCOME_MAX_CHARS = 240
const HOUR_MS = 3_600_000

const SETTLED = new Set(['done', 'failed', 'canceled', 'interrupted'])

/** Run ids come from run records; never let one address a path outside the store. */
const safeRunId = (id: string): string | null =>
  /^[A-Za-z0-9._-]+$/.test(id) && !id.startsWith('.') ? id : null

export type SummaryGate = { ok: true } | { ok: false; reason: string }

/** Pure gate — every reason a run is NOT summarized, in one place. */
export function shouldSummarizeRun(input: {
  status: string
  logChars: number
  alreadySummarized: boolean
  summariesInWindow: number
}): SummaryGate {
  if (!SETTLED.has(input.status)) return { ok: false, reason: `run is ${input.status}` }
  if (input.alreadySummarized) return { ok: false, reason: 'already summarized' }
  if (input.logChars < OUTCOME_MIN_LOG_CHARS)
    return { ok: false, reason: `log too short (${input.logChars} chars)` }
  if (input.summariesInWindow >= OUTCOME_HOURLY_CAP)
    return { ok: false, reason: `hourly cap of ${OUTCOME_HOURLY_CAP} reached` }
  return { ok: true }
}

export function writeOutcomeSummary(runId: string, text: string): boolean {
  const safe = safeRunId(runId)
  const body = text.trim().slice(0, OUTCOME_MAX_CHARS)
  if (!safe || !body) return false
  try {
    const dir = outcomeSummariesDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${safe}.txt`), body)
    return true
  } catch {
    return false
  }
}

export function readOutcomeSummary(runId: string): string | undefined {
  const safe = safeRunId(runId)
  if (!safe) return undefined
  try {
    const body = readFileSync(join(outcomeSummariesDir(), `${safe}.txt`), 'utf8').trim()
    return body || undefined
  } catch {
    return undefined
  }
}

/** All stored summaries, keyed by run id — one sweep for a whole Runs list. */
export function readOutcomeSummaries(): Map<string, string> {
  const out = new Map<string, string>()
  const dir = outcomeSummariesDir()
  if (!existsSync(dir)) return out
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.txt')) continue
      try {
        const body = readFileSync(join(dir, f), 'utf8').trim()
        if (body) out.set(f.slice(0, -4), body)
      } catch {
        /* skip */
      }
    }
  } catch {
    /* unreadable store — no summaries, no error */
  }
  return out
}

/** Summaries written within the last hour — the cost-cap counter. */
function summariesInLastHour(now = Date.now()): number {
  const dir = outcomeSummariesDir()
  if (!existsSync(dir)) return 0
  try {
    let n = 0
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.txt')) continue
      try {
        if (now - statSync(join(dir, f)).mtimeMs < HOUR_MS) n++
      } catch {
        /* skip */
      }
    }
    return n
  } catch {
    return 0
  }
}

type OutcomeCall = (prompt: string) => Promise<string>

async function defaultOutcomeCall(prompt: string): Promise<string> {
  const { cheapCall } = await import('./cheap-llm')
  const res = await cheapCall({
    messages: [
      {
        role: 'system',
        content:
          'You summarize a completed CLI agent run into at most TWO short lines describing WHAT GOT DONE — concrete outcomes, files or PRs touched, and whether the goal was met. No preamble, no markdown, no restating the status.',
      },
      { role: 'user', content: prompt },
    ],
    model: 'haiku',
    maxTokens: 120,
    temperature: 0.1,
    timeoutMs: 20_000,
  })
  if (!res.ok || !res.text) throw new Error(res.error || 'empty response')
  return res.text
}

/** Summarize one run's log and store it. Returns null on any failure. */
export async function summarizeRunOutcome(opts: {
  runId: string
  rawLog: string
  context?: string
  call?: OutcomeCall
}): Promise<string | null> {
  try {
    const prompt =
      (opts.context ? `Context: ${opts.context}\n\n` : '') +
      `Run log (last 120 lines):\n${tailLines(opts.rawLog, 120)}`
    const text = (await (opts.call || defaultOutcomeCall)(prompt))
      .trim()
      .slice(0, OUTCOME_MAX_CHARS)
    if (!text) return null
    return writeOutcomeSummary(opts.runId, text) ? text : null
  } catch {
    return null
  }
}

/** Fire-and-forget entry point for run-completion hooks. Returns immediately,
 *  swallows everything, and does no work at all when the gate says no. */
export function queueRunOutcomeSummary(opts: {
  runId: string
  status: string
  /** Deferred so a gated-out run never pays to read a 50MB log. */
  readLog: () => string
  context?: string
  call?: OutcomeCall
}): void {
  try {
    const pre = shouldSummarizeRun({
      status: opts.status,
      // logChars is checked again below; this first pass only rules out the
      // cheap non-log reasons before touching the disk.
      logChars: OUTCOME_MIN_LOG_CHARS,
      alreadySummarized: readOutcomeSummary(opts.runId) !== undefined,
      summariesInWindow: summariesInLastHour(),
    })
    if (!pre.ok) return

    let log = ''
    try {
      log = opts.readLog()
    } catch {
      return
    }
    if (
      !shouldSummarizeRun({
        status: opts.status,
        logChars: log.length,
        alreadySummarized: false,
        summariesInWindow: 0,
      }).ok
    )
      return

    void summarizeRunOutcome({
      runId: opts.runId,
      rawLog: log,
      context: opts.context,
      call: opts.call,
    }).catch(() => null)
  } catch {
    /* a summary is never worth disturbing a completed run */
  }
}
