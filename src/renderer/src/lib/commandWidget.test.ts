import { describe, expect, test } from 'bun:test'
import { commandWidgetsToPlugins } from './commandWidget'
import type { CommandWidget } from './types'

const widget = (overrides: Partial<CommandWidget> = {}): CommandWidget => ({
  id: 'tickets-open',
  title: 'Open Tickets',
  command: 'terminal-cli ticket list --state open',
  intervalMs: 10_000,
  mode: 'text',
  source: 'repo',
  ...overrides,
})

describe('commandWidgetsToPlugins', () => {
  test('reuses plugin and poll identity for unchanged widget definitions', () => {
    const first = commandWidgetsToPlugins([widget()])
    const next = commandWidgetsToPlugins([widget()], first)

    expect(next[0]).toBe(first[0])
    expect(next[0].poll).toBe(first[0].poll)
  })

  test('replaces plugin when the command changes', () => {
    const first = commandWidgetsToPlugins([widget()])
    const next = commandWidgetsToPlugins(
      [widget({ command: 'terminal-cli ticket list --hitl' })],
      first,
    )

    expect(next[0]).not.toBe(first[0])
    expect(next[0].poll).not.toBe(first[0].poll)
  })
})
