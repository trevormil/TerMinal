import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Reachability guard.
//
// Every module in this directory is dead code until src/main/index.ts calls its
// registrar, and "tests pass" says nothing about that. These assertions pin the
// two halves of the contract a human wiring it up depends on:
//
//   1. each module really exports a register*Ipc function, and
//   2. every channel the preload invokes is really handled by one of them.
//
// A renamed export or a typo'd channel string fails here instead of failing
// silently at runtime as an unhandled-invoke rejection. Modules are discovered
// from disk so this keeps working as the stack adds more of them.

const DIR = import.meta.dir
const PRELOAD = join(DIR, '..', '..', 'preload', 'index.ts')

const MODULES = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

const source = (file: string): string => readFileSync(join(DIR, file), 'utf8')
const handlersIn = (file: string): string[] =>
  [...source(file).matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1])

describe('IPC registrars', () => {
  test('the directory actually contains registrar modules', () => {
    expect(MODULES.length).toBeGreaterThan(0)
  })

  // Source analysis rather than `await import()`: these modules transitively
  // import electron, which does not load under `bun test`. That is also why
  // nothing else imports them — and exactly why this guard is needed.
  for (const file of MODULES) {
    test(`${file} exports a register*Ipc function`, () => {
      expect(source(file)).toMatch(/export function register\w*Ipc\s*\(/)
    })

    test(`${file} registers at least one handler`, () => {
      expect(handlersIn(file).length).toBeGreaterThan(0)
    })
  }

  test('index.ts actually calls every registrar — a module nobody wires is dead', () => {
    // The reachability half. `inbox.ts` shipped unregistered once: the
    // renderer's snooze and delivery-log invokes rejected as unhandled, so the
    // feature was silently inert and nothing said so.
    const index = readFileSync(join(DIR, '..', 'index.ts'), 'utf8')
    const unwired = MODULES.flatMap((f) =>
      [...source(f).matchAll(/export function (register\w*Ipc)\s*\(/g)].map((m) => m[1]),
    ).filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(index))
    expect(unwired).toEqual([])
  })

  test('every registrar name is unique, so index.ts can import them together', () => {
    const names = MODULES.flatMap((f) =>
      [...source(f).matchAll(/export function (register\w*Ipc)\s*\(/g)].map((m) => m[1]),
    )
    expect(new Set(names).size).toBe(names.length)
  })

  test('every channel the preload invokes is handled by some registrar', () => {
    const handled = new Set(MODULES.flatMap(handlersIn))
    // Only the prefixes this directory owns — the rest live in index.ts.
    const owned = [...new Set([...handled].map((c) => `${c.split(':')[0]}:`))]
    const invoked = [
      ...readFileSync(PRELOAD, 'utf8').matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g),
    ]
      .map((m) => m[1])
      .filter((c) => owned.some((p) => c.startsWith(p)))

    expect(invoked.length).toBeGreaterThan(0)
    expect(invoked.filter((c) => !handled.has(c))).toEqual([])
  })
})
