// terminal-mcp-server — Model Context Protocol server exposing TerMinal's
// cross-session state to in-session Claude/Codex agents.
//
// READ tools: cross-session views (tickets, PRs, schedules, runs, spend).
// WRITE tools: deterministic data filing (ticket, hitl, activity, state)
// so agents skip reading ~5-7k tokens of skill files every time they file
// data. Schema decisions stay with the model; schema formatting is done here.
//
// SELF-CONTAINED: bin/terminal-mcp-server is a single bundled file with no
// runtime imports from the TerMinal app bundle, so host-provision can scp it to
// a remote host and the agent image can bake it in. That is what lets the typed
// sources here IMPORT the shared lock and sidecar-resolution modules instead of
// carrying hand-copies of them (the bundler inlines both at build time).
//
// ---------------------------------------------------------------------------
// MCP JSON-RPC server (stdio)
//
// We implement the minimal MCP slice: tools/list + tools/call + initialize.
// No prompts, no resources, no completion. Reads stdin line-buffered.
// ---------------------------------------------------------------------------
import { listAgentsTool, requestAgentArtifactTool } from './agents'
import { readSettings, type Args } from './env'
import {
  factoryHealthTool,
  listReviewPatternsTool,
  nearestSessionTool,
  recentChangesTool,
  searchDecisionsTool,
} from './insights'
import { pendingEffects } from './notify'
import {
  aiSpendToday,
  getPrArtifact,
  getTicketTool,
  listPrs,
  listSchedules,
  listTicketsTool,
  recentAgentRuns,
} from './reads'
import { TOOLS } from './tools'
import {
  commentTicket,
  emitActivityTool,
  fileHitlTool,
  fileTicket,
  getAgentStateTool,
  harnessStatusTool,
  listActivityTool,
  listBgTasksTool,
  listHitlTool,
  resolveHitlTool,
  setAgentStateTool,
  setRunOutcomeTool,
  updateTicket,
  updateTicketAgent,
  updateTicketRun,
} from './writes'

const HANDLERS: Record<string, (args: Args) => unknown> = {
  list_tickets: listTicketsTool,
  get_ticket: getTicketTool,
  list_prs: listPrs,
  get_pr_artifact: getPrArtifact,
  list_scheduled_agents: listSchedules,
  recent_agent_runs: recentAgentRuns,
  ai_spend_today: aiSpendToday,
  // writes
  file_ticket: fileTicket,
  comment_ticket: commentTicket,
  update_ticket: updateTicket,
  update_ticket_agent: updateTicketAgent,
  update_ticket_run: updateTicketRun,
  // Inbox filing. The `*_hitl` spellings are permanent aliases (ticket 0123) —
  // same function object, so they cannot drift.
  file_inbox_item: fileHitlTool,
  file_hitl: fileHitlTool,
  resolve_inbox_item: resolveHitlTool,
  resolve_hitl: resolveHitlTool,
  emit_activity: emitActivityTool,
  set_agent_state: setAgentStateTool,
  get_agent_state: getAgentStateTool,
  list_activity: listActivityTool,
  list_inbox: listHitlTool,
  list_hitl: listHitlTool,
  list_bg_tasks: listBgTasksTool,
  harness_status: harnessStatusTool,
  set_run_outcome: setRunOutcomeTool,
  // 2026-05-30: cross-repo + introspection
  list_agents: listAgentsTool,
  request_agent_artifact: requestAgentArtifactTool,
  list_review_patterns: listReviewPatternsTool,
  factory_health: factoryHealthTool,
  search_decisions: searchDecisionsTool,
  recent_changes: recentChangesTool,
  nearest_session: nearestSessionTool,
}

// Tool exposure filter — keep the in-context schema list lean for clients that
// load every tool schema eagerly (Codex, older Claude Code). Default exposes
// every tool (backward compatible). Override with GT_MCP_TOOLS env or
// settings.json `mcp.tools`: a preset ("all" | "core" | "write" | "read") or a
// comma-separated allowlist of tool names (presets and names may be mixed).
const TOOL_PRESETS: Record<string, string[]> = {
  write: [
    'file_ticket',
    'comment_ticket',
    'update_ticket',
    'update_ticket_agent',
    'update_ticket_run',
    'file_inbox_item',
    'resolve_inbox_item',
    'emit_activity',
    'set_agent_state',
    'get_agent_state',
    'set_run_outcome',
    'request_agent_artifact',
  ],
  read: [
    'list_tickets',
    'get_ticket',
    'list_prs',
    'get_pr_artifact',
    'list_scheduled_agents',
    'recent_agent_runs',
    'ai_spend_today',
    'list_activity',
    'list_inbox',
    'list_bg_tasks',
    'harness_status',
    'list_agents',
    'list_review_patterns',
    'factory_health',
    'search_decisions',
    'recent_changes',
    'nearest_session',
  ],
}
// core = the deterministic-filing tools (the server's reason to exist) plus the
// few most-used reads. ~11 tools vs 25 — roughly half the schema tokens.
TOOL_PRESETS.core = [...TOOL_PRESETS.write, 'list_tickets', 'list_inbox', 'harness_status']

export function exposedTools(): typeof TOOLS {
  let raw = process.env.GT_MCP_TOOLS
  if (!raw) {
    const s = readSettings()
    raw = s.mcp && typeof s.mcp.tools === 'string' ? s.mcp.tools : ''
  }
  raw = (raw || 'all').trim()
  if (!raw || raw === 'all') return TOOLS
  const wanted = new Set<string>()
  for (const tok of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (TOOL_PRESETS[tok]) TOOL_PRESETS[tok].forEach((n) => wanted.add(n))
    else wanted.add(tok)
  }
  const filtered = TOOLS.filter((t) => wanted.has(t.name))
  return filtered.length ? filtered : TOOLS // never accidentally expose nothing
}

function jsonRpc(id: unknown, result: unknown, error?: unknown): void {
  const msg = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }
  process.stdout.write(JSON.stringify(msg) + '\n')
}

export function handleRequest(req: Args): void {
  const { id, method, params } = req
  if (method === 'initialize') {
    return jsonRpc(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'terminal-harness', version: '0.1.0' },
    })
  }
  if (method === 'notifications/initialized') return // notification, no reply
  if (method === 'tools/list') {
    return jsonRpc(id, { tools: exposedTools() })
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments || {}
    const handler = HANDLERS[name]
    if (!handler) return jsonRpc(id, null, { code: -32601, message: `Unknown tool: ${name}` })
    try {
      const result = handler(args)
      return jsonRpc(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      })
    } catch (e) {
      return jsonRpc(id, null, { code: -32603, message: (e as Error).message })
    }
  }
  jsonRpc(id, null, { code: -32601, message: `Method not found: ${method}` })
}

// Line-buffered stdin
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    try {
      const req = JSON.parse(line)
      handleRequest(req)
    } catch (e) {
      // Parse error
      process.stderr.write(`mcp-server: parse error: ${(e as Error).message}\n`)
    }
  }
})

// Drain in-flight Slack effects before exiting: a one-shot `terminal-cli mcp`
// invocation closes stdin the moment it has its JSON-RPC response, and a bare
// process.exit would cut best-effort posts/reactions off mid-flight. Capped so
// a hung socket can never wedge the process open.
process.stdin.on('end', () => {
  if (!pendingEffects.size) process.exit(0)
  const bail = setTimeout(() => process.exit(0), 10_000)
  void Promise.allSettled([...pendingEffects]).then(() => {
    clearTimeout(bail)
    process.exit(0)
  })
})
