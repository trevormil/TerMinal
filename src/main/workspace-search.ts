import { basename } from 'node:path'
import { backlogRel, listTickets } from './backlog'
import { listMrs } from './mrs'
import { readActivity } from './events'
import { listDocs, readDoc } from './docs'
import { searchRepo } from './files'
import { listAllRuns } from './cron-runs'
import { listPromptSnippets } from './snippets'
import { listPersistentAgentArtifacts, listPersistentAgents } from './persistent-agents'

export type WorkspaceSearchKind =
  | 'file'
  | 'ticket'
  | 'mr'
  | 'activity'
  | 'doc'
  | 'run'
  | 'snippet'
  | 'agent-artifact'

export type WorkspaceSearchResult = {
  id: string
  kind: WorkspaceSearchKind
  title: string
  subtitle?: string
  detail?: string
  path?: string
  line?: number
  ts?: number
  payload?: Record<string, unknown>
}

export type WorkspaceSearchResponse = {
  results: WorkspaceSearchResult[]
  error?: string
}

const ALL_KINDS: WorkspaceSearchKind[] = [
  'file',
  'ticket',
  'mr',
  'activity',
  'doc',
  'run',
  'snippet',
  'agent-artifact',
]
const MAX_RESULTS = 260
const MAX_PER_KIND = 60

const lc = (s: unknown) => String(s ?? '').toLowerCase()
const short = (s: unknown, n = 260) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const repoName = (repoRoot: string) => basename(repoRoot || '') || 'workspace'

function matches(query: string, ...parts: unknown[]): boolean {
  const q = query.toLowerCase()
  return parts.some((p) => lc(p).includes(q))
}

function selectedKinds(kinds?: WorkspaceSearchKind[]): Set<WorkspaceSearchKind> {
  const valid = new Set(ALL_KINDS)
  const picked = (kinds || ALL_KINDS).filter((k) => valid.has(k))
  return new Set(picked.length ? picked : ALL_KINDS)
}

function pushLimited(
  out: WorkspaceSearchResult[],
  counts: Map<WorkspaceSearchKind, number>,
  item: WorkspaceSearchResult,
) {
  if ((counts.get(item.kind) || 0) >= MAX_PER_KIND) return
  counts.set(item.kind, (counts.get(item.kind) || 0) + 1)
  out.push(item)
}

