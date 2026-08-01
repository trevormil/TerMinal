// Tier 2, phase 1: capture the screenshots.
//
// It runs under the Playwright runner rather than as a plain Bun script,
// because `_electron.launch()` only reliably attaches to the Electron main
// process from the runner's own Node host. `scripts/ux-taste.ts` shells out to
// it (via playwright.taste.config.ts — its own config, so a bare
// `playwright test` can never run it) and then does the judging.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, repoRootDir } from './app'
import { SURFACES } from './surfaces'

const SHOT_DIR = process.env.UX_TASTE_SHOT_DIR || join(repoRootDir, 'test-results', 'ux-taste')

test('capture the key surfaces', async ({ ux }) => {
  test.setTimeout(300_000)
  mkdirSync(SHOT_DIR, { recursive: true })
  // Fixed viewport: the taste pass judges composition, and a viewport that
  // varies between runs makes every finding unreproducible.
  await ux.page.setViewportSize({ width: 1440, height: 900 })

  const available = new Set(await ux.tabIds())
  const captured: { name: string; path: string; intent: string }[] = []
  for (const s of SURFACES) {
    if (!available.has(s.tab)) continue
    await ux.openTab(s.tab)
    // The ticket detail pane is where a user actually spends time — a list on
    // its own hides most of the surface worth judging.
    if (s.tab === 'tickets') {
      await ux.page
        .getByText('Fixture open ticket')
        .locator('visible=true')
        .first()
        .click()
        .catch(() => {})
    }
    await ux.page.waitForTimeout(2500)
    const path = join(SHOT_DIR, `${s.name}.png`)
    await ux.page.screenshot({ path })
    captured.push({ name: s.name, path, intent: s.intent })
  }
  writeFileSync(join(SHOT_DIR, 'manifest.json'), JSON.stringify(captured, null, 2))
})
