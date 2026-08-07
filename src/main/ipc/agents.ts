// Agent IPCs (ticket 91 index.ts decomposition): definition CRUD, script/state
// reads, designer spawns, the three run entry points (agent / ticket / PR) with
// their remote dispatch, and the run controls. Session context and the shared
// remote-dispatch helpers are injected via deps — they are used by other
// index.ts surfaces too (bg tasks, session spawn), so they stay owned there.

import { ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { emitActivity } from '../events'
import { repoRootOf } from '../repo'
import {
  listAgentDefinitions,
  readAgentRunContexts,
  runAgent,
  runDesignerSpawn,
  runTicketLanes,
  runPrAgent,
  rerunAgentRun,
  cancelRun,
  removeWorktree,
  readAgentState,
  resetAgentState,
  listPipelines,
  type Agent,
  type Engine,
  type PrAgentKind,
} from '../agents'
import { listRuns } from '../agent-run-store'
import { readAgents, saveAgent, resetAgent, locateScript } from '../agent-registry'
import { getRepoTicket } from '../ticket-provider'
import { updateTicket } from '../backlog'
import {
  remoteAgents,
  remoteProbe,
  remoteRuns,
  remoteTickets,
  type RemoteSessionRef,
} from '../remote'

export type AgentsIpcDeps = {
  cur(): { cwd: string; sessionId: string }
  curRemote(): RemoteSessionRef | undefined
  /** A caller-requested remote target (Runs-tab re-run on a host). */
  requestedRemote(input: unknown): RemoteSessionRef | undefined
  remoteAgentCatalog(remote: RemoteSessionRef): Promise<Agent[]>
  /** Compose persona/pipeline steps for a remote run. */
  remoteSteps(
    base: { label: string; prompt: string },
    personaId?: string,
    pipelineId?: string,
  ): { steps: { label: string; prompt: string }[]; persona?: string; pipeline?: string }
  /** OpenRouter runs only exist locally — map to the remote's engine. */
  localOnlyToRemote(engine: Engine): Engine
  remoteEngineModel(remote: RemoteSessionRef, engine: Engine, model?: string): string | undefined
  repoLabelFor(cwdOrRoot: string): string
}

export function registerAgentsIpc(deps: AgentsIpcDeps): void {
  ipcMain.handle('agents:list', async () => {
    const remote = deps.curRemote()
    if (!remote) return readAgents(repoRootOf(deps.cur().cwd))
    return deps.remoteAgentCatalog(remote)
  })
  ipcMain.handle('agents:definitions', () => listAgentDefinitions(repoRootOf(deps.cur().cwd)))
  ipcMain.handle('agents:save', (_e, agent: { id: string; title: string; prompt: string }) => {
    if (deps.curRemote()) return { error: 'remote agent editing needs the remote daemon writer' }
    const root = repoRootOf(deps.cur().cwd)
    const r = saveAgent(root, agent)
    if ('ok' in r) {
      emitActivity({
        kind: 'info',
        title: `Agent saved · ${agent.title || agent.id}`,
        detail: agent.id,
        repo: deps.repoLabelFor(root),
        repoRoot: root,
        sessionId: deps.cur().sessionId,
      })
    }
    return r
  })
  ipcMain.handle('agents:reset', (_e, id: string) => {
    if (deps.curRemote()) return { error: 'remote agent reset needs the remote daemon writer' }
    const root = repoRootOf(deps.cur().cwd)
    const r = resetAgent(root, id)
    if ('ok' in r) {
      emitActivity({
        kind: 'info',
        title: `Agent reset · ${id}`,
        detail: 'Removed repo override',
        repo: deps.repoLabelFor(root),
        repoRoot: root,
        sessionId: deps.cur().sessionId,
      })
    }
    return r
  })
  // Read the script body for an agent if .agents/<id>.sh (or global) exists. Returns
  // { path, body } when found, null otherwise — used by the Agents tab to render
  // the bash inline alongside the prompt.
  ipcMain.handle('agents:script', (_e, id: string) => {
    const remote = deps.curRemote()
    if (remote) return remoteAgents.script(remote, id)
    const root = repoRootOf(deps.cur().cwd) || ''
    const p = locateScript(root, id)
    if (!p) return null
    try {
      return { path: p, body: readFileSync(p, 'utf8') }
    } catch {
      return null
    }
  })
  ipcMain.handle('agents:state', (_e, id: string) => {
    if (deps.curRemote()) return { path: `remote:${id}`, exists: false, state: {} }
    const root = repoRootOf(deps.cur().cwd) || ''
    return readAgentState(root, id)
  })
  ipcMain.handle('agents:state-reset', (_e, id: string) => {
    if (deps.curRemote()) return { ok: true }
    const root = repoRootOf(deps.cur().cwd) || ''
    const r = resetAgentState(root, id)
    if ('ok' in r) {
      emitActivity({
        kind: 'info',
        title: `Agent state reset · ${id}`,
        detail: deps.repoLabelFor(root),
        repo: deps.repoLabelFor(root),
        repoRoot: root,
        sessionId: deps.cur().sessionId,
      })
    }
    return r
  })
  ipcMain.handle(
    'agents:design',
    (_e, text: string, engine: Engine, scope: 'repo' | 'global', model?: string) =>
      deps.curRemote()
        ? { error: 'remote agent design needs the remote daemon writer' }
        : runDesignerSpawn(repoRootOf(deps.cur().cwd), text, engine, scope, model),
  )
  ipcMain.handle('agents:pipelines', () => listPipelines())
  ipcMain.handle('personas:list', () => readAgentRunContexts(repoRootOf(deps.cur().cwd)))
  ipcMain.handle(
    'agents:run',
    (
      _e,
      agentId: string,
      engine?: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      requested?: unknown,
      openrouterHarness?: 'codex' | 'hermes',
      extraContext?: string,
      effort?: string,
    ) =>
      (async () => {
        const remote = deps.requestedRemote(requested) || deps.curRemote()
        if (!remote)
          return runAgent(
            repoRootOf(deps.cur().cwd),
            agentId,
            engine,
            persona,
            pipeline,
            model,
            openrouterHarness,
            extraContext,
            effort,
          )
        const agent = (await deps.remoteAgentCatalog(remote)).find((a) => a.id === agentId)
        if (!agent) return { error: 'unknown agent' }
        // OpenRouter runs on the bundled local or-agent harness — never dispatch it
        // to a remote host (no or-agent there); fall back to the remote's engine.
        const resolvedEngine = deps.localOnlyToRemote(
          engine || agent.engine || remote.daemon?.defaultEngine || 'codex',
        )
        const {
          steps,
          persona: personaLabel,
          pipeline: pipelineLabelText,
        } = deps.remoteSteps({ label: agent.title, prompt: agent.prompt }, persona, pipeline)
        const run = await remoteRuns.start(remote, {
          agentId: agent.id,
          agentTitle: agent.title,
          engine: resolvedEngine,
          model: deps.remoteEngineModel(remote, resolvedEngine, model ?? agent.model),
          effort: effort ?? agent.effort,
          steps,
          inPlace: agent.inPlace,
        })
        if (!('error' in run)) {
          emitActivity({
            kind: 'agent-run',
            title: `Remote agent started · ${agent.title}`,
            detail: `${remote.sshTarget} · ${resolvedEngine}${personaLabel ? ` · ${personaLabel}` : ''}${pipelineLabelText ? ` · ${pipelineLabelText}` : ''}`,
            repo: deps.repoLabelFor(deps.cur().cwd),
            sessionId: deps.cur().sessionId,
            runId: run.id,
            runSource: 'agent',
          })
        }
        return run
      })(),
  )
  ipcMain.handle(
    'agents:run-ticket',
    async (
      _e,
      slug: string,
      engine: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      requested?: unknown,
      lanes?: number,
      extraContext?: string,
      effort?: string,
    ) => {
      const remote = deps.requestedRemote(requested) || deps.curRemote()
      if (remote) {
        // v1: lanes are local-only. Remote runs a single attempt.
        return (async () => {
          const t = await remoteTickets.get(remote, slug)
          if (!t) return { error: 'ticket not found' }
          const base = `Implement backlog ticket #${t.id}: ${t.title}\n\n${t.body}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. Commit your work and open a PR that references ticket #${t.id}. If fully delivered set the ticket status to closed (else in-progress) and link the PR in its prs: field. End with a short summary of what changed and the PR URL.`
          const { steps } = deps.remoteSteps(
            { label: `implement #${t.id}`, prompt: base },
            persona,
            pipeline,
          )
          const run = await remoteRuns.start(remote, {
            agentId: `ticket-${t.id}`,
            agentTitle: `Implement #${t.id}`,
            engine,
            model: deps.remoteEngineModel(remote, engine, model),
            effort,
            steps,
          })
          if ('error' in run) return run
          await remoteTickets
            .update(remote, slug, {
              run: {
                id: run.id,
                source: 'agent',
                sessionId: deps.cur().sessionId,
                startedAt: new Date(run.startedAt).toISOString(),
                status: run.status,
              },
            })
            .catch(() => false)
          return run
        })()
      }
      const root = repoRootOf(deps.cur().cwd)
      const t = await getRepoTicket(root, slug)
      if (!t) return { error: 'ticket not found' }
      const ticketInput = {
        slug: t.slug,
        id: t.id,
        title: t.title,
        body: t.body,
        externalKey: t.externalKey,
        url: t.url,
        comments: t.comments,
        agent: t.agent,
        modelTier: t.modelTier,
      }
      const res = runTicketLanes(
        root,
        ticketInput,
        engine,
        persona,
        pipeline,
        model,
        lanes,
        extraContext,
        effort,
      )
      if ('error' in res) return res
      // Link the ticket's run pointer to the first lane (solo runs have exactly
      // one). Lanes deliberately don't each write the ticket — the judge links the
      // winner — so we record the lead run here for the at-a-glance run badge.
      const lead = res.runs[0]
      updateTicket(root, t.slug, {
        run: {
          id: lead.id,
          source: 'agent',
          sessionId: deps.cur().sessionId,
          startedAt: new Date(lead.startedAt).toISOString(),
          status: lead.status,
        },
      })
      return lead
    },
  )
  ipcMain.handle(
    'agents:run-pr',
    (
      _e,
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
      kind: PrAgentKind,
      engine: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      requested?: unknown,
      effort?: string,
    ) =>
      (async () => {
        const remote = deps.requestedRemote(requested) || deps.curRemote()
        if (!remote)
          return runPrAgent(
            repoRootOf(deps.cur().cwd),
            pr,
            kind,
            engine,
            persona,
            pipeline,
            model,
            effort,
          )
        if (!pr?.sourceBranch) return { error: 'PR/MR has no source branch' }
        const probe = await remoteProbe(remote).catch(() => null)
        const forgeLabel = probe?.forgeLabel || 'MR'
        const forgeSym = probe?.forgeSym || '!'
        const tag = `${forgeLabel} ${forgeSym}${pr.iid}`
        const ref = pr.webUrl || `${forgeSym}${pr.iid}`
        const reviewCtx = `This worktree is checked out at the head of ${tag} (${ref}${pr.title ? ` — "${pr.title}"` : ''}) on branch "${pr.sourceBranch}".`
        const iterateCtx = `${reviewCtx} After committing, push back to the ${forgeLabel} with \`git push origin HEAD:${pr.sourceBranch}\`.`
        const base =
          kind === 'review'
            ? `Review ${tag} using the repository's code-review agent contract. ${reviewCtx} Resolve the target branch and current head commit, inspect the diff and relevant history, run the project test gate, and write the review artifacts required by .agents/code-review.md when present. Do not implement fixes during review; file owner-scoped follow-up tickets for out-of-scope work. End with verdict, artifact path, test status, and key findings.`
            : `Iterate on ${tag} until it is merge-ready. ${iterateCtx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases — keep changes surgical. Commit and push your work. End with the final status and a short summary of what changed.`
        const { steps } = deps.remoteSteps(
          { label: `${kind} ${forgeSym}${pr.iid}`, prompt: base },
          persona,
          pipeline,
        )
        return remoteRuns.start(remote, {
          agentId: `pr-${kind}-${pr.iid}`,
          agentTitle: `${kind === 'review' ? 'Review' : 'Iterate'} ${forgeSym}${pr.iid}`,
          engine,
          model: deps.remoteEngineModel(remote, engine, model),
          effort,
          steps,
          prRef: { iid: pr.iid, sourceBranch: pr.sourceBranch },
        })
      })(),
  )
  ipcMain.handle('agents:runs', async () => {
    const remote = deps.curRemote()
    if (!remote) return listRuns()
    return (await remoteRuns.all(remote).catch(() => []))
      .filter((r) => r.source === 'agent' || r.source === 'cron')
      .map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentTitle: r.agentTitle,
        engine: r.engine,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        exitCode: r.exitCode,
        repoRoot: r.repoRoot,
        worktree: r.worktree,
        branch: r.branch,
        output: '',
      }))
  })
  ipcMain.handle('agents:rerun', (_e, runId: string) =>
    deps.curRemote()
      ? { error: 'remote rerun needs the remote daemon runner' }
      : rerunAgentRun(runId),
  )
  ipcMain.handle('agents:cancel', (_e, runId: string) =>
    deps.curRemote() ? false : cancelRun(runId),
  )
  ipcMain.handle('agents:remove-worktree', (_e, runId: string) =>
    deps.curRemote() ? false : removeWorktree(runId),
  )
}
