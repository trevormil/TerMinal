// ---------------------------------------------------------------------------
// Agent introspection + delegation. These close the "agents can self-query the
// IDE" gap: list_agents (what agents exist) and request_agent_artifact
// (delegate focused research/artifact work).
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { statePathForWrite } from '../runner/repo-state'
import { CFG, type Args } from './env'
import { findRepoRoot } from './repo'
import { normalizeTicketAgent, slugify } from './ticket-agents'
import { emitActivityRaw } from './writes'

const DEFAULT_AGENT_SUMMARIES: [string, string][] = [
  ['factory', 'Run /factory'],
  ['docs', 'Improve docs'],
  ['deep-audit', 'Deep audit'],
  ['ticket-pr-cleanup', 'Ticket / PR cleanup'],
  ['test-coverage', 'Strengthen tests'],
  ['code-review', 'Code review'],
  ['security-sweep', 'Security sweep'],
  ['perf-pass', 'Performance pass'],
  ['dep-upgrade', 'Dependency hygiene'],
  ['dead-code', 'Dead-code cleanup'],
  ['comments-inspector', 'Comments inspector'],
  ['product-audit', 'Product audit'],
  ['friction-hunter', 'Friction hunter'],
  ['red-team-audit', 'Red-team audit'],
  ['intelligence', 'Intelligence sweep'],
  ['strategy', 'Strategy review'],
  ['cert-check', 'TLS / cert check'],
  ['translations-check', 'Translations check'],
  ['changelog', 'Changelog update'],
  ['simplification', 'Simplification pass'],
  ['devils-advocate', "Devil's advocate"],
  ['bloat-check', 'Bloat check'],
  ['knowledge-base', 'Knowledge base sweep'],
  ['ci-improver', 'CI improver'],
  ['summary', 'Daily summary'],
  ['beacon', 'Process Beacon feedback'],
  ['emergency-fix', 'Emergency fix'],
  ['unblock-ci', 'Unblock CI'],
  ['revert-main', 'Revert last main commit'],
]

function pushAgent(
  out: Record<string, any>[],
  seen: Set<string>,
  agent: Record<string, any>,
): void {
  const key = `${agent.kind || 'classic'}:${agent.scope || 'global'}:${agent.id}`
  if (seen.has(key)) return
  seen.add(key)
  out.push(agent)
}

function agentDefinitionHints(meta: any): Record<string, any> {
  if (!meta || typeof meta !== 'object') return {}
  const modelPolicy =
    meta.modelPolicy && typeof meta.modelPolicy === 'object' ? meta.modelPolicy : {}
  const quality = meta.quality && typeof meta.quality === 'object' ? meta.quality : {}
  const hints: Record<string, any> = {}
  const model = modelPolicy.default || meta.model
  if (model) hints.model = model
  if (modelPolicy.cheap) hints.cheapModel = modelPolicy.cheap
  if (modelPolicy.deep) hints.deepModel = modelPolicy.deep
  if (modelPolicy.judge || quality?.judge?.model)
    hints.judgeModel = modelPolicy.judge || quality.judge.model
  const acceptanceCriteria = Array.isArray(quality.acceptanceCriteria)
    ? quality.acceptanceCriteria.length
    : 0
  const deterministicChecks = Array.isArray(quality.deterministicChecks)
    ? quality.deterministicChecks.length
    : 0
  const requiredArtifacts = Array.isArray(quality.requiredArtifacts)
    ? quality.requiredArtifacts.length
    : 0
  if (acceptanceCriteria || deterministicChecks || requiredArtifacts || quality?.judge?.enabled) {
    hints.quality = {
      acceptanceCriteria,
      deterministicChecks,
      requiredArtifacts,
      judge: quality?.judge?.enabled ? quality.judge.mode || 'llm' : 'off',
    }
  }
  if (typeof meta.outputContract === 'string' && meta.outputContract.trim()) {
    hints.outputContract = meta.outputContract.trim().slice(0, 160)
  }
  return hints
}

