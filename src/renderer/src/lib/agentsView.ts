import type { BadgeTone } from '../components/ui'
import type {
  Agent,
  AgentDefinition,
  PersistentAgent,
  PersistentArtifact,
} from './types'
import { relativeTime } from './time'

// Pure view-logic for the Agents tab: formatting, roster filtering, run
// rollups, and the derivations the list/detail panes render through. Kept out
// of the components so the shaping is unit-testable without a DOM.

/** ms → "820ms" / "4.2s" / "3m 5s" / "1h 2m". "—" for nonsense input. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

/** Byte count → "512 B" / "1.5 KB" / "2.0 MB". Empty string for nonsense. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The ultra-compact age used in the run rows ("12s" / "5m" / "3h") — no "ago"
 * suffix, unlike `relativeTime`, because the column header already says when.
 */
export function shortAge(ts: number, now: number = Date.now()): string {
  const s = (now - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

/** Agent-run status → badge tone. */
export const runStatusTone = (s: string): BadgeTone =>
  s === 'done'
    ? 'green'
    : s === 'failed'
      ? 'red'
      : s === 'interrupted'
        ? 'yellow'
        : s === 'canceled'
          ? 'mute'
          : 'blue'

/** The four model-policy slots shown in the agent profile card. */
export function modelPolicyRows(
  definition: AgentDefinition,
): { label: string; value: string; tone: BadgeTone }[] {
  const policy = definition.runtime.modelPolicy || {}
  return [
    {
      label: 'Default',
      value: policy.default || definition.runtime.model || 'Engine default',
      tone: 'blue',
    },
    { label: 'Cheap', value: policy.cheap || 'Not set', tone: 'mute' },
    { label: 'Deep', value: policy.deep || 'Not set', tone: 'accent' },
    {
      label: 'Judge',
      value: policy.judge || definition.quality.judge?.model || 'Not set',
      tone: 'yellow',
    },
  ]
}

/** CodeMirror language key for an agent-scoped file, by extension. */
const AGENT_FILE_EXT: Record<string, string> = {
  md: 'markdown',
  mdx: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  js: 'js',
  ts: 'ts',
  tsx: 'tsx',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  py: 'py',
  toml: 'toml',
  txt: '',
}
export function agentFileLangKey(path: string): string {
  return AGENT_FILE_EXT[path.split('.').pop()?.toLowerCase() || ''] || ''
}

/** Roster search over the unified definition list (all-kinds mode). */
export function filterDefinitions(
  definitions: AgentDefinition[],
  search: string,
): AgentDefinition[] {
  const q = search.trim().toLowerCase()
  if (!q) return definitions.slice()
  return definitions.filter(
    (d) =>
      d.ref.id.toLowerCase().includes(q) ||
      d.title.toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q) ||
      (d.metadata.tags || []).join(' ').toLowerCase().includes(q),
  )
}

export type AgentScopeFilter = 'all' | 'generic' | 'per-repo'

/** Roster scope filter + search over classic agents. */
export function filterClassicAgents(
  agents: Agent[],
  scope: AgentScopeFilter,
  search: string,
): Agent[] {
  const q = search.trim().toLowerCase()
  return agents
    .filter((a) => {
      if (scope === 'generic') return a.source === 'default'
      if (scope === 'per-repo') return a.source === 'repo-override' || a.source === 'repo'
      return true
    })
    .filter(
      (a) =>
        !q ||
        a.id.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q),
    )
}

/** Search over the persistent-agent rail (title / id / description / tags). */
export function filterPersistentAgents(
  agents: PersistentAgent[],
  search: string,
): PersistentAgent[] {
  const q = search.trim().toLowerCase()
  if (!q) return agents.slice()
  return agents.filter((a) =>
    [a.title, a.id, a.description || '', a.tags.join(' ')].some((v) => v.toLowerCase().includes(q)),
  )
}

export type UnifiedRunRow = {
  id: string
  agentId: string
  status: string
  startedAt: number
  endedAt?: number
}

/**
 * Latest run per agent across cron + in-process. `runs` arrives startedAt-desc,
 * so the first hit per agent wins.
 */
export function lastRunByAgent(
  runs: UnifiedRunRow[],
): Map<string, { status: string; startedAt: number }> {
  const m = new Map<string, { status: string; startedAt: number }>()
  for (const r of runs) {
    if (!m.has(r.agentId)) m.set(r.agentId, { status: r.status, startedAt: r.startedAt })
  }
  return m
}

export type StatusDot = { dot: string; dotTitle: string }
export type LastRun = { status: string; startedAt: number } | null

/**
 * The status dot on a unified-roster row. A run in progress beats everything;
 * otherwise the last classic run's outcome colours it, and a persistent agent
 * (which has no classic runs) falls back to its metadata stamp.
 */
