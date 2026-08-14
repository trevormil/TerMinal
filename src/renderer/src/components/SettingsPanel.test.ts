import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Settings shows exactly one category at a time, chosen from the settings/
// registry, and a <Section id> renders only when it is the selected one. That
// makes the two lists a contract: a nav entry with no Section is a dead link
// to a blank pane, and a Section with no nav entry is unreachable. Neither
// shows up in a typecheck, so pin it here.
//
// SettingsPanel used to be a single 3.4k-line file with both lists ~1500
// lines apart; it's now split into one file per category under settings/
// (registry.ts discovers them via import.meta.glob, same pattern as
// tabs/registry.ts), so the checks below scan that whole directory instead
// of just SettingsPanel.tsx.
const settingsDir = join(import.meta.dir, 'settings')
const src = readdirSync(settingsDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => readFileSync(join(settingsDir, f), 'utf8'))
  .join('\n')

// Each section file exports `const section: SettingsSectionSpec = { id: '…',
// title: '…', icon: …, order: …, ... }`.
const navIds = [
  ...src.matchAll(
    /id:\s*'([\w-]+)',\s*\n\s*title:\s*'[^']*',\s*\n\s*icon:\s*\w+,\s*\n\s*order:\s*\d+,/g,
  ),
].map((m) => m[1])
const sectionIds = [...src.matchAll(/<Section\s+id="([\w-]+)"/g)].map((m) => m[1])

describe('settings categories', () => {
  test('the nav and the section list are both non-trivial (the regexes still match)', () => {
    expect(navIds.length).toBeGreaterThan(10)
    expect(sectionIds.length).toBeGreaterThan(10)
  })

  test('every nav entry resolves to a pane, so no category opens blank', () => {
    expect(navIds.filter((id) => !sectionIds.includes(id))).toEqual([])
  })

  test('every section is reachable from the nav, so none is orphaned', () => {
    expect(sectionIds.filter((id) => !navIds.includes(id))).toEqual([])
  })

  test('no id is duplicated in either list', () => {
    expect(new Set(navIds).size).toBe(navIds.length)
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
  })

  test('the default category is one the nav actually offers', () => {
    const panelSrc = readFileSync(join(import.meta.dir, 'SettingsPanel.tsx'), 'utf8')
    const fallback = panelSrc.match(/:\s*'([\w-]+)',\s*\n\s*\)/)?.[1]
    expect(navIds).toContain(fallback ?? 'daemon')
  })
})

describe('settings shell header', () => {
  test('the SSH host header interpolates the host label, not the host object', () => {
    const panelSrc = readFileSync(join(import.meta.dir, 'SettingsPanel.tsx'), 'utf8')
    expect(panelSrc).toContain('SSH · ${selectedHost.label}')
  })
})

describe('settings storage controls', () => {
  test('paths pane exposes explicit storage reclaim controls', () => {
    expect(src).toContain('storageReport')
    expect(src).toContain('Reclaim leaked state')
    expect(src).toContain('Dry-run estimate')
    expect(src).toContain('Clear scratch')
  })
})
