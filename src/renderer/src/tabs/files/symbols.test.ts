import { expect, test } from 'bun:test'
import { localDefinitions, symbolAt } from './symbols'

test('finds declarations with exact identifiers and line positions', () => {
  const source = 'export async function fetchThing() {}\nconst other = 2\nfetchThing()'
  expect(localDefinitions(source, 'fetchThing')).toEqual([
    { name: 'fetchThing', line: 1, offset: 22 },
  ])
  expect(localDefinitions(source, 'fetch')).toEqual([])
  expect(symbolAt(source, source.length - 3)).toBe('fetchThing')
})
test('supports common local declaration forms and empty/no-op cases', () => {
  expect(
    localDefinitions('class Widget {}\ntype Shape = {}\ndef compute():\n', '').map((x) => x.name),
  ).toEqual(['Widget', 'Shape', 'compute'])
  expect(localDefinitions('// const fake = 1\n  /* function nope() */', '')).toEqual([])
  expect(symbolAt('  ', 1)).toBe('')
  expect(localDefinitions('callOnly()', 'callOnly')).toEqual([])
})
