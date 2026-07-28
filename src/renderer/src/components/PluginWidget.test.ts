import { describe, expect, test } from 'bun:test'
import { SquareTerminal } from 'lucide-react'
import { pluginPollSubscriptionKey } from './PluginWidget'
import type { Plugin } from '../lib/types'

const plugin = (poll: Plugin['poll'], intervalMs = 1000): Plugin => ({
  id: 'tickets-open',
  title: 'Open Tickets',
  icon: SquareTerminal,
  blurb: '',
  intervalMs,
  defaultEnabled: true,
  poll,
  render: () => null,
})

describe('pluginPollSubscriptionKey', () => {
  test('stays stable when parent renders recreate an equivalent plugin object', () => {
    const first = plugin(async () => 'first')
    const next = plugin(async () => 'next')

    expect(pluginPollSubscriptionKey(next)).toBe(pluginPollSubscriptionKey(first))
  })

  test('changes when polling cadence changes', () => {
    const first = plugin(async () => 'first')
    const next = plugin(async () => 'next', 2000)

    expect(pluginPollSubscriptionKey(next)).not.toBe(pluginPollSubscriptionKey(first))
  })
})
