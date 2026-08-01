// The single highest-value test in the suite: the app boots, paints, and says
// nothing alarming while doing it.
//
// The main process bundles to ESM, so `__dirname`/`require` throw at runtime and
// the app dies before painting — a failure invisible to typecheck, unit tests
// and the bundler. The packaging smoke script covers that for the *packaged*
// binary; this covers the same ground for every PR, plus the renderer.

import { test, expect } from './app'

test('the app opens a window and reaches the session UI', async ({ ux }) => {
  expect(await ux.electronApp.windows()).toHaveLength(1)
  await expect(ux.page.locator('[data-tab-id="terminal"]')).toBeVisible()
  // Not the first-run gates: those mean the seeded settings were ignored, which
  // would silently reduce every other test to testing the onboarding screen.
  await expect(ux.page.getByText('Welcome to TerMinal')).toHaveCount(0)
})

test('booting produces no console errors and no uncaught exceptions', async ({ ux }) => {
  // Let the app settle: badges poll, the repo context resolves, the update
  // check fires. Most boot-time errors surface in this window.
  await ux.page.waitForTimeout(3000)
  expect(ux.failures.pageErrors, 'uncaught exceptions in the renderer').toEqual([])
  expect(ux.failures.console, 'console.error/warn during boot').toEqual([])
  expect(await ux.failures.rejections(), 'unhandled promise rejections during boot').toEqual([])
})
