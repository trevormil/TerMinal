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
const channelsIn = (text: string): string[] =>
  [...text.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1])
const handlersIn = (file: string): string[] => channelsIn(source(file))

// Every channel main registers, from BOTH halves: the registrar modules in this
// directory and the handlers still living in index.ts.
const INDEX_SRC = readFileSync(join(DIR, '..', 'index.ts'), 'utf8')
const ALL_HANDLED = [...MODULES.flatMap(handlersIn), ...channelsIn(INDEX_SRC)]

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

  test('every channel the preload invokes is handled somewhere in main', () => {
    // UNION, not a prefix heuristic. A prefix like `sessions:` is split across
    // this directory AND index.ts, so "every channel whose prefix we own must be
    // handled HERE" reports dozens of false orphans the moment a stack lands a
    // sibling handler in index.ts. Taking the union of both is also the stronger
    // assertion: it catches a channel the preload invokes that nobody handles
    // anywhere, which is the failure that actually reaches a user.
    const handled = new Set(ALL_HANDLED)
    const invoked = [
      ...readFileSync(PRELOAD, 'utf8').matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g),
    ].map((m) => m[1])

    expect(invoked.length).toBeGreaterThan(0)
    expect(invoked.filter((c) => !handled.has(c))).toEqual([])
  })

  test('no channel is registered twice — the second ipcMain.handle throws', () => {
    // Two stacks each adding a handler for the same channel merges cleanly and
    // then throws at boot ("Attempted to register a second handler"). Nothing
    // else in the suite would notice.
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const c of ALL_HANDLED) {
      if (seen.has(c)) duplicates.add(c)
      seen.add(c)
    }
    expect([...duplicates]).toEqual([])
  })
})
