// ===========================================================================
// WRITE TOOLS — deterministic data filing. Agents skip reading SKILL.md.
// ===========================================================================
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { updateJsonListShared } from '../runner/state-io'
import { maxAreaId } from '../runner/repo-state'
import { ACTIVITY_FILE, CFG, HITL_FILE, type Args } from './env'
import {
  mirrorHitlToSlack,
  pingTelegram,
  slackApi,
  slackCfg,
  slackQuietsTelegram,
  trackEffect,
} from './notify'
import { backlogReadDirs, backlogWriteDir, findRepoRoot, knownRepoRoots } from './repo'
import { aiSpendToday } from './reads'
import {
  normalizeModelTier,
  normalizeTicketAgent,
  recommendTicketAgent,
  slugify,
  todayStr,
} from './ticket-agents'

// --- file_ticket ----------------------------------------------------------

export function fileTicket(args: Args): { slug: string; id: string; path: string } {
  const {
    repo,
    title,
    body = '',
    type = 'feature',
    priority = 'medium',
    status = 'open',
    source = 'mcp',
    modelTier = 'auto',
  } = args
  if (!title) throw new Error('title is required')
  const repoRoot = findRepoRoot(repo)
  if (!repoRoot) throw new Error(`no repo matching "${repo}"`)
  const backlogDir = backlogWriteDir(repoRoot)
  mkdirSync(backlogDir, { recursive: true })
  // Atomic-ish ID allocation via .next-id (matches bin/next-backlog-id semantics)
  const nextIdFile = join(backlogDir, '.next-id')
  let nextId = 1
  if (existsSync(nextIdFile)) {
    try {
      nextId = parseInt(readFileSync(nextIdFile, 'utf8').trim(), 10) || 1
    } catch {
      /* unreadable counter — the highest-id floor below still applies */
    }
  }
  // Never below the highest id that already exists ANYWHERE this repo reads
  // from: a fresh sidecar has no counter, and its neighbouring repo may still
  // hold 0001-0042 — allocating 0001 again would duplicate and shadow them.
  const highest = maxAreaId(backlogReadDirs(repoRoot).concat(backlogDir))
  nextId = Math.max(nextId, highest + 1)
  const id = String(nextId).padStart(4, '0')
  const slug = `${id}-${slugify(title)}`
  const today = todayStr()
  const recommendation = recommendTicketAgent({ title, type, body })
  const agent = normalizeTicketAgent(args, type, recommendation)
  const frontmatter = `---
id: ${nextId}
title: ${JSON.stringify(title)}
status: ${status}
priority: ${priority}
horizon: now
hitl: false
type: ${type}
source: ${source}
created: ${today}
updated: ${today}
prs: []
refs: []
depends_on: []
model_tier: ${normalizeModelTier(modelTier)}
agent_id: ${agent.id}
agent_scope: ${agent.scope}
agent_kind: ${agent.kind}
---

${body}
`
  const path = join(backlogDir, `${slug}.md`)
  writeFileSync(path, frontmatter)
  // Bump .next-id
  try {
    writeFileSync(nextIdFile, String(nextId + 1) + '\n')
  } catch {
    /* the highest-id floor covers a counter we could not write */
  }
  // Emit activity event so the harness picks it up
  emitActivityRaw({
    kind: 'ticket-filed',
    title: `Ticket filed · #${id}`,
    detail: title,
    repo: basename(repoRoot),
    repoRoot,
  })
  return { slug, id, path }
}

// --- update_ticket --------------------------------------------------------

function locateTicket(slug: string): { path: string; repoRoot: string } | null {
  let path: string | null = null
  let repoRoot: string | null = null
  for (const root of knownRepoRoots()) {
    const p = backlogReadDirs(root)
      .map((dir) => join(dir, `${slug}.md`))
      .find((candidate) => existsSync(candidate))
    if (p) {
      path = p
      repoRoot = root
      break
    }
  }
  return path ? { path, repoRoot: repoRoot as string } : null
}

/**
 * Append to a ticket's `## Log`. This is how a run leaves context for the next
 * one - findings, dead ends, decisions - without editing the ticket's prose.
 * Mirrors appendComment in src/main/ticket-comments.ts.
 */
