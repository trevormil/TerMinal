import { describe, expect, test } from 'bun:test'
import {
  COLUMN_PLUGIN_IDS,
  initialSectionCollapsed,
  isColumnPlugin,
  partitionPluginHosts,
} from './workColumn'
import { readCollapsed, sectionCollapseKey, writeCollapsed } from './panelCollapse'

const p = (id: string) => ({ id })

describe('partitionPluginHosts', () => {
  test('sends the column plugins to the column and everything else to the cockpit', () => {
    const { cockpit, column } = partitionPluginHosts([
      p('session'),
      p('tickets'),
      p('usage'),
      p('mr-summary'),
    ])

    expect(cockpit.map((x) => x.id)).toEqual(['session', 'usage'])
    expect(column.map((x) => x.id)).toEqual(['tickets', 'mr-summary'])
  })

  test('the two hosts never share a plugin — no plugin can poll twice', () => {
    const all = [p('session'), p('tickets'), p('usage'), p('mr-summary'), p('todos')]
    const { cockpit, column } = partitionPluginHosts(all)

    const ids = [...cockpit, ...column].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(all.map((x) => x.id).sort())
  })

  test('column order follows COLUMN_PLUGIN_IDS, not registry order', () => {
    const { column } = partitionPluginHosts([p('mr-summary'), p('tickets')])
    expect(column.map((x) => x.id)).toEqual(['tickets', 'mr-summary'])
  })

  test('a column id with no matching plugin is dropped, not rendered as a hole', () => {
    const { column } = partitionPluginHosts([p('tickets')])
    expect(column.map((x) => x.id)).toEqual(['tickets'])
  })
})

describe('initialSectionCollapsed — cockpit → accordion migration', () => {
  // The migration is read-only: it never rewrites gt.enabled/gt.known/
  // gt.widgetOrder, it only reads them to decide the FIRST render.
  test('a widget the user had hidden in the cockpit starts collapsed', () => {
    expect(initialSectionCollapsed('tickets', true, ['tickets', 'usage'], ['usage'])).toBe(true)
  })

  test('a widget the user had visible in the cockpit starts expanded', () => {
    expect(initialSectionCollapsed('tickets', true, ['tickets'], ['tickets'])).toBe(false)
  })

  test('a widget hidden in the cockpit is not forced open by defaultEnabled', () => {
    // The whole trap: `defaultEnabled: true` must not override an explicit hide.
    expect(initialSectionCollapsed('mr-summary', true, ['mr-summary'], [])).toBe(true)
  })

  test('a fresh install (never known) falls back to defaultEnabled', () => {
    expect(initialSectionCollapsed('tickets', true, [], [])).toBe(false)
    expect(initialSectionCollapsed('tickets', false, [], [])).toBe(true)
  })

  test('known-but-empty-enabled is an opinion; unknown is not', () => {
    // Same `enabled: []`, opposite answers — `known` is the signal that
    // distinguishes "user turned it off" from "user has never seen it".
    expect(initialSectionCollapsed('tickets', true, ['tickets'], [])).toBe(true)
    expect(initialSectionCollapsed('tickets', true, ['other'], [])).toBe(false)
  })
})

describe('section collapse persistence', () => {
  const fake = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    }
  }

  test('keys are per-section, so sections collapse independently', () => {
    expect(sectionCollapseKey('files')).not.toBe(sectionCollapseKey('tickets'))
    expect(sectionCollapseKey('tickets')).toBe('gt.workColumn.tickets.collapsed')
  })

  test('an explicit toggle wins over the migrated default forever after', () => {
    const s = fake()
    const key = sectionCollapseKey('tickets')
    // Migration said "collapsed" (cockpit had it hidden); user expands it.
    writeCollapsed(key, false, s)
    expect(readCollapsed(key, /* migrated */ true, s)).toBe(false)
  })

  test('several sections stay open at once — collapse is not mutually exclusive', () => {
    const s = fake()
    for (const id of ['files', ...COLUMN_PLUGIN_IDS])
      writeCollapsed(sectionCollapseKey(id), false, s)
    const open = ['files', ...COLUMN_PLUGIN_IDS].filter(
      (id) => !readCollapsed(sectionCollapseKey(id), true, s),
    )
    expect(open).toEqual(['files', 'tickets', 'mr-summary'])
  })
})

describe('isColumnPlugin', () => {
  test('only the migrated widgets belong to the column', () => {
    expect(isColumnPlugin('tickets')).toBe(true)
    expect(isColumnPlugin('mr-summary')).toBe(true)
    expect(isColumnPlugin('session')).toBe(false)
  })
})
