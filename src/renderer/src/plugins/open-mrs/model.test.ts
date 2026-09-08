import { expect, test } from 'bun:test'
import { openMrsView } from './model'
import type { MrListResult } from '../../lib/types'

test('counts only open states including drafts', () => {
  const data = {
    mrs: [
      { state: 'opened', draft: true },
      { state: 'merged' },
      { state: 'closed' },
      { state: 'opened' },
    ],
  } as MrListResult
  expect(openMrsView(data)).toEqual({ count: 2, limited: false })
})
test('keeps errors distinct from zero and exposes the list cap', () => {
  expect(openMrsView({ mrs: [], error: 'Sign in with gh auth login' })).toEqual({
    error: 'Sign in with gh auth login',
  })
  expect(openMrsView({ mrs: [] })).toEqual({ count: 0, limited: false })
  expect(
    openMrsView({ mrs: Array.from({ length: 100 }, () => ({ state: 'closed' })) } as MrListResult),
  ).toEqual({ count: 0, limited: true })
})
