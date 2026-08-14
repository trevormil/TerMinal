// Which agent owns a ticket, and the small formatting helpers ticket writes
// share. Pure — no filesystem, no clock beyond `new Date()`.

// The user's LOCAL calendar day, not UTC. `toISOString().slice(0,10)` is the UTC
// date, so any evening edit west of UTC stamps TOMORROW. Must agree with
// src/main/local-day.ts: the app and this script write the same ticket
// `updated:` field, and a mismatch made them disagree by a day every evening.
export const localDay = (at = new Date()): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

export const todayStr = (): string => localDay()

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'untitled'

export type TicketAgent = { id: string; scope: string; kind: string }

const TICKET_AGENT_ROUTES: { agent: TicketAgent; type: string[]; keywords: string[] }[] = [
  {
    agent: { id: 'security-sweep', scope: 'global', kind: 'classic' },
    type: ['security'],
    keywords: [
      'security',
      'auth',
      'authorization',
      'permission',
      'xss',
      'csrf',
      'ssrf',
      'injection',
      'secret',
      'token',
      'cve',
      'vulnerability',
    ],
  },
  {
    agent: { id: 'test-coverage', scope: 'global', kind: 'classic' },
    type: ['testing'],
    keywords: ['test', 'tests', 'testing', 'coverage', 'spec', 'flaky', 'assertion', 'tdd'],
  },
  {
    agent: { id: 'docs', scope: 'global', kind: 'classic' },
    type: ['docs'],
    keywords: ['docs', 'documentation', 'readme', 'runbook', 'adr', 'changelog', 'guide'],
  },
  {
    agent: { id: 'perf-pass', scope: 'global', kind: 'classic' },
    type: ['performance'],
    keywords: [
      'performance',
      'perf',
      'latency',
      'slow',
      'memory',
      'n+1',
      'cache',
      'optimize',
      'profiling',
    ],
  },
  {
    agent: { id: 'ci-improver', scope: 'global', kind: 'classic' },
    type: ['dx'],
    keywords: [
      'ci',
      'lint',
      'typecheck',
      'build failure',
      'workflow',
      'developer',
      'devex',
      'tooling',
      'script',
    ],
  },
]

export function recommendTicketAgent(
  input: { type?: string; title?: string; body?: string } = {},
): { agent: TicketAgent; signals: string[] } {
  const type = String(input.type || 'feature').toLowerCase()
  const text = `${input.title || ''}\n${input.body || ''}`.toLowerCase()
  const scored = TICKET_AGENT_ROUTES.map((route) => {
    const signals: string[] = []
    if (route.type?.includes(type)) signals.push(`type:${type}`)
    for (const keyword of route.keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)) signals.push(keyword)
    }
    return { route, signals }
  }).filter((x) => x.signals.length > 0)
  if (scored.length) {
    scored.sort((a, b) => b.signals.length - a.signals.length)
    return { agent: scored[0].route.agent, signals: scored[0].signals.slice(0, 5) }
  }
  return {
    agent: { id: '1000x-ai-engineer', scope: 'global', kind: 'classic' },
    signals: type ? [`type:${type}`] : [],
  }
}

function defaultTicketAgent(type = 'feature'): TicketAgent {
  return recommendTicketAgent({ type }).agent
}

export function normalizeTicketAgent(
  args: Record<string, any> | undefined,
  type = 'feature',
  recommendation?: { agent: TicketAgent },
): TicketAgent {
  const fallback = recommendation?.agent || defaultTicketAgent(type)
  const id =
    typeof args?.agentId === 'string' && args.agentId.trim() ? args.agentId.trim() : fallback.id
  const scope =
    args?.agentScope === 'repo' || args?.agentScope === 'global' ? args.agentScope : fallback.scope
  const kind =
    args?.agentKind === 'persistent' || args?.agentKind === 'classic'
      ? args.agentKind
      : fallback.kind
  return { id, scope, kind }
}

export function ticketAgentFromMeta(meta: Record<string, any>): TicketAgent {
  return normalizeTicketAgent(
    {
      agentId: meta.agent_id,
      agentScope: meta.agent_scope,
      agentKind: meta.agent_kind,
    },
    meta.type || 'feature',
  )
}

// Mirrors ModelTier in src/main/resolve-model.ts. The tool schema's `enum` is
// advisory — MCP clients are not obliged to enforce it — so the server
// validates too. An unroutable tier resolves through the default (expensive)
// policy slot, so a typo would silently bill at top rate while the ticket
// claimed to be cheap.
const MODEL_TIERS = ['auto', 'top', 'cheap-agentic', 'cheap-raw']
export const normalizeModelTier = (value: unknown): string =>
  MODEL_TIERS.includes(value as string) ? (value as string) : 'auto'
