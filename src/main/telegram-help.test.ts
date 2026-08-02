import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMAND_SPECS } from './telegram-commands'

// The Settings → Telegram command reference (SettingsPanel.tsx) silently
// rotted — it was missing /bg and /budget long before /feature was added.
// The dispatcher, /help and the NL prompt are held to the COMMAND_SPECS
// registry by telegram-commands.test.ts; this file covers the one surface
// that can't import from src/main at runtime: the renderer's hand-curated
// two-column list. Text-level on purpose — a UI list is not worth deriving
// from a shared constant, but drift must still fail the build.

const repoRoot = join(import.meta.dir, '..', '..')
const settingsSrc = readFileSync(
  join(repoRoot, 'src/renderer/src/components/SettingsPanel.tsx'),
  'utf8',
)

/** Commands intentionally absent from the user-facing reference list:
 *  aliases and the entry points you don't need to be told about. */
const UNDOCUMENTED = new Set(['/help', '/start', '/whoami', '/pr', '/prs'])

/** `/run` must not be satisfied by `/runs`, so require a non-word char after. */
const mentions = (haystack: string, cmd: string) =>
  new RegExp(`${cmd.replace('/', '\\/')}(?![\\w-])`).test(haystack)

describe('the Settings telegram command reference stays in sync', () => {
  const commands = COMMAND_SPECS.flatMap((s) => s.cmds).filter((c) => !UNDOCUMENTED.has(c))

  test('the registry still resolves a real command set', () => {
    expect(commands.length).toBeGreaterThan(20)
  })

  test('every dispatched command appears in the Settings command reference', () => {
    const missing = commands.filter((c) => !mentions(settingsSrc, c))
    expect(missing).toEqual([])
  })

  test('/feature is documented', () => {
    expect(commands).toContain('/feature')
    expect(mentions(settingsSrc, '/feature')).toBe(true)
  })

  test('the alias allowlist only holds commands that really exist', () => {
    const all = new Set(COMMAND_SPECS.flatMap((s) => s.cmds))
    for (const alias of UNDOCUMENTED) expect(all.has(alias)).toBe(true)
  })
})