export function commentTicket(args: Args): Record<string, any> {
  const { slug } = args
  if (!slug) throw new Error('slug is required')
  const body = String(args.body || '').trim()
  if (!body) throw new Error('body is required and cannot be empty')
  const located = locateTicket(slug)
  if (!located) throw new Error(`ticket ${slug} not found in any known repo`)
  const raw = readFileSync(located.path, 'utf8')
  const m = raw.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/)
  if (!m) throw new Error(`malformed frontmatter in ${located.path}`)
  const via = String(args.via || '').trim()
  const header = `### ${new Date().toISOString()} · agent:${String(args.author || 'agent').trim()}${
    via ? ` (${via})` : ''
  }`
  // Appending only needs to know whether a log has been opened, never to parse
  // one - so the parser stays in exactly one place.
  const prose = m[2].trim()
  const head = m[1].replace(/^(updated:[ \t]*).*$/m, `$1${todayStr()}`)
  const next = /^## Log$/m.test(m[2])
    ? `${head}\n${prose}\n\n${header}\n${body}\n`
    : `${head}\n${prose ? `${prose}\n\n` : ''}## Log\n\n${header}\n${body}\n`
  writeFileSync(located.path, next)
  return { ok: true, slug, path: located.path, repoRoot: located.repoRoot }
}

