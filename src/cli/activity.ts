// The activity feed: one JSONL line per event.
import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ACTIVITY, CFG, repo, repoLabel, runId } from './env'
import type { ActivityEvent } from './types'

// Deterministic kind inference — mirrors src/main/event-classifier.ts.
// Saves agent scripts from having to memorize the activity-kind enum:
// terminal-cli activity check "Drift · 3 findings" → kind:'check' automatically.
const KIND_PATTERNS: [RegExp, string][] = [
  [/^session\s+started?/i, 'session-start'],
  [/^session\s+(end|closed?|wrapped)/i, 'session-end'],
  [/^(deploy|deployed|ship|shipped|publish|published|release|released)\b/i, 'deploy'],
  [/^ticket\s+(filed|created|opened)/i, 'ticket-filed'],
  [/^ticket\s+(closed|resolved|done)/i, 'ticket-closed'],
  [/^(pr|mr)\s+(?:[!#]?\d+\s+)?(opened|created|filed)/i, 'pr-opened'],
  [/^(pr|mr)\s+(?:[!#]?\d+\s+)?merged/i, 'pr-merged'],
  [/^(pr|mr|review)\s+(?:[!#]?\d+\s+)?(verdict|reviewed|review)/i, 'pr-verdict'],
  [/^tests?\s+(pass(ed|ing)?|green)/i, 'tests-pass'],
  [/^tests?\s+(fail(ed|ing)?|red)/i, 'tests-fail'],
  [/^(check|drift|coverage|deps|deps-quality|dead-code|perf|health)\b/i, 'check'],
  [/^scheduled\s+/i, 'agent-run'],
  [/^(doc|docs|adr|changelog)\b/i, 'doc'],
  [/^hitl\b/i, 'blocked'],
  [/\b(blocked|blocker|need(s)?\s+human|waiting\s+on\s+human)\b/i, 'blocked'],
  [/\bfail(ed|ing)?\b|\berror\b|\bexit\s+\d+\b/i, 'error'],
  [/\b(crash|crashed|panic|exception)\b/i, 'error'],
  [/^(task|run|agent)\s+(complete|done|finished)/i, 'task-complete'],
  [/^agent\s+(started|running)/i, 'agent-run'],
]

export function inferKind(title: string | undefined): string {
  if (!title) return 'info'
  for (const [pat, k] of KIND_PATTERNS) if (pat.test(title)) return k
  return 'info'
}

export function emitActivity(
  kind: string | undefined,
  title: string | undefined,
  detail: string | undefined,
  opts: { suppressTelegram?: boolean } = {},
): void {
  mkdirSync(CFG(), { recursive: true })
  // If caller passed 'info' (the default fallback) AND the title matches a
  // pattern, upgrade to the specific kind. Explicit kinds stay as-is.
  const resolvedKind = !kind || kind === 'info' ? inferKind(title) : kind
  const ev: ActivityEvent = {
    id: randomUUID(),
    ts: Date.now(),
    kind: resolvedKind,
    title: title || '',
    detail: detail || '',
    repo: repoLabel(),
    repoRoot: repo(),
    // runId is auto-attached so the Activity tab can click-jump to the run
    // that emitted the event. runSource is 'cron' because terminal-cli is the
    // helper scripts use, which only run inside cron-fired bash bodies.
    ...(runId() ? { runId: runId(), runSource: 'cron' } : {}),
    ...(opts.suppressTelegram ? { suppressTelegram: true } : {}),
  }
  appendFileSync(ACTIVITY(), JSON.stringify(ev) + '\n')
}

export function emitDeploy(
  env: string | undefined,
  sha: string | undefined,
  detail: string | undefined,
): void {
  const target = String(env || '').trim()
  if (!target) {
    console.error('terminal-cli deploy: environment/name is required')
    process.exit(2)
  }
  const version = String(sha || '').trim()
  const extra = String(detail || '').trim()
  emitActivity('deploy', `Deploy · ${target}`, [version, extra].filter(Boolean).join(' · '))
}
