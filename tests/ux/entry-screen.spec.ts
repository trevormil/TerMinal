// The entry screen is one page: every question the chosen intent needs is on
// screen at once, in WHERE-then-WHAT order, with the launch button always
// visible. These pin that shape — no steps to walk — plus the properties the
// ordering exists to guarantee: a target that cannot hold a prior session never
// offers to resume one, and a repo that is already known skips the question.

import { test, expect } from './app'
import type { Page } from '@playwright/test'

const section = (page: Page, id: string) => page.locator(`[data-section="${id}"]`)

/** The fixture repo is fresh, so its one-time orientation modal auto-opens
 *  over everything; close it the way a user would. */
const dismissOrientation = async (page: Page) => {
  const close = page.getByTitle(/^Got it/)
  await close.waitFor({ timeout: 5000 }).catch(() => {})
  if (await close.isVisible()) await close.click()
}

/** The unlocked screen: no repo chosen yet, so the workspace section leads. */
const openEntryScreen = async (page: Page) => {
  await dismissOrientation(page)
  await page.getByRole('banner').getByRole('button', { name: 'workspace' }).click()
  await expect(section(page, 'workspace')).toBeVisible()
}

test('every section shows at once — no step navigation', async ({ ux }) => {
  await openEntryScreen(ux.page)
  await expect(section(ux.page, 'action')).toBeVisible()
  await expect(section(ux.page, 'model')).toBeVisible()
  await expect(ux.page.getByRole('button', { name: /^New session$/ })).toBeVisible()
  await expect(ux.page.getByRole('button', { name: 'Next' })).toHaveCount(0)
  await expect(ux.page.getByRole('button', { name: 'Back' })).toHaveCount(0)
})

test('the workspace section comes before the action section', async ({ ux }) => {
  await openEntryScreen(ux.page)
  const ws = await section(ux.page, 'workspace').boundingBox()
  const action = await section(ux.page, 'action').boundingBox()
  expect(ws!.y).toBeLessThan(action!.y)
})

test('a scratch target never offers to resume a session it cannot have', async ({ ux }) => {
  await openEntryScreen(ux.page)
  await ux.page.getByRole('button', { name: /^Scratch/ }).click()
  await expect(section(ux.page, 'action')).toHaveCount(0)
  await expect(ux.page.getByText('Resume a session')).toHaveCount(0)
  await expect(ux.page.getByRole('button', { name: /Start scratch session/ })).toBeVisible()
})

test('the model section preselects Claude', async ({ ux }) => {
  await openEntryScreen(ux.page)
  await expect(ux.page.getByRole('button', { name: /^Claude/, pressed: true })).toBeVisible()
  await expect(ux.page.getByRole('button', { name: /^Local/, pressed: true })).toHaveCount(0)
  // Claude leads the engine grid; the bare shell trails it.
  const engines = section(ux.page, 'model').locator('button[aria-pressed]')
  await expect(engines.first()).toHaveText(/^Claude/)
  await expect(engines.last()).toHaveText(/^Local/)
})

test('choosing resume swaps the model section for the session list', async ({ ux }) => {
  await openEntryScreen(ux.page)
  await ux.page.getByRole('button', { name: /^Resume a session/ }).click()
  await expect(section(ux.page, 'sessions')).toBeVisible()
  await expect(section(ux.page, 'model')).toHaveCount(0)
})

test('a repo that is already known skips the workspace question', async ({ ux }) => {
  // Adding a session inside an open workspace: the repo is settled, so the
  // screen opens on the action rather than re-asking where.
  await dismissOrientation(ux.page)
  await ux.page
    .getByRole('button', { name: /New session/ })
    .first()
    .click()
  await expect(section(ux.page, 'action')).toBeVisible()
  await expect(section(ux.page, 'workspace')).toHaveCount(0)
})
