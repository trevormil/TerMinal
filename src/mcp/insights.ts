// Cross-repo introspection: review patterns, factory health, decision search,
// git-log digests and nearest Claude session transcripts.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { configuredHarnessDir, prsRoot, type Args } from './env'
import { backlogReadDirs, findRepoRoot, knownRepoRoots, parseFrontmatter } from './repo'

// --- list_review_patterns: read <harnessDir>/reports/review-patterns.md
export function listReviewPatternsTool(args: Args): Record<string, any> {
  const harness = configuredHarnessDir()
  if (!harness) return { error: 'no harnessDir configured in ~/.config/TerMinal/settings.json' }
  const path = join(harness, 'reports', 'review-patterns.md')
  if (!existsSync(path))
    return { error: 'no review patterns report yet; runs nightly via bin/review-findings-mine' }
  const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : 10
  const raw = readFileSync(path, 'utf8')
  // Each cluster is a `## ` heading block. Parse heading + first 3 list items
  // (representative tokens + count + N-repos) into an array.
  const out: { title: string; summary: string }[] = []
  const sections = raw.split(/^## /m).slice(1)
  for (const sec of sections) {
    const lines = sec.split('\n')
    const title = (lines[0] || '').trim()
    const meta = lines
      .slice(1, 12)
      .filter((l) => l.trim())
      .slice(0, 8)
    out.push({ title, summary: meta.join('\n') })
    if (out.length >= limit) break
  }
  return { count: out.length, patterns: out }
}

// --- factory_health: cross-repo rollup from per-repo state files ----------
export function factoryHealthTool(): Record<string, any> {
  const out: Record<string, any>[] = []
  for (const root of knownRepoRoots()) {
    const repo = basename(root)
    const repoOut = {
      repo,
      ticketCounts: { open: 0, inProgress: 0, closed: 0, stuck: 0, icebox: 0 },
      openPrs: 0,
    }
    // Tickets
    const backlogs = backlogReadDirs(root)
    for (const backlog of backlogs) {
      try {
        for (const f of readdirSync(backlog)) {
          if (!/^\d{4}-.*\.md$/.test(f)) continue
          try {
            const { meta } = parseFrontmatter(readFileSync(join(backlog, f), 'utf8'))
            const s = meta.status || 'open'
            if (s === 'open') repoOut.ticketCounts.open++
            else if (s === 'in-progress') repoOut.ticketCounts.inProgress++
            else if (s === 'closed') repoOut.ticketCounts.closed++
            else if (s === 'stuck') repoOut.ticketCounts.stuck++
            else if (s === 'icebox') repoOut.ticketCounts.icebox++
          } catch {
            /* skip one unreadable ticket */
          }
        }
      } catch {
        /* unreadable backlog dir */
      }
    }
    out.push(repoOut)
  }
  // Open PR count (from prs/cache.json)
  try {
    const root = prsRoot()
    if (!root) return { repos: out.sort((a, b) => b.ticketCounts.open - a.ticketCounts.open) }
    const cf = join(root, 'cache.json')
    if (existsSync(cf)) {
      const cache = JSON.parse(readFileSync(cf, 'utf8'))
      const prs = Array.isArray(cache?.prs) ? cache.prs : []
      for (const pr of prs) {
        const repoBase = basename(String(pr.repo || ''))
        const r = out.find((x) => x.repo === repoBase || pr.repo?.endsWith(x.repo))
        if (r && (pr.state || '').toLowerCase() === 'open') r.openPrs++
      }
    }
  } catch {
    /* no PR cache — the ticket rollup still stands */
  }
  return { repos: out.sort((a, b) => b.ticketCounts.open - a.ticketCounts.open) }
}

// --- search_decisions: grep docs/decisions + docs/learnings for a query ---
export function searchDecisionsTool(args: Args): Record<string, any> {
  const q = (args?.query || '').trim().toLowerCase()
  if (!q) return { error: 'query is required' }
  const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : 20
  const repoArg = args?.repo
  const roots = repoArg ? [findRepoRoot(repoArg)].filter(Boolean) : knownRepoRoots()
  const out: Record<string, any>[] = []
  for (const root of roots as string[]) {
    for (const sub of ['docs/decisions', 'docs/learnings', 'docs/runbooks']) {
      const dir = join(root, sub)
      if (!existsSync(dir)) continue
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const f of entries) {
        if (!f.endsWith('.md')) continue
        const path = join(dir, f)
        let raw: string
        try {
          raw = readFileSync(path, 'utf8')
        } catch {
          continue
        }
        const lower = raw.toLowerCase()
        if (!lower.includes(q)) continue
        const { meta } = parseFrontmatter(raw)
        // First matching line (with a few chars context) for the snippet
        const idx = lower.indexOf(q)
        const lineStart = lower.lastIndexOf('\n', idx) + 1
        const lineEnd = lower.indexOf('\n', idx)
        const snippet = raw.slice(lineStart, lineEnd > 0 ? lineEnd : lineStart + 200)
        out.push({
          repo: basename(root),
          path: path.replace(homedir(), '~'),
          kind: sub.split('/')[1], // decisions|learnings|runbooks
          title: meta.title || f.replace(/\.md$/, ''),
          status: meta.status,
          tags: meta.tags,
          snippet: snippet.trim().slice(0, 200),
        })
        if (out.length >= limit) return { count: out.length, hits: out }
      }
    }
  }
  return { count: out.length, hits: out }
}

