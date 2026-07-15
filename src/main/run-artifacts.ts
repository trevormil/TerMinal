import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Surfaces the artifacts a run produced (#8 GH-parity — the "Artifacts" tab).
// Agent-request artifacts are written under <repoRoot>/.TerMinal/agent-requests/
// <slug>/ (report.md + artifact.json) by the request_agent_artifact tool. We list
// them per-repo, newest first, so the Runs detail pane can link straight to a
// report. (Remote/host artifacts live on the host — local runs only for now.)

export type RunArtifact = {
  slug: string
  title: string
  agent?: string
  ok?: boolean
  createdAt?: string
  reportPath: string
  summary?: string
}

// Parse one artifact.json into a RunArtifact. Pure (no fs) → unit-testable.
// Falls back to the conventional report.md path when `primaryPath` is absent.
export function parseArtifactMeta(
  raw: string,
  slug: string,
  fallbackReport: string,
): RunArtifact | null {
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    return {
      slug,
      title: typeof m.title === 'string' && m.title ? m.title : slug,
      agent: typeof m.agent === 'string' ? m.agent : undefined,
      ok: typeof m.ok === 'boolean' ? m.ok : undefined,
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : undefined,
      reportPath:
        typeof m.primaryPath === 'string' && m.primaryPath ? m.primaryPath : fallbackReport,
      summary: typeof m.summary === 'string' ? m.summary : undefined,
    }
  } catch {
    return null
  }
}

// List a repo's agent-request artifacts, newest first. Best-effort; [] on any error.
export function listRepoArtifacts(repoRoot: string): RunArtifact[] {
  if (!repoRoot) return []
  const dir = join(repoRoot, '.TerMinal', 'agent-requests')
  let slugs: string[] = []
  try {
    slugs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
  const out: RunArtifact[] = []
  for (const slug of slugs) {
    const reportPath = join(dir, slug, 'report.md')
    let a: RunArtifact | null = null
    try {
      a = parseArtifactMeta(
        readFileSync(join(dir, slug, 'artifact.json'), 'utf8'),
        slug,
        reportPath,
      )
    } catch {
      /* no artifact.json — still surface the report if it exists */
      try {
        statSync(reportPath)
        a = { slug, title: slug, reportPath }
      } catch {
        /* nothing here */
      }
    }
    if (a) out.push(a)
  }
  // Newest first by createdAt (ISO strings sort lexicographically); undefined last.
  return out.sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))
}