export function updateTicket(args: Args): Record<string, any> {
  const { slug, status, priority, appendPrUrl, removePrUrl } = args
  if (!slug) throw new Error('slug is required')
  const located = locateTicket(slug)
  if (!located) throw new Error(`ticket ${slug} not found in any known repo`)
  const { path, repoRoot } = located
  const raw = readFileSync(path, 'utf8')
  const m = raw.match(/^(---\n[\s\S]*?\n---)([\s\S]*)$/)
  if (!m) throw new Error(`malformed frontmatter in ${path}`)
  let fm = m[1]
  const currentStatus = (fm.match(/^status:\s*(.*)$/m)?.[1] || '').trim()
  const currentTitle = (fm.match(/^title:\s*(.*)$/m)?.[1] || slug)
    .trim()
    .replace(/^["']|["']$/g, '')
  const ticketLabel = (fm.match(/^id:\s*(\d+)/m)?.[1] || slug).trim()
  const setField = (key: string, val: string): void => {
    const re = new RegExp(`^(${key}:[ \\t]*).*$`, 'm')
    if (re.test(fm)) fm = fm.replace(re, `$1${val}`)
    else fm = fm.replace(/\n---$/, `\n${key}: ${val}\n---`)
  }
  if (status) setField('status', status)
  if (priority) setField('priority', priority)
  if (args.modelTier) setField('model_tier', normalizeModelTier(args.modelTier))
  if (Array.isArray(args.related)) setField('related', `[${args.related.join(', ')}]`)
  // 0 clears the link; anything else sets it. `undefined` leaves it untouched.
  if (args.duplicateOf !== undefined)
    setField('duplicate_of', Number(args.duplicateOf) > 0 ? String(args.duplicateOf) : '')
  if (args.agentId || args.agentScope || args.agentKind) {
    const agent = normalizeTicketAgent(args, (fm.match(/^type:\s*(.*)$/m)?.[1] || 'feature').trim())
    setField('agent_id', agent.id)
    setField('agent_scope', agent.scope)
    setField('agent_kind', agent.kind)
  }
  if (args.runId) {
    setField('agent_run_id', args.runId)
    setField('agent_run_source', args.runSource || 'agent')
    if (args.sessionId) setField('agent_session_id', args.sessionId)
    if (args.runStartedAt) setField('agent_run_started_at', args.runStartedAt)
    if (args.runStatus) setField('agent_run_status', args.runStatus)
  }
  setField('updated', todayStr())
  // PR URL list manipulation — `prs:` is a YAML inline list
  if (appendPrUrl || removePrUrl) {
    const prsMatch = fm.match(/^prs:\s*(.*)$/m)
    let prs: string[] = []
    if (prsMatch) {
      const rawPrs = prsMatch[1].trim()
      if (rawPrs.startsWith('[') && rawPrs.endsWith(']')) {
        prs = rawPrs
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      }
    }
    if (appendPrUrl && !prs.includes(appendPrUrl)) prs.push(appendPrUrl)
    if (removePrUrl) prs = prs.filter((p) => p !== removePrUrl)
    const formatted = `[${prs.map((p) => JSON.stringify(p)).join(', ')}]`
    if (prsMatch) fm = fm.replace(/^prs:\s*.*$/m, `prs: ${formatted}`)
    else fm = fm.replace(/\n---$/, `\nprs: ${formatted}\n---`)
  }
  writeFileSync(path, fm + m[2])
  if (status) {
    const unblocked = currentStatus === 'stuck' && status !== 'stuck'
    emitActivityRaw({
      kind: status === 'closed' ? 'ticket-closed' : 'info',
      title: unblocked
        ? `Ticket unblocked · #${ticketLabel}`
        : `Ticket ${status} · #${ticketLabel}`,
      detail: unblocked ? `${currentTitle} · ${status}` : currentTitle,
      repo: basename(repoRoot),
      repoRoot,
    })
  }
  return { ok: true, path }
}

export function updateTicketAgent(args: Args): Record<string, any> {
  const { slug } = args
  if (!slug) throw new Error('slug is required')
  if (!args.agentId) throw new Error('agentId is required')
  return updateTicket(args)
}

export function updateTicketRun(args: Args): Record<string, any> {
  if (!args.slug) throw new Error('slug is required')
  if (!args.runId) throw new Error('runId is required')
  return updateTicket(args)
}

// Category normalization (ticket 120). Deliberately NOT the app's
// `normalizeCategory` from src/shared/inbox-categories.ts: that one also splits
// nested `A/B` paths, and adopting it here would change what this tool writes.
// Canonical impl + tests: src/shared/inbox-categories.ts — keep in sync.
export function normalizeCategoryShared(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return clean ? clean.slice(0, 40) : undefined
}

// --- file_hitl ------------------------------------------------------------

export function fileHitlTool(args: Args): { id: string } {
  const {
    title,
    action,
    detail,
    repo,
    source = 'agent',
    runId,
    ticketPath,
    severity,
    category,
  } = args
  if (!title) throw new Error('title is required')
  mkdirSync(CFG(), { recursive: true })
  const hitlFile = HITL_FILE()
  const item: Record<string, any> = {
    id: randomUUID(),
    title,
    action,
    detail,
    repo,
    source,
    status: 'open',
    createdAt: Date.now(),
    ...(normalizeCategoryShared(category) ? { category: normalizeCategoryShared(category) } : {}),
    ...(severity === 'urgent' || severity === 'normal' || severity === 'low' ? { severity } : {}),
    runId,
    ticketPath,
    sessionId: process.env.GT_TERMINAL_SESSION_ID || undefined,
    terminalKey: process.env.GT_TERMINAL_SESSION_KEY || undefined,
    terminalCwd: process.env.GT_TERMINAL_CWD || undefined,
  }
  // Locked read-modify-write: the app, cron and the CLI all mutate this file
  // and take the same advisory lock. Writing through them is what manufactures
  // the torn read that makes THEM quarantine the inbox and refuse (ticket 110).
  updateJsonListShared<Record<string, any>>(hitlFile, (cur) => [item, ...cur])
  mirrorHitlToSlack(item, hitlFile)
  emitActivityRaw({
    kind: 'blocked',
    title: `Inbox · ${title}`,
    detail: action || detail || '',
    repo,
    hitlId: item.id,
    runId,
    suppressTelegram: true,
  })
  const row: unknown[] = [{ text: '✅ Resolve', callback_data: `hitl:resolve:${item.id}` }]
  if (runId) row.push({ text: '🪵 Tail run', callback_data: `run:tail:${runId}` })
  if (!slackQuietsTelegram())
    pingTelegram(`⛔ Inbox · ${title}${action ? ` — ${action}` : ''}`, [row])
  return { id: item.id }
}

// --- resolve_hitl ---------------------------------------------------------

export function resolveHitlTool(args: Args): { ok: boolean } {
  const { id, resolved = true } = args
  if (!id) throw new Error('id is required')
  const hitlFile = HITL_FILE()
  // The find and the write must happen under ONE lock, or the index found here
  // can address a different item by the time we write it back.
  let updated: Record<string, any> | null = null
  let wasOpen = false
  const wrote = updateJsonListShared<Record<string, any>>(hitlFile, (cur) => {
    const idx = cur.findIndex((h) => h.id === id)
    if (idx < 0) return undefined
    wasOpen = cur[idx].status === 'open'
    updated = {
      ...cur[idx],
      status: resolved ? 'resolved' : 'open',
      resolvedAt: resolved ? Date.now() : undefined,
    }
    const next = cur.slice()
    next[idx] = updated
    return next
  })
  if (!wrote || !updated) return { ok: false }
  const item = updated as Record<string, any>
  if (resolved && wasOpen) {
    // Mirror the app's resolveHitl: a resolve stamps the checkmark on the
    // item's Slack message, whichever surface the resolve came from. Slack's
    // already_reacted error is success for our purposes; all best-effort.
    if (item.slackChannel && item.slackTs) {
      const cfg = slackCfg()
      if (cfg)
        // Not awaited on purpose — drained by the stdin-end handler.
        void trackEffect(
          slackApi(cfg.botToken, 'reactions.add', {
            channel: item.slackChannel,
            timestamp: item.slackTs,
            name: 'white_check_mark',
          }).catch(() => {}),
        )
    }
    emitActivityRaw({
      kind: 'task-complete',
      title: `Inbox resolved · ${item.title || 'Untitled'}`,
      detail: item.action || item.detail || '',
      repo: item.repo,
      repoRoot: item.repoRoot,
      hitlId: item.id,
      runId: item.runId,
    })
  }
  return { ok: true }
}

// --- emit_activity --------------------------------------------------------

export function emitActivityRaw({
  kind,
  title,
  detail,
  repo,
  repoRoot,
  hitlId,
  runId,
  suppressTelegram,
}: Args): Record<string, any> {
  mkdirSync(CFG(), { recursive: true })
  const file = ACTIVITY_FILE()
  const ev = {
    id: randomUUID(),
    ts: Date.now(),
    kind: kind || 'info',
    title: title || '',
    detail: detail || '',
    repo: repo || '',
    repoRoot: repoRoot || '',
    ...(hitlId ? { hitlId } : {}),
    ...(runId ? { runId, runSource: 'agent' } : {}),
    ...(suppressTelegram ? { suppressTelegram: true } : {}),
  }
  try {
    appendFileSync(file, JSON.stringify(ev) + '\n')
  } catch {
    /* an unwritable feed must not fail the filing it describes */
  }
  return ev
}

export function emitActivityTool(args: Args): { ok: boolean } {
  emitActivityRaw(args)
  return { ok: true }
}

// --- set_agent_state / get_agent_state -----------------------------------

function stateFilePath(repoArg: string | undefined, agentId: string | undefined): string {
  if (!repoArg) throw new Error('repo is required')
  if (!agentId) throw new Error('agent is required')
  const root = findRepoRoot(repoArg)
  const slug = root ? basename(root) : repoArg
  return join(CFG(), 'agent-state', slug, `${agentId}.json`)
}

export function setAgentStateTool(args: Args): { ok: boolean } {
  const { repo, agent, key, value } = args
  if (!key) throw new Error('key is required')
  const file = stateFilePath(repo, agent)
  mkdirSync(dirname(file), { recursive: true })
  let state: Record<string, any> = {}
  try {
    if (existsSync(file)) state = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    /* unparseable state resets rather than blocking the write */
  }
  state[key] = value
  state.lastRunAt = Date.now()
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n')
  return { ok: true }
}

export function getAgentStateTool(args: Args): Record<string, any> {
  const { repo, agent, key } = args
  const file = stateFilePath(repo, agent)
  if (!existsSync(file)) return key ? { value: null } : { state: {} }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    return key ? { value: s[key] ?? null } : { state: s }
  } catch {
    return key ? { value: null } : { state: {} }
  }
}

// --- list_activity --------------------------------------------------------

export function listActivityTool(args: Args): Record<string, any>[] {
  const { kind, repo, sinceMs, limit = 50 } = args || {}
  const file = ACTIVITY_FILE()
  if (!existsSync(file)) return []
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const events: Record<string, any>[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      if (kind && ev.kind !== kind) continue
      if (repo && !(ev.repo || '').toLowerCase().includes(repo.toLowerCase())) continue
      if (sinceMs && ev.ts < sinceMs) continue
      events.push(ev)
    } catch {
      /* a torn line is one event lost, not a failed listing */
    }
  }
  return (
    events
      .slice(-limit)
      .reverse()
      // Drop internal fields (repoRoot, suppressTelegram); truncate detail.
      .map((ev) => ({
        id: ev.id,
        ts: ev.ts,
        kind: ev.kind,
        title: ev.title,
        detail: typeof ev.detail === 'string' ? ev.detail.slice(0, 200) : ev.detail,
        repo: ev.repo,
      }))
  )
}

