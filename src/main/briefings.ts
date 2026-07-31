import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeJsonAtomic } from './atomic-write'
import { parseFrontmatter } from './frontmatter'

// The morning briefing — the one daily roll-up of what the overnight agents
// produced. The aggregator is itself a scheduled agent (see the `briefing`
// spec), so this module does NOT generate anything: it reads what the agent
// wrote, and records the human's verdict on each item.
//
// TWO WRITERS, TWO FILES. That separation is the whole design:
//
//   briefings/<date>.md            written ONLY by the agent, read-only here
//   briefings/<date>.verdicts.json written ONLY by the app
//
// The app never rewrites the agent's markdown. Round-tripping generated prose
// through a hand-rolled parser to flip one field is how you lose a briefing to
// a formatting edge case at 7am, and it makes the .md diffable and trustworthy
// as the durable record. It is the same "every writer appends, never parses"
// instinct as ADR-0012's ticket comment log.

export type BriefingItemKind =
  'pr' | 'ticket' | 'idea' | 'hitl' | 'run' | 'report' | 'lesson' | 'note'

const KINDS: BriefingItemKind[] = [
  'pr',
  'ticket',
  'idea',
  'hitl',
  'run',
  'report',
  'lesson',
  'note',
]

export type BriefingVerdict = 'promoted' | 'dismissed'

export type BriefingItem = {
  /** Stable within a briefing: `<kind>-<ordinal>`. Verdicts key off this, so
   *  it must not depend on anything the agent might reword between runs. */
  id: string
  kind: BriefingItemKind
  title: string
  detail?: string
  repo?: string
  /** Producing agent id. With `repo`, locates the agent-state ledger. */
  agent?: string
  /** Key in the producing agent's `proposedIdeas` ledger. Present only for
   *  items an agent PROPOSED; its presence is what enables dismiss write-back. */
  ledgerKey?: string
  /** URL, `ticket:<id>`, or `run:<id>`. */
  link?: string
  /** Tab id for `navigateTo` deep links. */
  nav?: string
  verdict?: BriefingVerdict
}

export type Briefing = {
  date: string
  path: string
  generated?: string
  status: string
  summary: string
  items: BriefingItem[]
}

const DEFAULT_BRIEFINGS_DIR = join(homedir(), '.config', 'TerMinal', 'briefings')
const DEFAULT_AGENT_STATE_DIR = join(homedir(), '.config', 'TerMinal', 'agent-state')

export function briefingsDir(): string {
  return process.env.TERMINAL_BRIEFINGS_DIR || DEFAULT_BRIEFINGS_DIR
}

function agentStateDir(): string {
  return process.env.TERMINAL_AGENT_STATE_DIR || DEFAULT_AGENT_STATE_DIR
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse the agent-authored briefing markdown.
 *
 * Item blocks look like:
 *
 *   ### [pr] Backfill 6 tests in ticket-provider
 *   - agent: coverage
 *   - repo: TerMinal
 *
 * An `### ` heading without a recognized `[kind]` tag is not an item — that is
 * how the agent is free to add its own prose subheadings without them showing
 * up as actionable rows. An unrecognized tag DOES become an item (as `note`),
 * because a typo'd kind should still surface rather than vanish silently.
 */
export function parseBriefing(md: string, date: string, path: string): Briefing {
  const { fm, body } = parseFrontmatter(md || '')
  const lines = body.split('\n')

  const items: BriefingItem[] = []
  const counts: Record<string, number> = {}
  const summaryLines: string[] = []
  let seenItemsHeading = false
  let current: BriefingItem | null = null

  for (const line of lines) {
    if (/^##\s+Items\s*$/i.test(line)) {
      seenItemsHeading = true
      current = null
      continue
    }

    const heading = line.match(/^###\s+\[([a-z-]+)\]\s+(.+?)\s*$/i)
    if (heading && seenItemsHeading) {
      const raw = heading[1].toLowerCase()
      const kind = (KINDS as string[]).includes(raw) ? (raw as BriefingItemKind) : 'note'
      const title = heading[2]
      // Content-derived, NOT positional. An ordinal id (`pr-2`) renames itself
      // the moment a re-run emits the items in a different order, so a verdict
      // recorded yesterday lands on a different row today — and if that row
      // carries a ledgerKey, Dismiss writes the WRONG key, permanently
      // suppressing an idea the human never rejected, with no audit trail.
      let id = `${kind}-${createHash('sha1').update(title).digest('hex').slice(0, 8)}`
      // Two identical (kind, title) pairs in one briefing would collide; suffix
      // the later ones so ids stay unique. Still deterministic for a given file.
      if (counts[id]) id = `${id}-${counts[id]}`
      counts[id] = (counts[id] || 0) + 1
      current = { id, kind, title }
      items.push(current)
      continue
    }
    if (/^#{1,3}\s/.test(line)) {
      current = null
      if (!seenItemsHeading) continue
    }

    if (current) {
      const field = line.match(/^-\s+([a-zA-Z]+):\s*(.*)$/)
      if (field) {
        const key = field[1]
        const val = field[2].trim()
        if (!val) continue
        if (key === 'detail') current.detail = val
        else if (key === 'repo') current.repo = val
        else if (key === 'agent') current.agent = val
        else if (key === 'ledgerKey') current.ledgerKey = val
        else if (key === 'link') current.link = val
        else if (key === 'nav') current.nav = val
      }
      continue
    }

    // Prose before the Items section is the human-facing summary.
    if (!seenItemsHeading && line.trim() && !line.startsWith('#')) summaryLines.push(line.trim())
  }

  return {
    date: typeof fm.date === 'string' && fm.date ? fm.date : date,
    path,
    generated: typeof fm.generated === 'string' ? fm.generated : undefined,
    status: typeof fm.status === 'string' && fm.status ? fm.status : 'ok',
    summary: summaryLines.join(' ').trim(),
    items,
  }
}

function verdictsPath(date: string): string {
  return join(briefingsDir(), `${date}.verdicts.json`)
}

function readVerdicts(date: string): Record<string, BriefingVerdict> {
  try {
    const raw = JSON.parse(readFileSync(verdictsPath(date), 'utf8'))
    // `typeof [] === 'object'`, and setting a string key on an array is dropped
    // by JSON.stringify — so an array-shaped file would swallow every verdict
    // while actOnBriefingItem still returned ok, the optimistic UI showed it,
    // and the next reload silently reverted it. Treat it as corrupt instead.
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, BriefingVerdict>)
      : {}
  } catch {
    return {}
  }
}

function loadBriefing(date: string): Briefing | null {
  if (!DATE_RE.test(date)) return null
  const path = join(briefingsDir(), `${date}.md`)
  if (!existsSync(path)) return null
  let md: string
  try {
    md = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const b = parseBriefing(md, date, path)
  const verdicts = readVerdicts(date)
  for (const item of b.items) if (verdicts[item.id]) item.verdict = verdicts[item.id]
  return b
}

/** Newest briefing by DATE, not by mtime — a re-run of an old day must not
 *  become "today". */
export function latestBriefing(): Briefing | null {
  let names: string[]
  try {
    names = readdirSync(briefingsDir())
  } catch {
    return null
  }
  const dates = names
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.slice(0, -3))
    .filter((d) => DATE_RE.test(d))
    .sort()
  for (let i = dates.length - 1; i >= 0; i--) {
    const b = loadBriefing(dates[i])
    if (b) return b
  }
  return null
}

export function listBriefingDates(limit = 30): string[] {
  try {
    return readdirSync(briefingsDir())
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.slice(0, -3))
      .filter((d) => DATE_RE.test(d))
      .sort()
      .reverse()
      .slice(0, limit)
  } catch {
    return []
  }
}

