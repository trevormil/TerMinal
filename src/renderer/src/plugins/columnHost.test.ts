import { describe, expect, test } from 'bun:test'
import tickets from './tickets/index'
import mrSummary from './mr-summary/index'
import { COLUMN_PLUGIN_IDS } from '../lib/workColumn'
import type { Mr, Ticket } from '../lib/types'

// The accordion picks its sections out of the registry BY ID. A typo (or a
// renamed plugin) would silently leave the section missing from the column and
// the widget still in the cockpit, so pin the two together.
describe('the work column hosts the real plugin specs', () => {
  test('COLUMN_PLUGIN_IDS matches the plugins it names', () => {
    expect([tickets.id, mrSummary.id]).toEqual([...COLUMN_PLUGIN_IDS])
  })

  test('both expose a count for the section header', () => {
    expect(typeof tickets.count).toBe('function')
    expect(typeof mrSummary.count).toBe('function')
  })
})

const ticket = (status: string): Ticket => ({ status }) as Ticket
const mr = (state: string): Mr => ({ iid: 1, state, title: '', sourceBranch: '' }) as Mr

describe('tickets count', () => {
  test('counts active tickets and ignores closed ones', () => {
    const d = [ticket('open'), ticket('in-progress'), ticket('stuck'), ticket('closed')]
    expect(tickets.count!(d)).toBe(3)
  })

  test('stays quiet before the first poll rather than showing 0', () => {
    expect(tickets.count!(null)).toBeNull()
  })

  test('a genuinely empty backlog counts 0, which is real data', () => {
    expect(tickets.count!([])).toBe(0)
  })
})

describe('mr-summary count', () => {
  test('counts open PRs and ignores merged/closed ones', () => {
    expect(mrSummary.count!({ mrs: [mr('opened'), mr('opened'), mr('merged')] })).toBe(2)
  })

  test('an errored poll counts nothing — the header shows no pill', () => {
    expect(mrSummary.count!({ mrs: [], error: 'no forge remote' })).toBeNull()
  })

  test('stays quiet before the first poll', () => {
    expect(mrSummary.count!(null)).toBeNull()
  })
})
