// Capture the README screenshots (ticket 98).
//
// The old images leaked `~/CompSci/gauntlet/TerMinal` in the README HERO and
// `/Users/trevormiller/.config/TerMinal/...` in the Agents shot. They were
// taken by pointing a camera at the developer's real daily-driver instance, so
// the leak was inevitable — the fix cannot be "be more careful next time".
//
// So these are captured from the UX suite's SANDBOX instead: a throwaway HOME,
// a throwaway config dir, a fixture repo, and every engine pinned to a stub.
// There is no personal state in the process to leak. The paths are clean by
// CONSTRUCTION rather than by scrubbing, which is the only version of this that
// stays true the next time someone regenerates them.
//
// Run via `bun run shots` (scripts/capture-readme-shots.ts), not the UX suite —
// it lives behind its own Playwright config so a bare `playwright test` can
// never fire it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, repoRootDir } from './app'

const SHOT_DIR = process.env.README_SHOT_DIR || join(repoRootDir, 'test-results', 'readme-shots')

/** Exactly the images README.md references — nothing speculative. */
const SHOTS = [
  { tab: 'terminal', name: 'terminal', hero: true },
  { tab: 'tickets', name: 'tickets', hero: false },
  { tab: 'agents', name: 'agents', hero: false },
  { tab: 'runs', name: 'runs', hero: false },
  { tab: 'schedules', name: 'schedules', hero: false },
] as const

test('capture the README surfaces', async ({ ux }) => {
  test.setTimeout(300_000)
  mkdirSync(SHOT_DIR, { recursive: true })

  // 1600x1000. The hero renders at 900px wide in the README, so this is ~1.8x
  // — enough to stay sharp on a retina display without shrinking the UI's own
  // type until the screenshot stops looking like the app.
  //
  // These exact numbers are also the provenance guard: readme-shots.test.ts
  // asserts every committed image is exactly this size, which a hand-taken
  // screenshot never is. That is the closest thing to "prove it came from the
  // sandbox" available without OCR — see ticket 98, where a text-only grep was
  // shipped and could not see the leak because the leak was pixels.
  await ux.page.setViewportSize({ width: 1600, height: 1000 })

  const available = new Set(await ux.tabIds())
  const captured: string[] = []

  for (const shot of SHOTS) {
    if (!available.has(shot.tab)) continue
    await ux.openTab(shot.tab)

    // A bare list is a worse advert than a list with something selected — and
    // for tickets/agents the detail pane is most of what the tab actually is.
    if (shot.tab === 'tickets') {
      await ux.page
        .getByText('Fixture open ticket')
        .locator('visible=true')
        .first()
        .click()
        .catch(() => {})
    }

    // Let polling widgets settle. Without this the cockpit is caught mid-load
    // and ships a screenshot full of em-dashes.
    await ux.page.waitForTimeout(3000)
    const path = join(SHOT_DIR, `${shot.name}.png`)
    await ux.page.screenshot({ path })
    captured.push(path)
  }

  writeFileSync(join(SHOT_DIR, 'manifest.json'), JSON.stringify(captured, null, 2))
  // A capture that silently produced nothing would otherwise look like success
  // and quietly leave the leaking images in place.
  if (captured.length !== SHOTS.length) {
    throw new Error(`captured ${captured.length}/${SHOTS.length} surfaces`)
  }
})
