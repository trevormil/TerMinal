import { navigateTo } from './nav'
import type { Engine, Persona, RemoteSession, TabContext } from './types'

export type LaunchMode = 'process' | 'terminal'

/**
 * When a Terminal-tab session's pty exits, should we re-spawn the pane as a
 * local login shell instead of leaving a dead "process exited" pane?
 *
 * Yes for an attached engine (claude/codex/…) running locally. No for a remote
 * session (a local shell would be the wrong host) and no once we've already
 * dropped to a shell (its own exit ends the pane, so we don't loop).
 */
export function shouldDropToShellOnExit(input: {
  isRemote: boolean
  isLocalShell: boolean
}): boolean {
  return !input.isRemote && !input.isLocalShell
}

export const engineInstanceLabel = (engine: Engine): string =>
  engine === 'claude'
    ? 'Claude Code'
    : engine === 'cursor'
      ? 'Cursor Agent'
      : engine === 'hermes'
        ? 'Hermes'
        : engine === 'openrouter'
          ? 'OpenRouter'
          : engine === 'openai-compat'
            ? 'Self-hosted'
            : 'Codex'

export function openPromptInTerminal(input: {
  engine: Engine
  cwd: string
  name: string
  prompt: string
  model?: string
  ticketSlug?: string
  remote?: RemoteSession
  openrouterHarness?: 'codex' | 'hermes'
}): void {
  navigateTo('terminal:new', {
    engine: input.engine,
    cwd: input.cwd,
    name: input.name,
    initialInput: input.prompt,
    model: input.model,
    ticketSlug: input.ticketSlug,
    remote: input.remote,
    openrouterHarness: input.openrouterHarness,
  })
}

export function remoteForTabContext(ctx: TabContext): RemoteSession | undefined {
  if (ctx.remoteSession?.sshTarget)
    return { ...ctx.remoteSession, cwd: ctx.repoRoot || ctx.cwd || ctx.remoteSession.cwd }
  if (!ctx.remote || !ctx.remoteSshTarget) return undefined
  return {
    hostId: ctx.remoteHostId || ctx.remoteSshTarget,
    label: ctx.remoteLabel || ctx.remoteSshTarget,
    sshTarget: ctx.remoteSshTarget,
    cwd: ctx.repoRoot || ctx.cwd || '~',
    platform: ctx.remotePlatform,
    daemon: ctx.remoteDaemon,
  }
}

export function withLaunchContext(
  prompt: string,
  opts: { persona?: string; pipeline?: string; model?: string; runContext?: Persona } = {},
): string {
  const lines = [prompt.trim()]
  if (opts.runContext) {
    lines.push(
      `\nAgent context: ${opts.runContext.title} (${opts.runContext.id})\n\n${opts.runContext.prompt}`,
    )
  } else if (opts.persona) {
    lines.push(`\nAgent context: ${opts.persona}`)
  }
  if (opts.pipeline && opts.pipeline !== 'single') lines.push(`Pipeline: ${opts.pipeline}`)
  if (opts.model) lines.push(`Preferred model: ${opts.model}`)
  return lines.filter(Boolean).join('\n')
}
