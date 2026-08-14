// READ tools: cross-session views (tickets, PRs, schedules, runs, spend).
// Each delegates to an existing on-disk shape and PROJECTS it — never spreading
// a whole record, because a run's error field or a schedule's prompt can be
// kilobytes the model did not ask for.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CFG, prsRoot, type Args } from './env'
import { backlogReadDirs, findRepoRoot, knownRepoRoots, parseFrontmatter } from './repo'
import { ticketAgentFromMeta } from './ticket-agents'

// --- tickets ---------------------------------------------------------------

type TicketFilter = { status?: string; type?: string; excludeClosed?: boolean }

function listTicketsForRoot(
  repoRoot: string,
  filter: TicketFilter,
  includeBody: boolean,
): Record<string, any>[] {
  const out: Record<string, any>[] = []
  for (const dir of backlogReadDirs(repoRoot)) {
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!/^\d{4}-.*\.md$/.test(f)) continue
      let raw: string
      try {
        raw = readFileSync(join(dir, f), 'utf8')
      } catch {
        continue
      }
      const { meta, body } = parseFrontmatter(raw)
      const slug = f.replace(/\.md$/, '')
      const runId = String(meta.agent_run_id || '').trim()
      const ticket: Record<string, any> = {
        slug,
        id: typeof meta.id === 'number' ? meta.id : parseInt(slug.slice(0, 4), 10),
        title: meta.title || slug,
        status: meta.status || 'open',
        priority: meta.priority || 'medium',
        type: meta.type || 'feature',
        horizon: meta.horizon || 'now',
        hitl: meta.hitl === true,
        created: meta.created,
        updated: meta.updated,
        prs: meta.prs || [],
        agent: ticketAgentFromMeta(meta),
        run: runId
          ? {
              id: runId,
              source: meta.agent_run_source || 'agent',
              sessionId: meta.agent_session_id || undefined,
              startedAt: meta.agent_run_started_at || undefined,
              status: meta.agent_run_status || undefined,
            }
          : undefined,
        repo: basename(repoRoot),
      }
      // Index view by default — body is omitted to keep list responses small;
      // fetch the full body on demand via get_ticket. include_body opts into a
      // short preview for callers that genuinely need it.
      if (includeBody) ticket.body = body.slice(0, 600)
      if (filter?.excludeClosed && ticket.status === 'closed') continue
      if (filter?.status && ticket.status !== filter.status) continue
      if (filter?.type && ticket.type !== filter.type) continue
      out.push(ticket)
    }
  }
  return out.sort((a, b) => a.id - b.id)
}

export function listTicketsTool(args: Args): Record<string, any>[] {
  const repo = args.repo
  const roots = repo ? [findRepoRoot(repo)].filter(Boolean) : knownRepoRoots()
  // Default to ACTIVE tickets (exclude closed — the workflow rarely needs
  // history, and closed is usually the bulk). status:'all' returns everything;
  // a specific status filters exactly to it.
  const statusArg = args.status
  const filter: TicketFilter = {
    type: args.type,
    status: statusArg && statusArg !== 'all' ? statusArg : undefined,
    excludeClosed: !statusArg,
  }
  const all = (roots as string[]).flatMap((r) =>
    listTicketsForRoot(r, filter, args.include_body === true),
  )
  return typeof args.limit === 'number' && args.limit > 0 ? all.slice(0, args.limit) : all
}

export function getTicketTool(args: Args): Record<string, any> | null {
  const slug = args.slug
  if (!slug) return null
  // Try every known repo until we find it
  for (const root of knownRepoRoots()) {
    const f = backlogReadDirs(root)
      .map((dir) => join(dir, `${slug}.md`))
      .find((p) => existsSync(p))
    if (f) {
      const raw = readFileSync(f, 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      return {
        slug,
        repo: basename(root),
        repoRoot: root,
        ...meta,
        body,
      }
    }
  }
  return null
}

// --- PRs / MRs (from optional harness prs/ artifact store) -----------------

export function listPrs(args: Args): Record<string, any>[] {
  const root = prsRoot()
  if (!root || !existsSync(root)) return []
  const out: Record<string, any>[] = []
  // prs/<host>/<owner>/<name>/<num>/meta.json
  const walk = (dir: string, depth = 0): void => {
    if (depth > 4) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (name === 'meta.json') {
        try {
          const meta = JSON.parse(readFileSync(p, 'utf8'))
          if (args.repo && !meta.repo?.toLowerCase().includes(args.repo.toLowerCase())) continue
          if (args.status && meta.state !== args.status) continue
          out.push({
            host: meta.host,
            repo: meta.repo,
            number: meta.number,
            title: meta.title,
            state: meta.state,
            webUrl: meta.webUrl,
            author: meta.author,
            updatedAt: meta.updatedAt,
            commits: (meta.commits || []).length,
          })
        } catch {
          /* a malformed meta.json is one PR missing, not a failed listing */
        }
      }
    }
  }
  walk(root)
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50)
}

