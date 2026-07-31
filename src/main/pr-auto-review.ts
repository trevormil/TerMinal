// Automatic pre-review at PR-open.
//
// This is TRIAGE, not review. It fires the SAME code-review agent a human would
// fire by hand, writing the same `.TerMinal/reviews/<iid>/` artifacts — it just
// does it as soon as a PR appears instead of waiting for someone to click. It
// adds a signal; it removes nothing. The merge bar (approve verdict + tests +
// zero findings at severity >= medium) and the human merge gate are untouched.
//
// Default is OFF: an automatic review pass spends real money.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Mr } from './mrs'

export type AutoReviewConfig = {
  enabled: boolean
  /** Hard cap per sweep. Opening five PRs must not fan out five review runs. */
  maxPerSweep: number
  /** When non-empty, only PRs by these authors are auto-reviewed. */
  authors: string[]
  /** iid → the head short-sha we last auto-reviewed. */
  seen: Record<string, string>
}

export const DEFAULT_AUTO_REVIEW: AutoReviewConfig = {
  enabled: false,
  maxPerSweep: 2,
  authors: [],
  seen: {},
}

function configFile(): string {
  return (
    process.env.TERMINAL_AUTOREVIEW_FILE ||
    join(homedir(), '.config', 'TerMinal', 'pr-auto-review.json')
  )
}

export function readAutoReviewConfig(): AutoReviewConfig {
  const f = configFile()
  if (!existsSync(f)) return { ...DEFAULT_AUTO_REVIEW, seen: {} }
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'))
    return { ...DEFAULT_AUTO_REVIEW, ...raw, seen: raw?.seen ?? {} }
  } catch {
    return { ...DEFAULT_AUTO_REVIEW, seen: {} }
  }
}

export function writeAutoReviewConfig(c: AutoReviewConfig): AutoReviewConfig {
  const f = configFile()
  const dir = dirname(f)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(f, JSON.stringify(c, null, 2))
  return c
}

export function markReviewed(iid: number, headShort: string): AutoReviewConfig {
  const c = readAutoReviewConfig()
  c.seen[String(iid)] = headShort
  return writeAutoReviewConfig(c)
}

/** Which open PRs deserve an automatic pre-review right now. */
export function selectAutoReviewTargets(
  mrs: Mr[],
  seen: Record<string, string>,
  cfg: AutoReviewConfig,
): Mr[] {
  if (!cfg.enabled) return []
  const out: Mr[] = []
  for (const m of mrs || []) {
    if (out.length >= Math.max(1, cfg.maxPerSweep)) break
    if (m.state !== 'opened' && m.state !== 'open') continue
    if (m.draft) continue
    if (cfg.authors.length && !cfg.authors.includes(m.author)) continue
    // A fresh review artifact already exists — don't pay for a second one. A
    // STALE one means commits landed since, so it's fair game again.
    if (m.review && !m.review.stale) continue
    if (m.headShort && seen[String(m.iid)] === m.headShort) continue
    out.push(m)
  }
  return out
}

export type AutoReviewDeps = {
  listMrs: (repoRoot: string) => Promise<{ mrs: Mr[]; error?: string }>
  gate: () => { decision: 'allow' | 'warn' | 'refuse'; reason?: string }
  spawn: (pr: {
    iid: number
    sourceBranch: string
    title?: string
    webUrl?: string
  }) => { id: string } | { error: string }
}

export type AutoReviewSweep = {
  started: { iid: number; runId: string }[]
  errors: string[]
  skipped?: string
}

/** One sweep: find eligible PRs, gate on budget, fire the review agent. */
export async function runAutoReviewSweep(
  repoRoot: string,
  deps: AutoReviewDeps,
): Promise<AutoReviewSweep> {
  const cfg = readAutoReviewConfig()
  if (!cfg.enabled) return { started: [], errors: [], skipped: 'auto-review is disabled' }

  const { mrs, error } = await deps.listMrs(repoRoot)
  if (error) return { started: [], errors: [error] }
  const targets = selectAutoReviewTargets(mrs, cfg.seen, cfg)
  if (!targets.length) return { started: [], errors: [] }

  // Same gate every other background spawn goes through. Refused means we do
  // NOT mark anything seen — these PRs still deserve a review later.
  const g = deps.gate()
  if (g.decision === 'refuse')
    return { started: [], errors: [], skipped: g.reason || 'over budget cap' }

  const started: AutoReviewSweep['started'] = []
  const errors: string[] = []
  for (const m of targets) {
    const r = deps.spawn({
      iid: m.iid,
      sourceBranch: m.sourceBranch,
      title: m.title,
      webUrl: m.webUrl,
    })
    if ('error' in r) {
      errors.push(`#${m.iid}: ${r.error}`)
      continue
    }
    started.push({ iid: m.iid, runId: r.id })
    markReviewed(m.iid, m.headShort || '')
  }
  return { started, errors }
}
