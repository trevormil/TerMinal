import { test, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// src/main bundles to ESM. The createRequire(import.meta.url) shim resolves
// relative specifiers against the emitted out/main/index.js, which has no
// sibling modules — so `require('./x')` throws MODULE_NOT_FOUND in the packaged
// app (silently, if swallowed). Static/dynamic `import` bundles correctly.
// This guard fails if a relative require is reintroduced. Same root cause as
// the documented ESM __dirname gotcha. (backlog #17)

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('no relative require() under src/main (ESM bundle would throw)', () => {
  const dir = join(import.meta.dir)
  const offenders: string[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const code = stripComments(readFileSync(join(dir, name), 'utf8'))
    const re = /\brequire\(\s*['"]\.\.?\//g
    if (re.test(code)) offenders.push(name)
  }
  expect(offenders).toEqual([])
})
