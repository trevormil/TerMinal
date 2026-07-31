// Reachability: every tab a user can turn on actually opens.
//
// This is the test the whole suite exists for. A bake-off tab shipped visibly
// broken with a green 1868-test suite, a clean typecheck and six adversarial
// reviews: it auto-registered via `import.meta.glob`, its badge polled an IPC
// channel nobody handled, and opening it hung on "Loading…" forever. Nothing
// static could see it, because the module was simply never wired.
//
// So the enumeration comes from the filesystem, not a list in this file. A tab
// added tomorrow is covered tomorrow.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, repoRootDir } from './app'

const TABS_DIR = join(repoRootDir, 'src', 'renderer', 'src', 'tabs')

/** Tab ids excluded from the tab bar by registry.ts — parsed from the registry
 *  itself so this test cannot drift from it. */
function overlayIds(): string[] {
  const src = readFileSync(join(TABS_DIR, 'registry.ts'), 'utf8')
  const line = src.match(/t\.id !== .*/g)?.join(' ') || ''
  return [...line.matchAll(/t\.id !== '([^']+)'/g)].map((m) => m[1])
}

/** Every tab folder on disk. */
function tabFolders(): string[] {
  return readdirSync(TABS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

test('every registered tab is reachable from the tab bar', async ({ ux }) => {
  const expected = tabFolders().filter((id) => !overlayIds().includes(id))
  const rendered = await ux.tabIds()
  // The fixture repo is deliberately fully provisioned (git + forge remote +
  // backlog + agents) and the sandbox pins a panel, so every tab's appliesTo()
  // gate is satisfied. A tab missing here is a tab that cannot be opened at all.
  expect(rendered.filter((id) => id !== 'terminal').sort()).toEqual(expected)
})

test('opening every tab produces no errors and leaves a non-blank pane', async ({ ux }) => {
  const ids = await ux.tabIds()
  expect(ids.length).toBeGreaterThan(10) // guard against a vacuous pass

  const stuck: string[] = []
  const blank: string[] = []
  for (const id of ids) {
    await ux.openTab(id)
    // Let the tab's own effects run: most tabs fetch over IPC on mount, and the
    // failure mode being hunted here (an unhandled channel) surfaces as a
    // rejection one tick later, not synchronously.
    await ux.page.waitForTimeout(1200)

    // The pane the user is looking at, not the whole document — several panes
    // stay mounted, so `body` would mask a tab that rendered nothing.
    const pane = id === 'terminal' ? ux.page.locator('body') : ux.page.locator(`[data-tab-pane]`)
    await expect(pane).toBeVisible()
    const text = ((await pane.innerText()) || '').trim()
    if (/Loading[.…]/.test(text) && text.length < 200) stuck.push(`${id}: ${text.slice(0, 80)}`)
    if (text.length < 10) blank.push(`${id}: ${JSON.stringify(text)}`)
  }

  expect(ux.failures.pageErrors, 'uncaught exceptions while opening tabs').toEqual([])
  expect(await ux.failures.rejections(), 'unhandled rejections while opening tabs').toEqual([])
  expect(ux.failures.console, 'console errors while opening tabs').toEqual([])
  expect(stuck, 'tabs still showing only "Loading…" after settling').toEqual([])
  expect(blank, 'tabs that rendered nothing at all').toEqual([])
})
