import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES } from './themes'

/* applyTheme only writes the tokens a theme declares, so any token a theme omits
   silently keeps whatever :root last set — in practice the dark default, even in
   light mode. These tests pin every theme to the :root token list. */
const rootTokens = (() => {
  const css = readFileSync(join(import.meta.dir, '../index.css'), 'utf8')
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
  return [...root.matchAll(/^\s*(--gt-[a-z0-9-]+):/gm)].map((m) => m[1]).sort()
})()

describe('theme tokens', () => {
  test(':root declares the tokens we expect to theme', () => {
    expect(rootTokens.length).toBeGreaterThan(20)
    expect(rootTokens).toContain('--gt-bg')
    expect(rootTokens).toContain('--gt-text-muted-bright')
  })

  test.each(THEMES.map((t) => [t.id, t] as const))('%s declares every :root token', (_id, theme) => {
    for (const mode of ['dark', 'light'] as const) {
      expect(Object.keys(theme.modes[mode]).sort()).toEqual(rootTokens)
    }
  })

  test('theme ids are unique', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('terminal stays first so it remains the applyTheme fallback', () => {
    expect(THEMES[0].id).toBe('terminal')
  })
})
