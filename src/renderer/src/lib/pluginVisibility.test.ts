import { test, expect, describe } from 'bun:test'
import { reconcileFreshPlugins } from './pluginVisibility'

const p = (id: string, defaultEnabled: boolean) => ({ id, defaultEnabled })

describe('reconcileFreshPlugins', () => {
  test('saved visibility state + unknown new id → defaultEnabled wins (widget shows up)', () => {
    // A user with persisted state from before the `tickets` widget shipped.
    const next = reconcileFreshPlugins([p('todos', true), p('tickets', true)], ['todos'], ['todos'])
    expect(next).toEqual({ known: ['todos', 'tickets'], enabled: ['todos', 'tickets'] })
  })

  test('fresh plugin with defaultEnabled false becomes known but stays hidden', () => {
    const next = reconcileFreshPlugins([p('todos', true), p('niche', false)], ['todos'], ['todos'])
    expect(next).toEqual({ known: ['todos', 'niche'], enabled: ['todos'] })
  })

  test('nothing fresh → null (no state churn)', () => {
    expect(reconcileFreshPlugins([p('todos', true)], ['todos'], ['todos'])).toBeNull()
  })

  test('a known plugin the user disabled is never re-enabled', () => {
    const next = reconcileFreshPlugins(
      [p('todos', true), p('git', true), p('tickets', true)],
      ['todos', 'git'],
      ['todos'], // user turned git off
    )
    expect(next).toEqual({ known: ['todos', 'git', 'tickets'], enabled: ['todos', 'tickets'] })
  })

  test('first run (no saved state) enables every defaultEnabled plugin', () => {
    const next = reconcileFreshPlugins([p('a', true), p('b', false), p('c', true)], [], [])
    expect(next).toEqual({ known: ['a', 'b', 'c'], enabled: ['a', 'c'] })
  })

  test('never duplicates ids already present', () => {
    const next = reconcileFreshPlugins([p('a', true), p('b', true)], ['a'], ['a', 'b'])
    expect(next).toEqual({ known: ['a', 'b'], enabled: ['a', 'b'] })
  })
})
