import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { configPath } from './config-dir'
import { readFileTail } from './fs-tail'

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

/** Resolved per call through the one config-dir seam. Callers that queue work
 *  asynchronously must capture this ONCE at queue time and thread it through —
 *  an env read at write time races the fire-and-forget completion. */
export const outcomeSummariesDir = (): string => configPath('run-summaries')

/** Runs shorter than this have nothing worth spending a model call on. */
export const OUTCOME_MIN_LOG_CHARS = 400
/** Hard ceiling on summaries per rolling hour — the cost cap. */
export const OUTCOME_HOURLY_CAP = 30
/** Bytes of log tail handed to the model. The prompt only keeps 120 lines. */
export const OUTCOME_LOG_TAIL_BYTES = 64_000
/** Summaries older than this are pruned by the periodic sweep. */
const OUTCOME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Max stored summary length. Two lines in a list row, not a report. */
const OUTCOME_MAX_CHARS = 240
const HOUR_MS = 3_600_000
/** How long the cap counter may reuse its last directory scan. */
const CAP_CACHE_TTL_MS = 5_000

// Only successful runs. A failed run already gets summarizeFailedRun() above
// for its HITL entry, and ticket 81 required that path be unchanged — gating
// failures in here too would silently pay for a SECOND model call on the same
// log for every failure.
const SETTLED = new Set(['done'])

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

const summaryPath = (dir: string, safe: string): string => join(dir, `${safe}.txt`)

export function writeOutcomeSummary(
  runId: string,
  text: string,
  dir = outcomeSummariesDir(),
): boolean {
  const safe = safeRunId(runId)
  const body = text.trim().slice(0, OUTCOME_MAX_CHARS)
  if (!safe || !body) return false
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(summaryPath(dir, safe), body)
    return true
  } catch {
    return false
  }
}

export function readOutcomeSummary(runId: string, dir = outcomeSummariesDir()): string | undefined {
  const safe = safeRunId(runId)
  if (!safe) return undefined
  try {
    // Empty file = a reservation placeholder for an in-flight summary, which is
    // deliberately invisible to readers until it is filled.
    const body = readFileSync(summaryPath(dir, safe), 'utf8').trim()
    return body || undefined
  } catch {
    return undefined
  }
}

/** All stored summaries, keyed by run id — one sweep for a whole Runs list. */
export function readOutcomeSummaries(dir = outcomeSummariesDir()): Map<string, string> {
  const out = new Map<string, string>()
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

/** Delete summaries older than OUTCOME_MAX_AGE_MS. Without this the store grows
 *  forever and the cap counter ends up stat-ing thousands of files. */
export function pruneOutcomeSummaries(
  dir = outcomeSummariesDir(),
  now = Date.now(),
): { pruned: number } {
  if (!existsSync(dir)) return { pruned: 0 }
  let pruned = 0
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.txt')) continue
      const p = join(dir, f)
      try {
        if (now - statSync(p).mtimeMs > OUTCOME_MAX_AGE_MS) {
          rmSync(p, { force: true })
          pruned++
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* unreadable store */
  }
  if (pruned) capCache = null
  return { pruned }
}

// The cap counter scans the store directory, which runs on the main thread from
// every run completion. A short TTL bounds that to one scan per interval;
// reservations bump the cached count directly so a burst inside one tick is
// still counted (see reserveOutcomeSlot).
let capCache: { dir: string; at: number; count: number } | null = null

function summariesInLastHour(dir: string, now = Date.now()): number {
  if (capCache && capCache.dir === dir && now - capCache.at < CAP_CACHE_TTL_MS)
    return capCache.count
  let n = 0
  if (existsSync(dir)) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.txt')) continue
        try {
          if (now - statSync(join(dir, f)).mtimeMs < HOUR_MS) n++
        } catch {
          /* skip */
        }
      }
    } catch {
      n = 0
    }
  }
  capCache = { dir, at: now, count: n }
  return n
}

/** Claim a slot BEFORE the async work starts, by writing an empty placeholder.
 *
 *  Checking the cap and then firing async left it unenforced under burst: a
 *  factory pass settling 80 tasks in one tick had all 80 read the same count,
 *  all 80 pass, and all 80 fire. Reserving synchronously makes the Nth caller
 *  in the same tick see N-1 already taken. */