export async function workspaceSearch(
  repoRoot: string,
  query: string,
  kinds?: WorkspaceSearchKind[],
): Promise<WorkspaceSearchResponse> {
  const q = query.trim()
  if (q.length < 2) return { results: [] }

  const selected = selectedKinds(kinds)
  const results: WorkspaceSearchResult[] = []
  const counts = new Map<WorkspaceSearchKind, number>()
  const errors: string[] = []
  const rootName = repoName(repoRoot)

  if (selected.has('file')) {
    try {
      for (const h of await searchRepo(repoRoot, q)) {
        pushLimited(results, counts, {
          id: `file:${h.file}:${h.line}`,
          kind: 'file',
          title: `${h.file}:${h.line}`,
          subtitle: 'File',
          detail: h.text.trim(),
          path: h.file,
          line: h.line,
          payload: { path: h.file, line: h.line },
        })
      }
    } catch (e) {
      errors.push(`files: ${(e as Error).message}`)
    }
  }

  if (selected.has('ticket')) {
    try {
      for (const t of listTickets(repoRoot)) {
        if (!matches(q, t.id, t.title, t.status, t.priority, t.type, t.source, t.body, t.prs.join(' '))) continue
        pushLimited(results, counts, {
          id: `ticket:${t.slug}`,
          kind: 'ticket',
          title: `#${t.id} ${t.title}`,
          subtitle: `${t.status} - ${t.priority} - ${t.type}`,
          detail: short(t.body),
          path: `${backlogRel(repoRoot)}/${t.slug}.md`,
          payload: { slug: t.slug },
        })
      }
    } catch (e) {
      errors.push(`tickets: ${(e as Error).message}`)
    }
  }

  if (selected.has('mr')) {
    try {
      const { mrs, error } = await listMrs(repoRoot)
      if (error) errors.push(`MRs: ${error}`)
      for (const m of mrs) {
        if (!matches(q, m.iid, m.title, m.state, m.author, m.sourceBranch, m.labels.join(' '))) continue
        pushLimited(results, counts, {
          id: `mr:${m.iid}`,
          kind: 'mr',
          title: `MR/PR ${m.iid} ${m.title}`,
          subtitle: `${m.state} - ${m.author}`,
          detail: [m.sourceBranch, m.review?.verdict, m.labels.join(', ')].filter(Boolean).join(' - '),
          payload: { iid: m.iid },
        })
      }
    } catch (e) {
      errors.push(`MRs: ${(e as Error).message}`)
    }
  }

  if (selected.has('activity')) {
    try {
      for (const ev of readActivity(700)) {
        if (!matches(q, ev.title, ev.detail, ev.kind, ev.repo, ev.repoRoot, ev.sessionId, ev.runId)) continue
        pushLimited(results, counts, {
          id: `activity:${ev.id}`,
          kind: 'activity',
          title: ev.title,
          subtitle: `${ev.kind}${ev.repo ? ` - ${ev.repo}` : ''}`,
          detail: short(ev.detail),
          ts: ev.ts,
          payload: { runId: ev.runId, runSource: ev.runSource, ticket: ev.ref?.ticket, pr: ev.ref?.pr },
        })
      }
    } catch (e) {
      errors.push(`activity: ${(e as Error).message}`)
    }
  }

  if (selected.has('doc')) {
    try {
      const docs = listDocs(repoRoot).categories.flatMap((c) => c.items)
      for (const d of docs) {
        const body = readDoc(repoRoot, d.path)
        if (!matches(q, d.title, d.path, d.category, d.managedBy, d.subgroup, body)) continue
        pushLimited(results, counts, {
          id: `doc:${d.path}`,
          kind: 'doc',
          title: d.title,
          subtitle: `${d.category} - ${d.path}`,
          detail: short(body),
          path: d.path,
          payload: { path: d.path },
        })
      }
    } catch (e) {
      errors.push(`docs: ${(e as Error).message}`)
    }
  }

  if (selected.has('run')) {
    try {
      for (const r of listAllRuns(500)) {
        if (!matches(q, r.id, r.source, r.agentId, r.agentTitle, r.engine, r.status, r.repoLabel, r.repoRoot, r.branch, r.worktree, r.error)) continue
        pushLimited(results, counts, {
          id: `run:${r.source}:${r.id}`,
          kind: 'run',
          title: r.agentTitle || r.agentId || r.id,
          subtitle: `${r.source} - ${r.status} - ${r.repoLabel || rootName}`,
          detail: short([r.engine, r.branch, r.error].filter(Boolean).join(' - ')),
          ts: r.startedAt,
          payload: { runId: r.id, source: r.source },
        })
      }
    } catch (e) {
      errors.push(`runs: ${(e as Error).message}`)
    }
  }

  if (selected.has('snippet')) {
    try {
      for (const s of listPromptSnippets(repoRoot).snippets) {
        if (!matches(q, s.id, s.title, s.description, s.group, s.source, s.prompt)) continue
        pushLimited(results, counts, {
          id: `snippet:${s.id}`,
          kind: 'snippet',
          title: s.title,
          subtitle: `${s.group || 'Snippet'} - ${s.source || 'custom'}`,
          detail: short(s.description || s.prompt),
          payload: { id: s.id, prompt: s.prompt },
        })
      }
    } catch (e) {
      errors.push(`snippets: ${(e as Error).message}`)
    }
  }

  if (selected.has('agent-artifact')) {
    try {
      for (const agent of listPersistentAgents()) {
        for (const a of listPersistentAgentArtifacts(agent.id)) {
          const fileList = a.files.map((f) => f.path).join(' ')
          if (!matches(q, agent.id, agent.title, agent.description, a.id, a.title, a.kind, a.summary, a.path, fileList)) continue
          pushLimited(results, counts, {
            id: `agent-artifact:${agent.id}:${a.id}`,
            kind: 'agent-artifact',
            title: a.title,
            subtitle: `${agent.title} - ${a.kind}`,
            detail: short(a.summary || a.primaryPath || a.path),
            path: a.primaryPath || a.path,
            ts: a.createdAt,
            payload: { agentId: agent.id, artifactPath: a.primaryPath || a.path },
          })
        }
      }
    } catch (e) {
      errors.push(`agent artifacts: ${(e as Error).message}`)
    }
  }

  return { results: results.slice(0, MAX_RESULTS), error: errors.length ? errors.join(' - ') : undefined }
}
