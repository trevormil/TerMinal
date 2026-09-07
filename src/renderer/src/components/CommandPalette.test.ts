import { expect, test } from 'bun:test'
import { trackedFilenameItems } from './CommandPalette'
import { fuzzyRank, parseQuickOpen } from '../../../shared/fuzzy'

test('tracked filename mode ranks paths and opens the exact path including spaces', () => {
  const opened: string[] = []
  const parsed = parseQuickOpen('my file')
  const items = trackedFilenameItems(
    parsed.mode,
    ['src/My File.ts', 'other/My File.ts', 'README.md'],
    (path) => opened.push(path),
  )
  const matches = fuzzyRank(parsed.term, items, (item) => `${item.label} ${item.hint}`)
  expect(matches).toHaveLength(2)
  expect(new Set(matches.map((m) => m.item.id)).size).toBe(2)
  matches.find((m) => m.item.hint === 'src/My File.ts')!.item.run()
  expect(opened).toEqual(['src/My File.ts'])
})

test('tracked filenames stay out of content-search and explicit command modes', () => {
  for (const query of ['#needle', '>commands', '@symbol', ':42']) {
    expect(trackedFilenameItems(parseQuickOpen(query).mode, ['needle.ts'], () => {})).toEqual([])
  }
  expect(trackedFilenameItems('files', [], () => {})).toEqual([])
})
