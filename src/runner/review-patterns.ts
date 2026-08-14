// ---- review findings patterns ----------------------------------------------
// Piggybacked on the watchdog: mine the cross-repo review findings for
// recurring themes and file the ones that clear the promotion floor as
// (quiet) Inbox items.
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HitlItem } from '../shared/types/activity'
import { HITL_FILE, readJson, REVIEW_PATTERNS_MARKER } from './config'
import { fileHitl } from './hitl'
import { activity, log } from './log'
import { harnessDir } from './settings'

const REVIEW_PATTERNS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 7d
// Promote to HITL when a pattern recurs at least this much across this many
// distinct repos. 3×/2-repos is the floor that picked up real cross-repo
// signal (third-party CDN, 72-hr quarantine, mutable Docker tags) without
// dragging in noise.
const REVIEW_PROMOTE_COUNT = 3
const REVIEW_PROMOTE_REPOS = 2

type PatternExample = { repo: string; pr: string | number; title: string; file?: string }
type Pattern = {
  key: string
  category: string
  tokens: string[]
  count: number
  repos: string[]
  examples?: PatternExample[]
}
type MineOutput = { promote?: Pattern[]; totals?: { total?: number } }

export async function maybeRunReviewPatterns(force = false): Promise<void> {
  if (!force) {
    const m = readJson<{ lastRunAt?: number }>(REVIEW_PATTERNS_MARKER())
    if (m?.lastRunAt && Date.now() - m.lastRunAt < REVIEW_PATTERNS_INTERVAL_MS) return
  }
  await runReviewPatterns()
}

export async function runReviewPatterns(): Promise<number> {
  const dir = harnessDir()
  if (!dir) {
    log('review-patterns: no harnessDir configured, skipping')
    return 0
  }
  const bin = join(dir, 'bin', 'review-findings-mine')
  if (!existsSync(bin)) {
    log(`review-patterns: ${bin} missing, skipping`)
    return 0
  }
  log(`review-patterns: mining via ${bin}`)
  const out = await new Promise<string>((resolve, reject) => {
    const proc = spawn(
      bin,
      [
        '--json',
        '--threshold-count',
        String(REVIEW_PROMOTE_COUNT),
        '--threshold-repos',
        String(REVIEW_PROMOTE_REPOS),
      ],
      {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('exit', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}: ${stderr}`)),
    )
  })
  let parsed: MineOutput
  try {
    parsed = JSON.parse(out) as MineOutput
  } catch (e) {
    log(`review-patterns: parse failed: ${e}`)
    return 0
  }
  const promote = parsed.promote || []
  const existingKeys = openReviewPatternHitlKeys()
  let filed = 0
  for (const p of promote) {
    if (existingKeys.has(p.key)) continue
    fileHitl({
      kind: 'review-pattern',
      // Was inheriting the default 'cron-fail' source, which both mislabelled a
      // digest as a failed job and made it ping unconditionally. It's a
      // 'normal'-tier FYI: inbox now, no buzz unless you lowered the threshold.
      source: 'review-pattern',
      severity: 'normal',
      patternKey: p.key,
      title: `Recurring ${p.category} finding: ${p.tokens.join(' / ')}`,
      action: `${p.count}× across ${p.repos.length} repos — promote to CLAUDE.md?`,
      detail:
        `repos: ${p.repos.join(', ')}\n\nExamples:\n` +
        (p.examples || [])
          .map((e) => `- ${e.repo}#${e.pr} "${e.title}"${e.file ? ` — ${e.file}` : ''}`)
          .join('\n'),
    })
    filed++
  }
  activity({
    kind: 'check',
    title: `Review patterns · ${parsed.totals?.total || 0} findings · ${promote.length} promote candidates · ${filed} HITL filed`,
    detail: `report: ${join(dir, 'reports', 'review-patterns.md')}`,
  })
  try {
    writeFileSync(
      REVIEW_PATTERNS_MARKER(),
      JSON.stringify({ lastRunAt: Date.now(), filed, promote: promote.length }, null, 2),
    )
  } catch {}
  log(`review-patterns: promote=${promote.length} filed=${filed}`)
  return 0
}

export function openReviewPatternHitlKeys(): Set<string> {
  const list = readJson<HitlItem[]>(HITL_FILE())
  if (!Array.isArray(list)) return new Set()
  const keys = new Set<string>()
  for (const h of list) {
    if (h.kind === 'review-pattern' && h.status === 'open' && h.patternKey) keys.add(h.patternKey)
  }
  return keys
}