// --- list_hitl ------------------------------------------------------------

export function listHitlTool(args: Args): Record<string, any>[] {
  const { status = 'open', repo, limit = 50 } = args || {}
  const file = HITL_FILE()
  if (!existsSync(file)) return []
  try {
    const arr = JSON.parse(readFileSync(file, 'utf8'))
    return (
      arr
        .filter((h: any) => (status === 'all' ? true : h.status === status))
        .filter((h: any) => !repo || (h.repo || '').toLowerCase().includes(repo.toLowerCase()))
        .slice(0, limit)
        // Project to what an agent needs — drop session/terminal plumbing
        // (sessionId, terminalKey, terminalCwd, transcriptPath, repoRoot).
        .map((h: any) => ({
          id: h.id,
          title: h.title,
          action: h.action,
          detail: typeof h.detail === 'string' ? h.detail.slice(0, 300) : h.detail,
          repo: h.repo,
          source: h.source,
          status: h.status,
          createdAt: h.createdAt,
          resolvedAt: h.resolvedAt,
        }))
    )
  } catch {
    return []
  }
}

// --- list_bg_tasks --------------------------------------------------------

export function listBgTasksTool(args: Args): Record<string, any>[] {
  const { status, repo, limit = 20 } = args || {}
  const file = join(CFG(), 'bg-tasks.json')
  if (!existsSync(file)) return []
  try {
    const arr = JSON.parse(readFileSync(file, 'utf8'))
    return arr
      .filter((t: any) => !status || t.status === status)
      .filter((t: any) => !repo || (t.repo || '').toLowerCase().includes(repo.toLowerCase()))
      .slice(0, limit)
  } catch {
    return []
  }
}

