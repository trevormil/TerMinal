import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The Telegram command set lives in three places that must not drift:
//   1. the `handle()` dispatch switch          (src/main/telegram.ts)
//   2. the /help reply                          (cmdHelp, same file)
//   3. the Settings → Telegram command reference (SettingsPanel.tsx)
//
// (3) silently rotted — it was missing /bg and /budget long before /feature
// was added. These are text-level checks on purpose: the renderer can't import
// from src/main, and a hand-curated two-column UI list is not worth deriving
// from a shared constant. This test is the cheap thing that catches the drift.

const repoRoot = join(import.meta.dir, '..', '..')
const telegramSrc = readFileSync(join(repoRoot, 'src/main/telegram.ts'), 'utf8')
const settingsSrc = readFileSync(
  join(repoRoot, 'src/renderer/src/components/SettingsPanel.tsx'),
  'utf8',
)

/** Commands intentionally absent from the user-facing reference lists:
 *  aliases and the entry points you don't need to be told about. */
const UNDOCUMENTED = new Set(['/help', '/start', '/whoami', '/pr', '/prs'])

function dispatchedCommands(): string[] {
  const cases = telegramSrc.matchAll(/case '(\/[\w-]+)':/g)
  const all = [...cases].map((m) => m[1])
  expect(all.length).toBeGreaterThan(20) // guard: the regex still matches the switch
  return all.filter((c) => !UNDOCUMENTED.has(c))
}

/** `/run` must not be satisfied by `/runs`, so require a non-word char after. */
const mentions = (haystack: string, cmd: string) =>
  new RegExp(`${cmd.replace('/', '\\/')}(?![\\w-])`).test(haystack)

describe('telegram command reference stays in sync', () => {
  const commands = dispatchedCommands()

  test('every dispatched command appears in the /help reply', () => {
    const help = telegramSrc.slice(
      telegramSrc.indexOf('function cmdHelp'),
      telegramSrc.indexOf('function cmdRepos'),
    )
    expect(help.length).toBeGreaterThan(100)
    const missing = commands.filter((c) => !mentions(help, c))
    expect(missing).toEqual([])
  })

  test('every dispatched command appears in the Settings command reference', () => {
    const missing = commands.filter((c) => !mentions(settingsSrc, c))
    expect(missing).toEqual([])
  })

  test('/feature is documented in both surfaces', () => {
    expect(commands).toContain('/feature')
    expect(mentions(settingsSrc, '/feature')).toBe(true)
  })

  test('the alias allowlist only holds commands that really are dispatched', () => {
    const dispatched = new Set([...telegramSrc.matchAll(/case '(\/[\w-]+)':/g)].map((m) => m[1]))
    for (const alias of UNDOCUMENTED) expect(dispatched.has(alias)).toBe(true)
  })
})
