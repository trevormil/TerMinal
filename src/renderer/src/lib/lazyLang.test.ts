import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadedLangs, loadLangs } from './lazyLang'
import { ALL_LANG_KEYS } from '../../../shared/languages'

describe('lazy grammar loading', () => {
  test('nothing is loaded before the first request', () => {
    // NOTE: this asserts the cache starts cold, NOT that the barrel is absent
    // from the bundle — `cached` is only written by loadLangs(), so a stray
    // static import elsewhere would leave this green. The bundling guarantee
    // is pinned by the source-level test below instead.
    expect(loadedLangs()).toBeNull()
  })

  test('no renderer source statically imports the grammar barrel', () => {
    // THIS is the real guarantee: one static import anywhere in the renderer
    // graph pulls all ~7.2 MB back into the initial chunk and silently undoes
    // the split. Scans source rather than trusting module state.
    const root = join(import.meta.dir, '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts')) {
          const src = readFileSync(full, 'utf8')
          // A dynamic `import('…')` is the sanctioned form; `from '…'` is not.
          if (/from\s+'@uiw\/codemirror-extensions-langs'/.test(src)) offenders.push(full)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  test('concurrent callers share a single import', async () => {
    const [a, b] = await Promise.all([loadLangs(), loadLangs()])
    expect(a).toBe(b)
  })

  test('the resolved barrel is cached for later synchronous use', async () => {
    const langs = await loadLangs()
    expect(loadedLangs()).toBe(langs)
    expect(await loadLangs()).toBe(langs)
  })

  test('every key the shared resolver can emit exists in the loaded barrel', async () => {
    // Guards the seam: langKeyFor promising a key the barrel does not have
    // would silently mean "no highlighting" for that file type.
    const langs = await loadLangs()
    const missing = ALL_LANG_KEYS.filter((k) => typeof (langs as never)[k] !== 'function')
    expect(missing).toEqual([])
  })
})
