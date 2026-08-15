// Filing and commenting on tickets, across the ticket providers a repo can be
// configured with (local backlog markdown, github, linear).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { areaPath, areaPathsFor, maxAreaId, statePathForRead } from '../runner/repo-state'
import { emitActivity } from './activity'
import { agentId, repo } from './env'

// The user's LOCAL calendar day, not UTC. `toISOString().slice(0,10)` is the UTC
// date, so any evening edit west of UTC stamps TOMORROW. Must agree with
// src/main/local-day.ts: the app and this script write the same ticket
// `updated:` field, and a mismatch made them disagree by a day every evening.
export const localDay = (at = new Date()): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

// Mirrors ModelTier in src/main/resolve-model.ts. An unroutable tier resolves
// through the default (expensive) policy slot, so normalise rather than trust.
const MODEL_TIERS = ['auto', 'top', 'cheap-agentic', 'cheap-raw']
const normalizeModelTier = (value: string | undefined): string =>
  MODEL_TIERS.includes(value as string) ? (value as string) : 'auto'

type TicketConfig = {
  provider?: string
  github?: GithubCfg
}

type GithubCfg = {
  priorityLabels?: Record<string, string>
  typeLabels?: Record<string, string>
}

function readTicketConfig(): TicketConfig {
  try {
    // Personal config — sidecar first, legacy in-repo copy as fallback.
    const p = statePathForRead(repo(), 'tickets.json')
    if (!existsSync(p)) return {}
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Every dir an area's content may live in (sidecar first), for reads. */
const areaReadPaths = (root: string, area: string): string[] => areaPathsFor(root, area)

export function fileTicket(
  title: string | undefined,
  body: string | undefined,
  modelTier: string | undefined,
): void {
  if (!repo()) {
    console.error(
      'terminal-cli ticket: TERMINAL_REPO not set — scripts must be invoked by the TerMinal runner',
    )
    process.exit(2)
  }
  const cfg = readTicketConfig()
  if (cfg.provider === 'github') return fileGithubIssue(title, body, cfg.github || {})
  if (cfg.provider === 'linear') {
    console.error(
      'terminal-cli ticket: Linear repos must file through the configured Linear MCP/CLI, not local backlog markdown',
    )
    process.exit(2)
  }
  if (cfg.provider === 'webview') {
    console.error(
      'terminal-cli ticket: this repo has no ticket store — its Tickets tab is a webview, not a queryable backlog',
    )
    process.exit(2)
  }
  const backlog = areaPath(repo(), 'backlog')
  mkdirSync(backlog, { recursive: true })
  // Allocate across every dir the repo READS from, so a fresh sidecar beside a
  // repo that still holds 0001-0042 does not restart at 0001.
  const maxId = maxAreaId(areaReadPaths(repo(), 'backlog').concat(backlog))
  const id = String(maxId + 1).padStart(4, '0')
  const slug =
    (title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'untitled'
  const today = localDay()
  const assignedAgent = agentId() || 'factory'
  const fm = `---
id: ${id}
title: ${JSON.stringify(title || 'Untitled')}
status: open
priority: medium
type: feature
source: script
created: ${today}
updated: ${today}
model_tier: ${normalizeModelTier(modelTier)}
agent_id: ${assignedAgent}
agent_scope: ${agentId() ? 'repo' : 'global'}
agent_kind: classic
---

${body || ''}
`
  const path = join(backlog, `${id}-${slug}.md`)
  writeFileSync(path, fm)
  emitActivity('ticket-filed', `Ticket filed · #${id}`, title || '')
  console.log(path)
}

/**
 * Append to a ticket's `## Log` — the durable per-ticket context an agent run
 * leaves behind for the next one. Mirrors appendComment in
 * src/main/ticket-comments.ts; kept in sync by the round-trip tests.
 */
export function commentOnTicket(slug: string | undefined, body: string | undefined): void {
  if (!repo()) {
    console.error(
      'terminal-cli ticket comment: TERMINAL_REPO not set — scripts must be invoked by the TerMinal runner',
    )
    process.exit(2)
  }
  const text = String(body || '').trim()
  if (!text) {
    console.error('terminal-cli ticket comment: empty comment body')
    process.exit(2)
  }
  const cfg = readTicketConfig()
  if (cfg.provider === 'github' || cfg.provider === 'linear') {
    console.error(
      `terminal-cli ticket comment: ${cfg.provider} repos must comment through their own CLI/MCP, not local backlog markdown`,
    )
    process.exit(2)
  }
  if (cfg.provider === 'webview') {
    console.error(
      'terminal-cli ticket comment: this repo has no ticket store — its Tickets tab is a webview, not a queryable backlog',
    )
    process.exit(2)
  }
  // Look across every store the repo reads from (sidecar + any state still
  // committed in-repo), not just where new tickets are written — otherwise
  // commenting on a ticket that predates the sidecar would fail.
  const dirs = areaReadPaths(repo(), 'backlog')
  const writeDir = areaPath(repo(), 'backlog')
  const safe = String(slug || '').replace(/[^\w-]/g, '')
  const path = safe ? dirs.map((d) => join(d, `${safe}.md`)).find((p) => existsSync(p)) : ''
  if (!path) {
    console.error(
      `terminal-cli ticket comment: no such ticket "${slug}" in ${dirs.join(', ') || writeDir}`,
    )
    process.exit(2)
  }
  const md = readFileSync(path, 'utf8')
  const m = md.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/)
  if (!m) {
    console.error(`terminal-cli ticket comment: ${safe}.md has no frontmatter block`)
    process.exit(2)
  }
  const header = `### ${new Date().toISOString()} · agent:${agentId() || 'factory'}${
    process.env.TERMINAL_ENGINE ? ` (${process.env.TERMINAL_ENGINE})` : ''
  }`
  // Appending never needs to parse the existing log — only to find whether one
  // has been opened yet — so the parser stays in exactly one place.
  const hasLog = /^## Log$/m.test(m[2])
  const prose = m[2].trim()
  const next = hasLog
    ? `${m[1]}\n${prose}\n\n${header}\n${text}\n`
    : `${m[1]}\n${prose ? `${prose}\n\n` : ''}## Log\n\n${header}\n${text}\n`
  writeFileSync(path, next.replace(/^(updated:[ \t]*).*$/m, `$1${localDay()}`))
  console.log(path)
}

function ghLabelMaps(cfg: GithubCfg): {
  priority: Record<string, string>
  type: Record<string, string>
} {
  return {
    priority: {
      critical: 'priority:critical',
      high: 'priority:high',
      medium: 'priority:medium',
      low: 'priority:low',
      ...(cfg.priorityLabels || {}),
    },
    type: {
      feature: 'type:feature',
      bug: 'type:bug',
      security: 'type:security',
      docs: 'type:docs',
      dx: 'type:dx',
      testing: 'type:testing',
      ux: 'type:ux',
      performance: 'type:performance',
      ...(cfg.typeLabels || {}),
    },
  }
}

function ensureGhLabel(label: string): void {
  try {
    execFileSync(
      'gh',
      [
        'label',
        'create',
        label,
        '--color',
        'ededed',
        '--description',
        'Managed by TerMinal tickets',
      ],
      {
        cwd: repo(),
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
      },
    )
  } catch (e) {
    const msg = String((e as any).stderr || (e as Error).message || '')
    if (!/already exists/i.test(msg)) throw e
  }
}

function fileGithubIssue(
  title: string | undefined,
  body: string | undefined,
  cfg: GithubCfg,
): void {
  const maps = ghLabelMaps(cfg)
  const labels = [maps.priority.medium, maps.type.feature].filter(Boolean)
  for (const label of labels) ensureGhLabel(label)
  try {
    const args = ['issue', 'create', '--title', title || 'Untitled', '--body', body || '']
    if (labels.length) args.push('--label', labels.join(','))
    const url = execFileSync('gh', args, {
      cwd: repo(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    const id = (url.match(/\/issues\/(\d+)/) || [])[1] || ''
    emitActivity('ticket-filed', `Ticket filed · ${id ? `#${id}` : 'GitHub Issue'}`, title || '')
    console.log(url)
  } catch (e) {
    console.error(
      `terminal-cli ticket: gh issue create failed: ${String(
        (e as any).stderr || (e as Error).message || '',
      ).trim()}`,
    )
    process.exit(1)
  }
}
