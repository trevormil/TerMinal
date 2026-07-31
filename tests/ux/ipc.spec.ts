// The live version of the static IPC channel audit.
//
// `src/main/ipc/registrars.test.ts` already asserts, by reading source text,
// that every channel the preload invokes is handled somewhere in main. That
// check broke on merge twice — source-text analysis says a handler *exists*,
// not that `index.ts` actually reached the line that registers it. A registrar
// behind an early return, a module import that throws, a conditional wire-up:
// all invisible offline, all fatal at runtime.
//
// So this asserts the same property against the running main process, reading
// Electron's own handler table.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, repoRootDir } from './app'

/** Channels the renderer can invoke, parsed from the single preload bridge. */
function invokedChannels(): string[] {
  const src = readFileSync(join(repoRootDir, 'src', 'preload', 'index.ts'), 'utf8')
  const found = [...src.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1])
  return [...new Set(found)].sort()
}

test('every channel the preload can invoke is handled by the running main process', async ({
  ux,
}) => {
  const invoked = invokedChannels()
  expect(invoked.length).toBeGreaterThan(50) // the parse found something real

  // `_invokeHandlers` is Electron's own private registry for ipcMain.handle().
  // Private, but it is the only source of truth for "handled right now" — and a
  // read-only peek in a test is exactly the right place to depend on it. If a
  // future Electron renames it this test fails loudly rather than silently.
  const registered = await ux.electronApp.evaluate(({ ipcMain }) => {
    const table = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers
    return table ? [...table.keys()] : null
  })
  expect(registered, 'ipcMain._invokeHandlers is gone — update this test').not.toBeNull()

  const handled = new Set(registered as string[])
  expect(
    invoked.filter((c) => !handled.has(c)),
    'channels the renderer can invoke but the live main process never registered',
  ).toEqual([])
})
