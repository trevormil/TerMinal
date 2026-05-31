import { navigateTo } from './nav'
import type { Engine } from './types'

export type LaunchMode = 'process' | 'terminal'

export function openPromptInTerminal(input: {
  engine: Engine
  cwd: string
  name: string
  prompt: string
}): void {
  navigateTo('terminal:new', {
    engine: input.engine,
    cwd: input.cwd,
    name: input.name,
    initialInput: input.prompt,
  })
}

export function withLaunchContext(
  prompt: string,
  opts: { persona?: string; pipeline?: string; model?: string } = {},
): string {
  const lines = [prompt.trim()]
  if (opts.persona) lines.push(`\nPersona: ${opts.persona}`)
  if (opts.pipeline && opts.pipeline !== 'single') lines.push(`Pipeline: ${opts.pipeline}`)
  if (opts.model) lines.push(`Preferred model: ${opts.model}`)
  return lines.filter(Boolean).join('\n')
}