// --- list_agents: what agents are available for a repo --------------------
export function listAgentsTool(args: Args): Record<string, any> {
  const root = args.repo ? findRepoRoot(args.repo) : process.env.TERMINAL_REPO || null
  if (!root) return { error: 'unknown repo; pass repo=<basename> or set TERMINAL_REPO' }
  const out: Record<string, any>[] = []
  const seen = new Set<string>()
  for (const [id, title] of DEFAULT_AGENT_SUMMARIES) {
    pushAgent(out, seen, { id, title, scope: 'global', kind: 'classic', source: 'default' })
  }
  const globalJson = join(CFG(), 'agents', 'global.json')
  if (existsSync(globalJson)) {
    try {
      const list = JSON.parse(readFileSync(globalJson, 'utf8'))
      const arr = Array.isArray(list) ? list : []
      for (const a of arr) {
        if (a?.id && a?.title)
          pushAgent(out, seen, {
            id: a.id,
            title: a.title,
            scope: 'global',
            kind: 'classic',
            source: 'global',
            description: a.description,
            ...agentDefinitionHints(a),
          })
      }
    } catch {
      /* a malformed registry contributes nothing */
    }
  }
  // Repo-local: .agents/agents.json + .agents/*.sh
  const localJson = join(root, '.agents', 'agents.json')
  if (existsSync(localJson)) {
    try {
      const list = JSON.parse(readFileSync(localJson, 'utf8'))
      const arr = Array.isArray(list) ? list : Array.isArray(list?.agents) ? list.agents : []
      for (const a of arr) {
        if (a?.id && a?.title)
          pushAgent(out, seen, {
            id: a.id,
            title: a.title,
            scope: 'repo',
            kind: 'classic',
            source: 'repo',
            force: !!a.force,
            opensPr: !!a.opensPr,
            inPlace: !!a.inPlace,
            description: a.description,
            ...agentDefinitionHints(a),
          })
      }
    } catch {
      /* same */
    }
  }
  if (existsSync(join(root, '.agents'))) {
    try {
      for (const f of readdirSync(join(root, '.agents'))) {
        if (!f.endsWith('.sh')) continue
        const id = f.slice(0, -3)
        let meta: any = {}
        try {
          const p = join(root, '.agents', `${id}.json`)
          if (existsSync(p)) meta = JSON.parse(readFileSync(p, 'utf8'))
        } catch {
          /* no sidecar metadata for this script */
        }
        pushAgent(out, seen, {
          id,
          title: meta.title || id,
          scope: 'repo',
          kind: 'classic',
          source: 'repo-script',
          description: meta.description,
          ...agentDefinitionHints(meta),
        })
      }
    } catch {
      /* unreadable .agents dir */
    }
  }
  // Global script agents
  const globalScripts = join(CFG(), 'scripts')
  if (existsSync(globalScripts)) {
    try {
      for (const f of readdirSync(globalScripts)) {
        if (!f.endsWith('.sh')) continue
        const id = f.slice(0, -3)
        let meta: any = {}
        try {
          const p = join(globalScripts, `${id}.json`)
          if (existsSync(p)) meta = JSON.parse(readFileSync(p, 'utf8'))
        } catch {
          /* no sidecar metadata for this script */
        }
        pushAgent(out, seen, {
          id,
          title: meta.title || id,
          scope: 'global',
          kind: 'classic',
          source: 'global-script',
          description: meta.description,
          ...agentDefinitionHints(meta),
        })
      }
    } catch {
      /* unreadable scripts dir */
    }
  }
  const persistentRoot = join(CFG(), 'persistent-agents')
  if (existsSync(persistentRoot)) {
    try {
      for (const id of readdirSync(persistentRoot)) {
        const metaPath = join(persistentRoot, id, 'agent.json')
        if (!existsSync(metaPath)) continue
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
          pushAgent(out, seen, {
            id,
            title: meta.title || id,
            scope: 'global',
            kind: 'persistent',
            source: 'persistent',
            description: meta.description,
            ...agentDefinitionHints(meta),
          })
        } catch {
          /* skip one malformed persistent agent */
        }
      }
    } catch {
      /* unreadable persistent-agents dir */
    }
  }
  return { repo: basename(root), agents: out.sort((a, b) => a.id.localeCompare(b.id)) }
}

/**
 * One inbox item per session the first time an agent delegates. Per-SESSION,
 * not per-call: a research agent legitimately delegates several times in a row,
 * and an item per call would be the re-nag failure that gets the inbox muted.
 * The marker is keyed by session id and lives beside the other run state.
 */
function noteFirstDelegation(title: string, repo: string, agentId: string): void {
  try {
    const sessionId = process.env.GT_TERMINAL_SESSION_ID || ''
    const dir = join(CFG(), 'delegation-seen')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const marker = join(dir, `${(sessionId || 'no-session').replace(/[^\w-]/g, '_')}.json`)
    if (existsSync(marker)) return
    writeFileSync(marker, JSON.stringify({ at: Date.now(), repo, agentId }), { mode: 0o600 })
    emitActivityRaw({
      kind: 'info',
      title: `Agent delegated work · ${repo}`,
      detail: `An agent spawned a delegated ${agentId} run ("${title}"). Further delegations this session are not announced.`,
      repo,
      suppressTelegram: true,
    })
  } catch {
    // Visibility is not worth failing the delegation over.
  }
}

