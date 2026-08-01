import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Ticket 111, runner side. `bin/terminal-cron` is a standalone Bun script — it
// cannot import from the app bundle, so it carries its own budget reader. That
// reader is the one that actually gates scheduled spend while nobody is
// watching, and it was the one that failed OPEN.
//
// The real function is extracted OUT of the shipped script rather than copied,
// so this cannot pass against a copy that has drifted from what launchd runs.

const CRON = resolve(import.meta.dir, '../../bin/terminal-cron')

type Refusal = { refused: string }
type Value = { value: Record<string, unknown> | null }
type Reader = () => Refusal | Value

/** Load the real `readBudgetsOrRefuse` from the shipped script, bound to `dir`. */
async function loadReader(dir: string): Promise<Reader> {
  const src = readFileSync(CRON, 'utf8')
  const start = src.indexOf('function readBudgetsOrRefuse()')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\n}\n', start) + 3
  expect(end).toBeGreaterThan(start)

  const mod = join(dir, 'reader.mjs')
  writeFileSync(
    mod,
    `import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const CFG = ${JSON.stringify(dir)}
${src.slice(start, end)}
export { readBudgetsOrRefuse }
`,
  )
  const loaded = (await import(mod)) as { readBudgetsOrRefuse: Reader }
  return loaded.readBudgetsOrRefuse
}

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'tm-cron-budget-'))
}

describe('bin/terminal-cron budget reader fails closed (ticket 111)', () => {
  test('no budgets.json → allowed: no cap was ever configured', async () => {
    const read = await loadReader(fixture())
    expect(read()).toEqual({ value: null })
  })

  test('a valid budgets.json → the caps come through', async () => {
    const dir = fixture()
    writeFileSync(join(dir, 'budgets.json'), JSON.stringify({ dailyTotalUsd: 20 }))
    const read = await loadReader(dir)
    expect(read()).toEqual({ value: { dailyTotalUsd: 20 } })
  })

  test('a TORN write is refused, not read as "no cap"', async () => {
    const dir = fixture()
    // Exactly what the app leaves behind when killed mid-write. The old reader
    // returned true here and spawned the run unbounded.
    writeFileSync(join(dir, 'budgets.json'), '{"dailyTotalUsd": 20, "perAge')
    const read = await loadReader(dir)
    const got = read() as Refusal
    expect(got.refused).toMatch(/corrupt/i)
    expect(got.refused).toMatch(/no cap/i)
  })

  test('a parseable file of the wrong shape is refused too', async () => {
    const dir = fixture()
    writeFileSync(join(dir, 'budgets.json'), '[]')
    const read = await loadReader(dir)
    expect((read() as Refusal).refused).toMatch(/refusing/i)
  })

  test('an empty file is treated as absent, not as corruption', async () => {
    // `touch budgets.json` must not wedge every scheduled run forever.
    const dir = fixture()
    writeFileSync(join(dir, 'budgets.json'), '')
    const read = await loadReader(dir)
    expect(read()).toEqual({ value: null })
  })

  test('a $20 cap hidden behind a torn read is never reported as $0', async () => {
    // The concrete failure from the ticket: the cap is real, the file is
    // mid-write, and the runner must not conclude the account is uncapped.
    const dir = fixture()
    writeFileSync(join(dir, 'budgets.json'), '{"dailyTotalUsd": 20, "perAge')
    const read = await loadReader(dir)
    const got = read()
    expect('value' in got).toBe(false)
  })
})
