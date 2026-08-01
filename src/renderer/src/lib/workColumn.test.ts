import { describe, expect, test } from 'bun:test'
import {
  SECTION_PLUGIN_IDS,
  initialSectionCollapsed,
  isSectionPlugin,
  partitionPluginHosts,
} from './workColumn'
import { readCollapsed, sectionCollapseKey, writeCollapsed } from './panelCollapse'

const p = (id: string) => ({ id })

describe('partitionPluginHosts', () => {
  test('promoted plugins get their own section; everything else falls to Cockpit', () => {
    const { cockpit, sections } = partitionPluginHosts([
      p('session'),
      p('tickets'),
      p('usage'),
      p('mr-summary'),
    ])

    expect(cockpit.map((x) => x.id)).toEqual(['session', 'usage'])
    expect(sections.map((x) => x.id)).toEqual(['tickets', 'mr-summary'])
  })

  test('the two section kinds never share a plugin — no plugin can poll twice', () => {
    const all = [p('session'), p('tickets'), p('usage'), p('mr-summary'), p('todos')]
    const { cockpit, sections } = partitionPluginHosts(all)

    const ids = [...cockpit, ...sections].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(all.map((x) => x.id).sort())
  })

  test('every promoted id is absent from Cockpit, whatever order it arrives in', () => {
    // The double-mount guard is one-directional in practice: Cockpit renders
    // whatever it is handed, so a promoted plugin leaking into `cockpit` is the
    // failure that would poll twice.
    const { cockpit } = partitionPluginHosts([p('mr-summary'), p('tickets'), p('git')])
    for (const id of SECTION_PLUGIN_IDS) expect(cockpit.map((x) => x.id)).not.toContain(id)
  })

  test('section order follows SECTION_PLUGIN_IDS, not registry order', () => {
    const { sections } = partitionPluginHosts([p('mr-summary'), p('tickets')])
    expect(sections.map((x) => x.id)).toEqual(['tickets', 'mr-summary'])
  })

  test('a promoted id with no matching plugin is dropped, not rendered as a hole', () => {
    const { sections } = partitionPluginHosts([p('tickets')])
    expect(sections.map((x) => x.id)).toEqual(['tickets'])
  })
})

describe('initialSectionCollapsed — widget → section migration', () => {
  // The migration is read-only: it never rewrites gt.enabled/gt.known/
  // gt.widgetOrder, it only reads them to decide the FIRST render.
  test('a widget the user had hidden starts collapsed as a section', () => {
    expect(initialSectionCollapsed('tickets', true, ['tickets', 'usage'], ['usage'])).toBe(true)
  })

  test('a widget the user had visible starts expanded', () => {
    expect(initialSectionCollapsed('tickets', true, ['tickets'], ['tickets'])).toBe(false)
  })

  test('a hidden widget is not forced open by defaultEnabled', () => {
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
    // Migration said "collapsed" (the widget was hidden); user expands it.
    writeCollapsed(key, false, s)
    expect(readCollapsed(key, /* migrated */ true, s)).toBe(false)
  })

  test('several sections stay open at once — collapse is not mutually exclusive', () => {
    const s = fake()
    const all = ['files', ...SECTION_PLUGIN_IDS, 'cockpit']
    for (const id of all) writeCollapsed(sectionCollapseKey(id), false, s)
    const open = all.filter((id) => !readCollapsed(sectionCollapseKey(id), true, s))
    expect(open).toEqual(['files', 'tickets', 'mr-summary', 'cockpit'])
  })
})

describe('isSectionPlugin', () => {
  test('only the promoted widgets get their own section', () => {
    expect(isSectionPlugin('tickets')).toBe(true)
    expect(isSectionPlugin('mr-summary')).toBe(true)
    expect(isSectionPlugin('session')).toBe(false)
  })
})
