import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Settings shows exactly one category at a time, chosen from SETTING_NAV, and a
// <Section id> renders only when it is the selected one. That makes the two
// lists a contract: a nav entry with no Section is a dead link to a blank pane,
// and a Section with no nav entry is unreachable. Neither shows up in a
// typecheck, so pin it here — the panel is a single 3.4k-line file and these
// lists sit ~1500 lines apart.
const src = readFileSync(join(import.meta.dir, 'SettingsPanel.tsx'), 'utf8')

const navIds = [...src.matchAll(/\{ id: '([\w-]+)', title: '[^']+', icon: \w+ \}/g)].map(
  (m) => m[1],
)
// The daemon pane predates the <Section> helper and is a plain <section> gated
// on the same id, so it is nav-only by design.
const NAV_ONLY = ['daemon']
const sectionIds = [...src.matchAll(/<Section\s+id="([\w-]+)"/g)].map((m) => m[1])

describe('settings categories', () => {
  test('the nav and the section list are both non-trivial (the regexes still match)', () => {
    expect(navIds.length).toBeGreaterThan(10)
    expect(sectionIds.length).toBeGreaterThan(10)
  })

  test('every nav entry resolves to a pane, so no category opens blank', () => {
    const orphans = navIds.filter((id) => !NAV_ONLY.includes(id) && !sectionIds.includes(id))
    expect(orphans).toEqual([])
  })

  test('every section is reachable from the nav, so none is orphaned', () => {
    expect(sectionIds.filter((id) => !navIds.includes(id))).toEqual([])
  })

  test('no id is duplicated in either list', () => {
    expect(new Set(navIds).size).toBe(navIds.length)
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
  })

  test('the default category is one the nav actually offers', () => {
    const fallback = src.match(/:\s*'([\w-]+)',\s*\n\s*\)\n/)?.[1]
    expect(navIds).toContain(fallback ?? 'daemon')
  })
})
