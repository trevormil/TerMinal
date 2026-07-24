import { execFileSync } from 'node:child_process'

// Cursor's model catalog, read from the CLI instead of hand-maintained.
//
// Cursor Router (announced 2026-07-22) routes an `auto` request to whichever
// model it judges best, and Cursor ships new ids continuously — the hardcoded
// list in lib/engines.ts had already drifted (missing gpt-5.3-codex-low,
// cursor-grok-4.5-high, the gpt-5.6-sol tier). `cursor-agent --list-models`
// returns the server's own list for THIS account, so router variants and new
// models appear with no code change.
//
// Router itself needs nothing from us: `auto` is the entry point and is already
// offered. The optimization modes (Intelligence / Balance / Cost) are NOT
// exposed by the CLI — no flag, no model id, nothing in the binary — they are
// account/team settings chosen in Cursor's picker or admin dashboard and
// inherited by CLI sessions. So we deliberately do not model them here.

export type CursorModel = { id: string; label: string }

/**
 * Parse `cursor-agent --list-models` output.
 *
 *   Available models
 *
 *   auto - Auto (default)
 *   gpt-5.3-codex - Codex 5.3
 *
 * Kept pure so it can be tested without the CLI installed.
 */
export function parseCursorModels(stdout: string): CursorModel[] {
  const out: CursorModel[] = []
  const seen = new Set<string>()
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // "<id> - <label>". The header ("Available models") has no separator.
    const m = /^([A-Za-z0-9._-]+)\s+-\s+(.+)$/.exec(line)
    if (!m) continue
    const [, id, label] = m
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: label.trim() })
  }
  return out
}

let cache: { at: number; models: CursorModel[] } | null = null
/** Long enough that a picker open doesn't shell out repeatedly, short enough
 *  that a newly-released model shows up the same day. */
const TTL_MS = 30 * 60 * 1000

/**
 * The account's live Cursor models. Returns [] when the CLI is missing, not
 * logged in, or slow — callers fall back to the static catalog, so a failure
 * degrades to today's behaviour rather than an empty picker.
 */
export function listCursorModels(now = Date.now()): CursorModel[] {
  if (cache && now - cache.at < TTL_MS) return cache.models
  let models: CursorModel[] = []
  try {
    const stdout = execFileSync('cursor-agent', ['--list-models'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    models = parseCursorModels(stdout)
  } catch {
    models = []
  }
  // Only cache a real answer: caching [] would pin the fallback for 30 minutes
  // after a transient failure (e.g. the CLI briefly re-authenticating).
  if (models.length) cache = { at: now, models }
  return models
}

/** Test seam — drop the memoised catalog. */
export function resetCursorModelCache(): void {
  cache = null
}