// --- recent_changes: git log digest for a repo since N days ago -----------
export function recentChangesTool(args: Args): Record<string, any> {
  const root = args?.repo ? findRepoRoot(args.repo) : process.env.TERMINAL_REPO || null
  if (!root) return { error: 'unknown repo; pass repo=<basename> or set TERMINAL_REPO' }
  const days = typeof args?.days === 'number' ? Math.max(1, Math.min(90, args.days)) : 7
  const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(200, args.limit)) : 50
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        root,
        'log',
        `--since=${days} days ago`,
        `-n`,
        String(limit),
        '--pretty=format:%h|%an|%ar|%s',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const commits = out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, author, when, ...subjectParts] = line.split('|')
        return { sha, author, when, subject: subjectParts.join('|') }
      })
    return { repo: basename(root), days, count: commits.length, commits }
  } catch (e) {
    return { error: `git log failed: ${(e as Error).message}` }
  }
}

// --- nearest_session: find recent Claude session transcripts for a repo ---
export function nearestSessionTool(args: Args): Record<string, any> {
  const root = args?.repo ? findRepoRoot(args.repo) : process.env.TERMINAL_REPO || null
  if (!root) return { error: 'unknown repo; pass repo=<basename> or set TERMINAL_REPO' }
  const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(20, args.limit)) : 5
  // Claude transcript naming convention: dir slugifies the cwd path.
  const slug = '-' + root.replace(/^\//, '').replace(/\//g, '-')
  const dir = join(homedir(), '.claude', 'projects', slug)
  if (!existsSync(dir))
    return {
      repo: basename(root),
      sessions: [],
      hint: `no transcript dir at ~/.claude/projects/${slug}`,
    }
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return { error: `cannot read ${dir}` }
  }
  const sessions = (
    files
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const path = join(dir, f)
        let stat
        try {
          stat = statSync(path)
        } catch {
          return null
        }
        return {
          id: f.replace(/\.jsonl$/, ''),
          modifiedMs: stat.mtimeMs,
          sizeBytes: stat.size,
          path: path.replace(homedir(), '~'),
        }
      })
      .filter(Boolean) as { id: string; modifiedMs: number; sizeBytes: number; path: string }[]
  )
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, limit)
  return { repo: basename(root), count: sessions.length, sessions }
}
