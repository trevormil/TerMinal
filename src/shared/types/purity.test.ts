import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// `src/shared/types` is imported by the sandboxed renderer AND by main. One
// `import { app } from 'electron'` in here breaks the renderer build; one
// top-level side effect runs twice. The whole folder must erase to nothing.

const DIR = import.meta.dir
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

// Anything that is not a relative sibling. These modules have no bare deps.
const RELATIVE = /^\.{1,2}\//

// Comments stripped first: this folder's own doc comments name `electron` as
// the thing not to import, and a naive scan flags the warning as the offence.
const specifiers = (src: string): string[] => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1])
}

describe('src/shared/types stays type-only', () => {
  test('there is more than one module to check', () => {
    // Guards the guard: an empty readdir would make every test below vacuous.
    expect(files.length).toBeGreaterThan(10)
  })

  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8')

    test(`${f} imports no electron or node builtin`, () => {
      for (const spec of specifiers(src)) {
        expect(spec, `${f} must not import '${spec}'`).toMatch(RELATIVE)
      }
    })

    test(`${f} declares only types`, () => {
      // A `const`/`function`/`class` here is a runtime value, which means the
      // module no longer erases and the renderer starts shipping main's code.
      for (const line of src.split('\n')) {
        expect(line, `${f}: ${line}`).not.toMatch(
          /^export (const|let|var|function|async function|class|enum) /,
        )
      }
    })

    test(`${f} imports nothing at runtime`, () => {
      for (const line of src.split('\n')) {
        if (!line.startsWith('import ')) continue
        expect(line, `${f}: ${line}`).toMatch(/^import type /)
      }
    })
  }

  test('the barrel re-exports every module in the folder', () => {
    // A file nobody re-exports is a type the renderer cannot see, which sends
    // whoever needs it straight back to hand-copying the declaration.
    const barrel = readFileSync(join(DIR, 'index.ts'), 'utf8')
    for (const f of files) {
      if (f === 'index.ts') continue
      expect(barrel, `${f} is missing from index.ts`).toContain(`'./${f.replace(/\.ts$/, '')}'`)
    }
  })
})
