// Normalizing + addressing code-review findings.
//
// Findings come from `.TerMinal/reviews/<iid>/findings.json`, written by whatever
// code-review agent ran. That artifact is deliberately loose (different agents,
// different vocabularies), so everything downstream — inline rendering in the
// diff, severity filters, posting to a forge thread — goes through here first.

import { createHash } from 'node:crypto'
import type { Finding } from './mrs'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

const ALIASES: Record<string, Severity> = {
  critical: 'critical',
  blocker: 'critical',
  severe: 'critical',
  high: 'high',
  major: 'high',
  medium: 'medium',
  med: 'medium',
  moderate: 'medium',
  low: 'low',
  minor: 'low',
  info: 'info',
  nit: 'info',
  nitpick: 'info',
  suggestion: 'info',
  note: 'info',
}

/** Unknown/absent severity degrades to `info`. Erring toward "noise" is safe;
 *  erring toward "critical" would put junk in front of the merge decision. */
export function normalizeSeverity(raw?: string | null): Severity {
  return ALIASES[(raw || '').trim().toLowerCase()] ?? 'info'
}

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s)
}

/** Is `s` at least as severe as `floor`? The merge bar is `>= medium`. */
export function atOrAbove(s: Severity, floor: Severity): boolean {
  return severityRank(s) <= severityRank(floor)
}

export type NormalizedFinding = {
  id: string
  severity: Severity
  title: string
  body: string
  file?: string
  line?: number
  category?: string
  status?: string
}

/** Strip the `a/` `b/` prefixes a unified diff carries and any leading `./`, so
 *  a finding's path matches the path the diff viewer knows a file by. */
export function normalizePath(p?: string): string | undefined {
  if (!p) return undefined
  return p.replace(/^\.\//, '').replace(/^[ab]\//, '') || undefined
}

export function normalizeFinding(raw: Finding): NormalizedFinding {
  const body = String(raw.body ?? raw.text ?? '').trim()
  const title = String(raw.title ?? '').trim() || body.split('\n')[0] || 'Finding'
  const file = normalizePath(typeof raw.file === 'string' ? raw.file : undefined)
  const lineNum = Number(raw.line)
  const line = Number.isFinite(lineNum) && lineNum > 0 ? Math.floor(lineNum) : undefined
  return {
    id:
      String(raw.id ?? '').trim() ||
      // Stable content hash so the same finding keeps the same id across
      // re-reads — that's what makes "did we already post this?" answerable.
      `f-${createHash('sha1')
        .update(`${title}\0${file || ''}\0${line || ''}`)
        .digest('hex')
        .slice(0, 8)}`,
    severity: normalizeSeverity(typeof raw.severity === 'string' ? raw.severity : undefined),
    title,
    body,
    file,
    line,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  }
}

/** `file:line` → findings at that location, worst severity first. Findings with
 *  no anchor are excluded — they belong in the summary, not the gutter. */
export function findingsByLocation(raw: Finding[]): Record<string, NormalizedFinding[]> {
  const out: Record<string, NormalizedFinding[]> = {}
  for (const f of raw || []) {
    const n = normalizeFinding(f)
    if (!n.file || !n.line) continue
    ;(out[`${n.file}:${n.line}`] ||= []).push(n)
  }
  for (const k of Object.keys(out))
    out[k].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  return out
}

/** The markdown body posted to a forge thread. Always self-identifies as an
 *  automated pre-review finding so nobody mistakes it for a human approval. */
export function formatFindingComment(
  f: NormalizedFinding,
  opts: { inline?: boolean } = {},
): string {
  const where = !opts.inline && f.file ? ` · \`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''
  return [
    `**${f.severity}** — ${f.title}${where}`,
    ``,
    f.body,
    ``,
    `<sub>Posted by TerMinal pre-review (finding \`${f.id}\`). Automated triage — not a review approval; the human merge gate still applies.</sub>`,
  ].join('\n')
}