export function definitionStatusDot(
  definition: AgentDefinition,
  busy: boolean,
  last: LastRun,
  now: number = Date.now(),
): StatusDot {
  if (busy) return { dot: 'bg-[var(--gt-green)] gt-pulse', dotTitle: 'Run in progress' }
  const lastRunAt = definition.metadata.lastRunAt
  return {
    dot:
      last?.status === 'done'
        ? 'bg-[var(--gt-green)]'
        : last?.status === 'failed'
          ? 'bg-[var(--gt-red)]'
          : lastRunAt
            ? 'bg-[var(--gt-accent-light)]'
            : '',
    dotTitle: last
      ? `Last run: ${last.status} · ${relativeTime(last.startedAt, now)}`
      : lastRunAt
        ? `Last persistent run: ${relativeTime(lastRunAt, now)}`
        : '',
  }
}

/** The same dot for the classic-only roster, which has no persistent fallback. */
export function classicStatusDot(busy: boolean, last: LastRun, now: number = Date.now()): StatusDot {
  if (busy) return { dot: 'bg-[var(--gt-green)] gt-pulse', dotTitle: 'Run in progress' }
  return {
    dot:
      last?.status === 'done'
        ? 'bg-[var(--gt-green)]'
        : last?.status === 'failed'
          ? 'bg-[var(--gt-red)]'
          : last
            ? 'bg-white/20'
            : '',
    dotTitle: last ? `Last run: ${last.status} · ${relativeTime(last.startedAt, now)}` : '',
  }
}

export type StateSidecar = {
  sha: string
  ref: string
  at: number
  runId: string
  extras: [string, unknown][]
}

/**
 * Shape the per-(repo, agent) state JSON for display: the four reserved keys
 * get typed slots, everything else falls through to the "extra keys" list.
 */
export function parseStateSidecar(state: Record<string, unknown>): StateSidecar {
  const reserved = new Set(['lastScannedSha', 'lastScannedRef', 'lastRunAt', 'lastRunId'])
  return {
    sha: typeof state.lastScannedSha === 'string' ? state.lastScannedSha : '',
    ref: typeof state.lastScannedRef === 'string' ? state.lastScannedRef : '',
    at: typeof state.lastRunAt === 'number' ? state.lastRunAt : 0,
    runId: typeof state.lastRunId === 'string' ? state.lastRunId : '',
    extras: Object.entries(state).filter(([k]) => !reserved.has(k)),
  }
}

export type SparkBar = {
  id: string
  status: string
  dur: number | null
  height: number
  tone: string
  title: string
}

/**
 * The last-20-runs sparkline: oldest → newest, bar height scaled by duration
 * (a still-running bar has no duration and renders at a fixed mid height).
 */
export function runSparkline(runs: UnifiedRunRow[], agentId: string): SparkBar[] {
  const forAgent = runs
    .filter((r) => r.agentId === agentId)
    .slice(0, 20)
    .reverse()
  if (forAgent.length === 0) return []
  const withDuration = forAgent.map((r) => ({
    ...r,
    dur: r.endedAt ? r.endedAt - r.startedAt : null,
  }))
  const maxDur = Math.max(1000, ...withDuration.map((r) => r.dur || 0))
  return withDuration.map((r, i) => ({
    id: r.id,
    status: r.status,
    dur: r.dur,
    height: r.dur === null ? 24 : Math.max(4, Math.round((r.dur / maxDur) * 32)),
    tone:
      r.status === 'done'
        ? 'bg-[var(--gt-green)]'
        : r.status === 'failed'
          ? 'bg-[var(--gt-red)]'
          : r.status === 'running'
            ? 'bg-[var(--gt-accent-light)] gt-pulse'
            : 'bg-white/20',
    title: `${i + 1}. ${r.status} · ${
      r.dur === null ? 'running' : fmtDuration(r.dur)
    } · ${new Date(r.startedAt).toLocaleString()}`,
  }))
}

/** The file an artifact opens on: its declared primary, else the first non-manifest file. */
export function artifactDefaultPath(artifact: PersistentArtifact | null | undefined): string | null {
  if (!artifact) return null
  return artifact.primaryPath || artifact.files.find((f) => f.name !== 'artifact.json')?.path || null
}

/** Keep the current artifact selected if it survived a refresh, else take the newest. */
export function nextArtifactId(
  list: PersistentArtifact[],
  prev: string | null,
): string | null {
  return prev && list.some((a) => a.id === prev) ? prev : list[0]?.id || null
}

/** Success-rate colour ladder for the reliability scorecard. */
export function successRateTone(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return 'text-zinc-500'
  if (rate >= 80) return 'text-emerald-400'
  if (rate >= 50) return 'text-amber-400'
  return 'text-rose-400'
}
