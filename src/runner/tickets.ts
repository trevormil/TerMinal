// Best-effort backlog filing on the affected repo, so the factory can pick a
// cron failure up as work.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from './config'
import { log } from './log'
import { areaPath, areaPathsFor, maxAreaId, statePathForRead } from './repo-state'

// The user's LOCAL calendar day, not UTC. `toISOString().slice(0,10)` is the UTC
// date, so any evening edit west of UTC stamps TOMORROW. Must agree with
// src/main/local-day.ts: the app and this script write the same ticket
// `updated:` field, and a mismatch made them disagree by a day every evening.
export const localDay = (at = new Date()): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

export type TicketConfig = {
  provider?: string
  obsidian?: { vaultPath?: string; ticketsSubdir?: string }
}

// Ticket-provider config (.TerMinal/tickets.json). An Obsidian repo keeps its
// tickets in an external vault, and a provider that cannot be served from a
// script (linear/webview) must FAIL CLOSED rather than silently filing into a
// backlog nobody reads — misrouting a write is worse than refusing it
// (ADR-0015). Mirrors bin/terminal-cli and bin/terminal-mcp-server.
export function readTicketConfig(root: string): TicketConfig {
  // Personal config — sidecar first, legacy in-repo copy as fallback.
  return readJson<TicketConfig>(statePathForRead(root, 'tickets.json')) || {}
}

export function obsidianTicketsDir(cfg: TicketConfig | null): string | null {
  if (!cfg || cfg.provider !== 'obsidian' || !cfg.obsidian || !cfg.obsidian.vaultPath) return null
  const sub = String(cfg.obsidian.ticketsSubdir || 'tickets').replace(/^\/+|\/+$/g, '') || 'tickets'
  return join(cfg.obsidian.vaultPath, sub)
}

/** Where a ticket should be written, or null when the provider forbids it. */
export function ticketWriteDir(root: string): string | null {
  const cfg = readTicketConfig(root)
  const provider = String(cfg.provider || 'local').toLowerCase()
  if (provider === 'obsidian') return obsidianTicketsDir(cfg)
  if (provider === 'linear' || provider === 'webview' || provider === 'github') return null
  return areaPath(root, 'backlog')
}

export type TicketInput = { title: string; body: string; type?: string; priority?: string }

// Allocates NNNN by scanning the existing backlog folder's filenames; doesn't
// depend on the project-template's bin/next-ticket-id. Returns the ticket path
// on success, null otherwise.
export function fileTicket(repoRoot: string, input: TicketInput): string | null {
  const { title, body, type = 'bug', priority = 'high' } = input
  try {
    const backlogDir = ticketWriteDir(repoRoot)
    if (!backlogDir) return null // provider owns tickets elsewhere; refuse rather than misroute
    mkdirSync(backlogDir, { recursive: true })
    // Across every dir this repo reads from, so a fresh sidecar beside a repo
    // that still holds 0001-0042 does not restart at 0001.
    const maxId = maxAreaId(areaPathsFor(repoRoot, 'backlog').concat(backlogDir))
    const id = String(maxId + 1).padStart(4, '0')
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50) || 'cron-fail'
    const path = join(backlogDir, `${id}-${slug}.md`)
    const today = localDay()
    const fm = `---
id: ${id}
title: ${JSON.stringify(title)}
status: open
priority: ${priority}
type: ${type}
source: cron-fail
created: ${today}
updated: ${today}
---

${body}
`
    writeFileSync(path, fm)
    return path
  } catch (e) {
    log(`failed to file ticket on ${repoRoot}: ${e}`)
    return null
  }
}