export function getPrArtifact(args: Args): Record<string, any> | null {
  const { host, repo, number, sha } = args
  if (!host || !repo || !number) return null
  const root = prsRoot()
  if (!root) return null
  const dir = join(root, host, ...repo.split('/'), String(number))
  if (!existsSync(dir)) return null
  // Default sha = first commit in meta.json (newest)
  let targetSha = sha
  if (!targetSha) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
      targetSha = meta.commits?.[0]?.slice(0, 7)
    } catch {
      /* no meta.json — the caller must name a sha */
    }
  }
  if (!targetSha) return null
  const file = join(dir, `${targetSha}.md`)
  if (!existsSync(file)) return null
  const raw = readFileSync(file, 'utf8')
  const { meta, body } = parseFrontmatter(raw)
  return { host, repo, number, sha: targetSha, meta, body }
}

// --- schedules + agent runs -----------------------------------------------

export function listSchedules(args: Args): Record<string, any>[] {
  const sf = join(CFG(), 'schedules.json')
  if (!existsSync(sf)) return []
  try {
    const arr = JSON.parse(readFileSync(sf, 'utf8'))
    return (
      arr
        .filter(
          (s: any) => !args.repo || s.repoLabel?.toLowerCase().includes(args.repo.toLowerCase()),
        )
        // Drop the full prompt (often >1.5k chars) — keep a short preview; the
        // model rarely needs the whole prompt just to list schedules.
        .map((s: any) => ({
          id: s.id,
          agentId: s.agentId,
          agentTitle: s.agentTitle,
          repoLabel: s.repoLabel,
          spec: s.spec,
          engine: s.engine,
          enabled: s.enabled,
          lastStatus: s.lastStatus,
          lastRun: s.lastRun,
          promptPreview: typeof s.prompt === 'string' ? s.prompt.slice(0, 120) : undefined,
        }))
    )
  } catch {
    return []
  }
}

export function recentAgentRuns(args: Args): Record<string, any>[] {
  const out: Record<string, any>[] = []
  // cron-runs/
  const cronDir = join(CFG(), 'cron-runs')
  if (existsSync(cronDir)) {
    try {
      for (const f of readdirSync(cronDir)) {
        if (!f.endsWith('.json')) continue
        try {
          const r = JSON.parse(readFileSync(join(cronDir, f), 'utf8'))
          if (args.repo && !r.repoLabel?.toLowerCase().includes(args.repo.toLowerCase())) continue
          if (args.status && r.status !== args.status) continue
          // Project to a summary — never spread the whole run record (the
          // error field can be a large stack/log). Truncate error to a preview;
          // detail lives in the run file on disk.
          out.push({
            id: r.id,
            agentId: r.agentId,
            agentTitle: r.agentTitle,
            repoLabel: r.repoLabel,
            branch: r.branch,
            status: r.status,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            engine: r.engine,
            scheduleId: r.scheduleId,
            error: typeof r.error === 'string' ? r.error.slice(0, 200) : r.error,
            source: 'cron',
          })
        } catch {
          /* one unreadable run record must not fail the listing */
        }
      }
    } catch {
      /* no cron-runs dir */
    }
  }
  return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, args.limit || 50)
}

export function aiSpendToday(args: Args): {
  totalUsd: number
  totalRuns: number
  byModel: Record<string, number>
  byAgent: Record<string, number>
} {
  // Read ai-runs/ and roll up for today
  const dir = join(CFG(), 'ai-runs')
  if (!existsSync(dir)) return { totalUsd: 0, totalRuns: 0, byModel: {}, byAgent: {} }
  const dayStart = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  let totalUsd = 0
  let totalRuns = 0
  const byModel: Record<string, number> = {}
  const byAgent: Record<string, number> = {}
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        if ((r.startedAt || 0) < dayStart) continue
        if (args.repo) {
          const b = basename(r.repoRoot || '')
          if (!b.toLowerCase().includes(args.repo.toLowerCase())) continue
        }
        if (args.agent && r.agentId !== args.agent) continue
        totalUsd += r.costUsd || 0
        totalRuns++
        byModel[r.model] = (byModel[r.model] || 0) + (r.costUsd || 0)
        if (r.agentId) byAgent[r.agentId] = (byAgent[r.agentId] || 0) + (r.costUsd || 0)
      } catch {
        /* one unreadable run record must not fail the rollup */
      }
    }
  } catch {
    /* no ai-runs dir */
  }
  return { totalUsd, totalRuns, byModel, byAgent }
}
