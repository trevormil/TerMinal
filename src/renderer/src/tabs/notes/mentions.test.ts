import { test, expect } from 'bun:test'
import { mentionedTickets, ticketMentionNavigation } from './mentions'
const local = { slug: '0037-create-pr', externalKey: undefined, linear: undefined }
const linear = { slug: 'linear-abc', externalKey: 'TER-37', linear: undefined }
test('resolves ids and markdown slugs once with exact boundaries', () => {
  expect(mentionedTickets('#TER-37 TER-37 (0037-create-pr.md)', [local, linear])).toEqual([
    local,
    linear,
  ])
  expect(
    mentionedTickets('XTER-37 TER-370 10037-create-pr 0037-create-pr-extra', [local, linear]),
  ).toEqual([])
  expect(mentionedTickets('unresolved TER-38', [local, linear])).toEqual([])
})
test('navigation selects local tickets and opens Linear native views', () => {
  expect(ticketMentionNavigation(local)).toEqual({ slug: local.slug })
  expect(
    ticketMentionNavigation({
      ...linear,
      provider: 'linear',
      url: 'https://linear.app/test/issue/TER-37',
    }),
  ).toEqual({ slug: linear.slug, viewUrl: 'https://linear.app/test/issue/TER-37' })
})