// --- request_agent_artifact: delegate focused research/artifact work -------
export function requestAgentArtifactTool(args: Args): Record<string, any> {
  const root = args.repo ? findRepoRoot(args.repo) : process.env.TERMINAL_REPO || null
  if (!root) throw new Error('unknown repo; pass repo or set TERMINAL_REPO')
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt) throw new Error('prompt is required')
  const title =
    typeof args.title === 'string' && args.title.trim()
      ? args.title.trim()
      : 'Agent artifact request'
  const agent = normalizeTicketAgent(
    {
      agentId: args.agentId || 'knowledge-base',
      agentScope: args.agentScope || 'global',
      agentKind: args.agentKind || 'classic',
    },
    'feature',
  )
  const timeoutMs = Math.max(30_000, Math.min(Number(args.timeoutMs || 180_000), 600_000))
  const model = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : ''
  const runSlug = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slugify(title)}`
  // Delegated-artifact runtime state is personal → the sidecar, never the repo.
  const dir = join(
    statePathForWrite(root, 'agent-requests') || join(root, '.TerMinal', 'agent-requests'),
    runSlug,
  )
  mkdirSync(dir, { recursive: true })
  const promptPath = join(dir, 'prompt.md')
  const reportPath = join(dir, 'report.md')
  const metaPath = join(dir, 'artifact.json')
  const fullPrompt = `You are a delegated TerMinal agent request.

Agent: ${agent.kind}:${agent.scope}:${agent.id}
Repo: ${basename(root)}
Working directory: ${root}

Task:
${prompt}

Rules:
- Stay focused on this request; do not implement code unless explicitly asked.
- Re-read files from disk instead of asking the parent agent for pasted context.
- Return a concise markdown artifact with: Summary, Findings, Evidence/Paths, and Recommended next steps.
- If follow-up implementation is needed, recommend exactly which agent should own it.
`
  writeFileSync(promptPath, fullPrompt)
  // Delegation spawns a REAL `claude -p` — it costs money and runs unattended,
  // triggered by an agent rather than by the operator. It stays allowed (gating
  // it behind a flag TerMinal might not set would break it silently), but the
  // first delegation of each session announces itself, so an agent cannot fan
  // out sub-agents entirely invisibly (ticket 67, F-11).
  noteFirstDelegation(title, basename(root), agent.id)
  const child = spawnSync(
    'claude',
    ['-p', fullPrompt, '--permission-mode', 'auto', ...(model ? ['--model', model] : [])],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        TERMINAL_DELEGATE_AGENT_ID: agent.id,
        TERMINAL_DELEGATE_AGENT_SCOPE: agent.scope,
        TERMINAL_DELEGATE_AGENT_KIND: agent.kind,
      },
    },
  )
  const stdout = child.stdout || ''
  const stderr = child.stderr || ''
  const errorMessage = child.error?.message || ''
  const timedOut = child.error && (child.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  const ok = !child.error && (child.status === 0 || child.status === null)
  const body =
    stdout.trim() ||
    (stderr.trim()
      ? `Delegated agent wrote no stdout.\n\n## stderr\n\n\`\`\`\n${stderr.trim().slice(0, 8000)}\n\`\`\``
      : `Delegated agent wrote no stdout.${errorMessage ? `\n\n## error\n\n\`\`\`\n${errorMessage}\n\`\`\`` : ''}`)
  writeFileSync(
    reportPath,
    `---\ntitle: ${JSON.stringify(title)}\nrepo: ${basename(root)}\nagent_id: ${agent.id}\nagent_scope: ${agent.scope}\nagent_kind: ${agent.kind}\ncreated: ${new Date().toISOString()}\nok: ${ok}\n---\n\n${body}\n`,
  )
  const summary = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, 6)
    .join('\n')
    .slice(0, 1200)
  const meta = {
    title,
    kind: 'agent-artifact',
    createdAt: new Date().toISOString(),
    agent,
    ok,
    status: child.status,
    signal: child.signal,
    timedOut: !!timedOut,
    promptPath,
    primaryPath: reportPath,
    summary,
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')
  emitActivityRaw({
    kind: ok ? 'agent-run' : 'error',
    title: `Agent artifact · ${agent.id}`,
    detail: title,
    repo: basename(root),
    repoRoot: root,
  })
  return {
    ok,
    repo: basename(root),
    agent,
    artifactPath: reportPath,
    promptPath,
    metaPath,
    summary,
    status: child.status,
    signal: child.signal,
    timedOut: !!timedOut,
  }
}