// --- harness_status -------------------------------------------------------

export function harnessStatusTool(): Record<string, any> {
  const hitlFile = HITL_FILE()
  let hitlOpen = 0
  try {
    if (existsSync(hitlFile)) {
      const arr = JSON.parse(readFileSync(hitlFile, 'utf8'))
      hitlOpen = arr.filter((h: any) => h.status === 'open').length
    }
  } catch {
    /* an unreadable inbox reports zero rather than failing the rollup */
  }
  const cronDir = join(CFG(), 'cron-runs')
  let cronRunning = 0
  let cronFailed24h = 0
  if (existsSync(cronDir)) {
    const dayAgo = Date.now() - 86_400_000
    try {
      for (const f of readdirSync(cronDir)) {
        if (!f.endsWith('.json')) continue
        try {
          const r = JSON.parse(readFileSync(join(cronDir, f), 'utf8'))
          if (r.status === 'running') cronRunning++
          if (r.status === 'failed' && r.startedAt >= dayAgo) cronFailed24h++
        } catch {
          /* skip one unreadable run */
        }
      }
    } catch {
      /* no cron-runs dir */
    }
  }
  let bgRunning = 0
  try {
    const bf = join(CFG(), 'bg-tasks.json')
    if (existsSync(bf)) {
      const arr = JSON.parse(readFileSync(bf, 'utf8'))
      bgRunning = arr.filter((t: any) => t.status === 'running').length
    }
  } catch {
    /* same */
  }
  const spend = aiSpendToday({})
  return {
    hitlOpen,
    cronRunning,
    cronFailed24h,
    bgRunning,
    spendTodayUsd: spend.totalUsd,
    spendByModel: spend.byModel,
  }
}

// --- set_run_outcome ------------------------------------------------------

export function setRunOutcomeTool(args: Args): Record<string, any> {
  const { runId, outcome } = args
  if (!runId || !outcome) throw new Error('runId and outcome are required')
  const dir = join(CFG(), 'ai-runs')
  if (!existsSync(dir)) return { ok: false, reason: 'no ai-runs/ dir' }
  // Find the AIRun by runId (the harness id), not the AIRun file's own id
  let updated = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const path = join(dir, f)
    try {
      const r = JSON.parse(readFileSync(path, 'utf8'))
      if (r.runId === runId) {
        r.outcome = outcome
        writeFileSync(path, JSON.stringify(r, null, 2))
        updated++
      }
    } catch {
      /* skip one unreadable run */
    }
  }
  return { ok: updated > 0, updated }
}