export function getBriefing(date: string): Briefing | null {
  return loadBriefing(date)
}

/**
 * Append a dismissal to the producing agent's ledger, closing the loop with the
 * dedup convention in `.agents/scripts.md`.
 *
 * This writes `<agent>.dismissed.json`, NOT the agent's own `<agent>.json`, and
 * that separation is load-bearing rather than tidy. Every writer here does a
 * read-modify-write of the whole document — there is no field-level update. If
 * both arrays shared a file, a 04:00 agent run and a 04:00 Dismiss tap would
 * each read it, each modify their own array, and each write the whole thing
 * back; the later write would silently revert the earlier one, losing a
 * just-filed idea or a just-recorded dismissal, and potentially reverting
 * `lastScannedSha` into a re-scan.
 *
 * One file per writer means the two processes touch disjoint paths, so the race
 * cannot happen at all. The agent reads this file directly (it is documented in
 * scripts.md); `terminal-cli state` never touches it.
 */
function appendDismissal(repo: string, agent: string, key: string): void {
  const dir = join(agentStateDir(), repo)
  const file = join(dir, `${agent}.dismissed.json`)
  let doc: Record<string, unknown> = {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) doc = raw
  } catch {
    /* first dismissal for this agent */
  }
  const existing = Array.isArray(doc.dismissed) ? (doc.dismissed as { key?: string }[]) : []
  if (existing.some((d) => d && d.key === key)) return
  doc.dismissed = [...existing, { key, at: Date.now() }]
  mkdirSync(dir, { recursive: true })
  writeJsonAtomic(file, doc)
}

export function actOnBriefingItem(
  date: string,
  itemId: string,
  verdict: BriefingVerdict,
): { ok: true } | { ok: false; error: string } {
  if (!DATE_RE.test(date)) return { ok: false, error: 'invalid date' }
  if (verdict !== 'promoted' && verdict !== 'dismissed')
    return { ok: false, error: 'invalid verdict' }

  const b = loadBriefing(date)
  if (!b) return { ok: false, error: `no briefing for ${date}` }
  const item = b.items.find((i) => i.id === itemId)
  if (!item) return { ok: false, error: `no item ${itemId} in ${date}` }

  const verdicts = readVerdicts(date)
  verdicts[itemId] = verdict
  try {
    mkdirSync(briefingsDir(), { recursive: true })
    writeJsonAtomic(verdictsPath(date), verdicts)
  } catch {
    return { ok: false, error: 'failed to record verdict' }
  }

  // Only a dismissal teaches the producing agent anything, and only when the
  // item carries a ledger key. Promotion needs no write-back: the agent already
  // knows it proposed the thing.
  if (verdict === 'dismissed' && item.ledgerKey && item.agent && item.repo) {
    try {
      appendDismissal(item.repo, item.agent, item.ledgerKey)
    } catch {
      // The verdict is already durable; a ledger failure must not lose it.
    }
  }
  return { ok: true }
}