function reserveOutcomeSlot(dir: string, safe: string, now = Date.now()): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(summaryPath(dir, safe), '')
    if (capCache && capCache.dir === dir) capCache.count++
    else capCache = { dir, at: now, count: summariesInLastHour(dir, now) + 1 }
    return true
  } catch {
    return false
  }
}

function releaseOutcomeSlot(dir: string, safe: string): void {
  try {
    // Only drop a placeholder we never filled — never a real summary.
    if (readFileSync(summaryPath(dir, safe), 'utf8').trim()) return
    rmSync(summaryPath(dir, safe), { force: true })
    if (capCache && capCache.dir === dir && capCache.count > 0) capCache.count--
  } catch {
    /* nothing to release */
  }
}

type OutcomeCall = (prompt: string) => Promise<string>

async function defaultOutcomeCall(prompt: string): Promise<string> {
  // Belt and braces. This path is reached fire-and-forget from run-completion
  // hooks, so ANY test that finalizes a run — including tests written later, in
  // other files, by people who have never read this one — would otherwise shell
  // out to the operator's real `claude` CLI (billed to their subscription) long
  // after the test returned. Tests that genuinely want this must pass `call`.
  if (process.env.NODE_ENV === 'test')
    throw new Error('outcome summarizer: refusing to call a model under the test runner')
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
  /** Captured at queue time — see outcomeSummariesDir(). */
  dir?: string
}): Promise<string | null> {
  const dir = opts.dir ?? outcomeSummariesDir()
  const safe = safeRunId(opts.runId)
  if (!safe) return null
  try {
    const prompt =
      (opts.context ? `Context: ${opts.context}\n\n` : '') +
      `Run log (last 120 lines):\n${tailLines(opts.rawLog, 120)}`
    const text = (await (opts.call || defaultOutcomeCall)(prompt))
      .trim()
      .slice(0, OUTCOME_MAX_CHARS)
    if (!text) {
      releaseOutcomeSlot(dir, safe)
      return null
    }
    if (writeOutcomeSummary(opts.runId, text, dir)) return text
    releaseOutcomeSlot(dir, safe)
    return null
  } catch {
    releaseOutcomeSlot(dir, safe)
    return null
  }
}

/** Fire-and-forget entry point for run-completion hooks. Returns immediately,
 *  swallows everything, and does no work at all when the gate says no. */
export function queueRunOutcomeSummary(opts: {
  runId: string
  status: string
  /** Deferred so a gated-out run never pays to read a log, and expected to
   *  return a TAIL — see readRunLogTail. */
  readLog: () => string
  context?: string
  call?: OutcomeCall
}): void {
  try {
    const safe = safeRunId(opts.runId)
    if (!safe) return
    // Captured ONCE, here: everything below may complete after the caller (and,
    // in tests, an afterEach) has moved on, so the destination must not be
    // re-derived from the environment later.
    const dir = outcomeSummariesDir()

    const pre = shouldSummarizeRun({
      status: opts.status,
      // logChars is checked again below; this pass rules out the cheap
      // non-log reasons before touching the disk.
      logChars: OUTCOME_MIN_LOG_CHARS,
      // existsSync, not readOutcomeSummary: an in-flight reservation is an
      // empty file, and it must still count as "taken".
      alreadySummarized: existsSync(summaryPath(dir, safe)),
      summariesInWindow: summariesInLastHour(dir),
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

    if (!reserveOutcomeSlot(dir, safe)) return

    void summarizeRunOutcome({
      runId: opts.runId,
      rawLog: log,
      context: opts.context,
      call: opts.call,
      dir,
    }).catch(() => null)
  } catch {
    /* a summary is never worth disturbing a completed run */
  }
}

/** Bounded log read for queueRunOutcomeSummary. Run logs reach tens of MB and
 *  this runs on the main thread at every run completion; the prompt only uses
 *  the last 120 lines, so never read more than the tail. */
export function readRunLogTail(path: string, maxBytes = OUTCOME_LOG_TAIL_BYTES): string {
  try {
    return readFileTail(path, maxBytes).text
  } catch {
    return ''
  }
}
