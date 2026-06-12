import { navigateTo } from './nav'
import type { Engine, Persona, RemoteSession, TabContext } from './types'

export type LaunchMode = 'process' | 'terminal'

export const engineInstanceLabel = (engine: Engine): string =>
  engine === 'claude' ? 'Claude Code' : engine === 'cursor' ? 'Cursor Agent' : 'Codex'

export function openPromptInTerminal(input: {
  engine: Engine
  cwd: string
  name: string
  prompt: string
  ticketSlug?: string
  remote?: RemoteSession
}): void {
  navigateTo('terminal:new', {
    engine: input.engine,
    cwd: input.cwd,
    name: input.name,
    initialInput: input.prompt,
    ticketSlug: input.ticketSlug,
    remote: input.remote,
  })
}

export function remoteForTabContext(ctx: TabContext): RemoteSession | undefined {
  if (ctx.remoteSession?.sshTarget) return { ...ctx.remoteSession, cwd: ctx.repoRoot || ctx.cwd || ctx.remoteSession.cwd }
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
    lines.push(`\nAgent context: ${opts.runContext.title} (${opts.runContext.id})\n\n${opts.runContext.prompt}`)
  } else if (opts.persona) {
    lines.push(`\nAgent context: ${opts.persona}`)
  }
  if (opts.pipeline && opts.pipeline !== 'single') lines.push(`Pipeline: ${opts.pipeline}`)
  if (opts.model) lines.push(`Preferred model: ${opts.model}`)
  return lines.filter(Boolean).join('\n')
}
