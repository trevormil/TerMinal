// Ticket IPC (ticket 0122 index.ts decomposition) — the Tickets tab's reads,
// the per-repo provider config (local/GitHub/Linear/webview), and the two write paths
// that emit into the Activity feed. Session context arrives via deps: the
// active workspace daemon, the caller-scoped daemon that `tickets:spawn` needs
// to dispatch a remote run, and the focused session id the activity events are
// stamped with.

import { handle } from '../typed-ipc'
import { emitActivity } from '../events'
import { recommendTicketAgent } from '../backlog'
import type { TicketAgentRecommendationInput, TicketPatch } from '../backlog'
import {
  listLinearTeams,
  type NewTicketComment,
  readRepoTicketConfig,
  resolveHumanAuthor,
  retiredProviderWarning,
  saveRepoTicketConfig,
  testRepoTicketProvider,
  type RepoTicketsConfig,
} from '../ticket-provider'
import { runTicketSpawn, type Engine } from '../agents'
import { remoteRuns, type RemoteSessionRef } from '../remote'
import { type WorkspaceDaemon } from '../workspace-daemon'

export type TicketsIpcDeps = {
  activeDaemon(): WorkspaceDaemon
  /** The daemon a Runs-tab re-run asked for, else the active one. */
  daemonForRequest(input: unknown): WorkspaceDaemon
  sessionId(): string
  remoteEngineModel(remote: RemoteSessionRef, engine: Engine, model?: string): string | undefined
}

export function registerTicketsIpc(deps: TicketsIpcDeps): void {
  handle('tickets:list', () => {
    return deps.activeDaemon().ticketsList()
  })
  handle('tickets:get', (_e, slug: string) => {
    return deps.activeDaemon().ticketGet(slug)
  })
  handle('tickets:provider-get', () => {
    const daemon = deps.activeDaemon()
    if (daemon.kind !== 'local') return { error: 'Ticket provider setup is local-only for now.' }
    // A repo whose saved config names a retired provider degrades to the local
    // backlog. Say so once, here, rather than letting the tab quietly show a
    // different store than the one the config asks for.
    const retired = retiredProviderWarning(daemon.repoRoot())
    if (retired)
      emitActivity({
        kind: 'blocked',
        ...retired,
        repo: daemon.repoLabel(),
        repoRoot: daemon.repoRoot(),
        sessionId: deps.sessionId(),
      })
    return readRepoTicketConfig(daemon.repoRoot())
  })
  handle('tickets:provider-save', (_e, cfg: RepoTicketsConfig) => {
    const daemon = deps.activeDaemon()
    if (daemon.kind !== 'local') return { error: 'Ticket provider setup is local-only for now.' }
    const saved = saveRepoTicketConfig(daemon.repoRoot(), cfg)
    emitActivity({
      kind: 'info',
      title: `Ticket provider · ${saved.provider || 'local'}`,
      detail: daemon.repoLabel(),
      repo: daemon.repoLabel(),
      repoRoot: daemon.repoRoot(),
      sessionId: deps.sessionId(),
    })
    return saved
  })
  handle('tickets:provider-test', (_e, cfg: RepoTicketsConfig, smoke?: boolean) => {
    const daemon = deps.activeDaemon()
    if (daemon.kind !== 'local')
      return {
        ok: false,
        provider: 'local',
        message: 'Ticket provider setup is local-only for now.',
      }
    return testRepoTicketProvider(daemon.repoRoot(), cfg, { smoke: !!smoke })
  })
  handle('tickets:linear-teams', (_e, cfg?: RepoTicketsConfig) => {
    const daemon = deps.activeDaemon()
    if (daemon.kind !== 'local') return []
    return listLinearTeams(daemon.repoRoot(), cfg)
  })
  handle('tickets:recommend-agent', (_e, input: TicketAgentRecommendationInput) =>
    recommendTicketAgent(input),
  )
  handle(
    'tickets:spawn',
    (_e, text: string, engine: Engine, model?: string, requested?: unknown) => {
      const daemon = deps.daemonForRequest(requested)
      if (!daemon.remote) return runTicketSpawn(daemon.repoRoot(), text, engine, model)
      const t = text.trim()
      if (!t) return { error: 'empty request' }
      const prompt = `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions: allocate the next id, write $TERMINAL_BACKLOG_DIR/NNNN-slug.md with valid YAML frontmatter matching the repo's examples (legacy v1 repos may use backlog/), put detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR — just file the ticket. Request: ${t}`
      return remoteRuns.start(daemon.remote, {
        agentId: 'ticket-spawn',
        agentTitle: `File ticket · ${t.slice(0, 48)}`,
        engine,
        model: deps.remoteEngineModel(daemon.remote, engine, model),
        steps: [{ label: 'file ticket', prompt }],
        inPlace: true,
      })
    },
  )
  handle('tickets:update', async (_e, slug: string, patch: TicketPatch) => {
    const daemon = deps.activeDaemon()
    const before = await daemon.ticketGet(slug)
    const ok = await daemon.ticketUpdate(slug, patch)
    if (ok && patch.status) {
      const t = await daemon.ticketGet(slug)
      const unblocked = before?.status === 'stuck' && patch.status !== 'stuck'
      emitActivity({
        kind: patch.status === 'closed' ? 'ticket-closed' : 'info',
        title: unblocked
          ? `Ticket unblocked · #${t?.id ?? slug}`
          : `Ticket ${patch.status} · #${t?.id ?? slug}`,
        detail: unblocked ? `${t?.title || slug} · ${patch.status}` : t?.title,
        repo: daemon.repoLabel(),
        repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
        sessionId: deps.sessionId(),
        ref: t?.id ? { ticket: t.id } : undefined,
      })
    } else if (ok && patch.priority) {
      const t = await daemon.ticketGet(slug)
      emitActivity({
        kind: 'info',
        title: `Ticket priority · #${t?.id ?? slug}`,
        detail: `${t?.title || slug} · ${patch.priority}`,
        repo: daemon.repoLabel(),
        repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
        sessionId: deps.sessionId(),
        ref: t?.id ? { ticket: t.id } : undefined,
      })
    }
    return ok
  })
  handle(
    'tickets:comment',
    async (_e, slug: string, input: Partial<NewTicketComment> & { body: string }) => {
      const daemon = deps.activeDaemon()
      // The UI never asks who you are — a human comment is signed with the repo's
      // git identity so the log matches the commits and PRs beside it.
      const kind = input.kind === 'agent' ? 'agent' : 'human'
      const comment: NewTicketComment = {
        ...input,
        kind,
        author:
          input.author?.trim() ||
          (kind === 'agent'
            ? 'agent'
            : await resolveHumanAuthor(
                daemon.kind === 'local' ? daemon.repoRoot() : process.cwd(),
              )),
      }
      const ok = await daemon.ticketComment(slug, comment)
      if (!ok) return false
      const t = await daemon.ticketGet(slug)
      emitActivity({
        kind: 'info',
        title: `Ticket comment · #${t?.id ?? slug}`,
        detail: `${comment.author}: ${comment.body.trim().slice(0, 120)}`,
        repo: daemon.repoLabel(),
        repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
        sessionId: deps.sessionId(),
        ref: t?.id ? { ticket: t.id } : undefined,
      })
      return true
    },
  )
}
