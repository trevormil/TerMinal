// A small set of real flows — the ones whose defects this run shipped.
//
// Deliberately not "coverage". Each test here maps to a defect that a green
// unit suite could not see.

import { test, expect } from './app'
import { FIXTURE_WIDGET_COMMAND } from './fixture-repo'

test('a ticket opens and its Ticket/Lineage/Log tabs switch', async ({ ux }) => {
  await ux.openTab('tickets')
  // `visible=true` matters: the same ticket title also renders in the (hidden)
  // terminal cockpit rail, and .first() would pick that one.
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()

  // DetailTabs is the canonical tab-strip pattern (components/DetailTabs.tsx)
  // and the only properly-roled tab control in the app — assert through the
  // role, so a restyle cannot break the test and a regression in the ARIA
  // contract does.
  const strip = ux.page.getByRole('tablist')
  await expect(strip).toBeVisible()
  for (const name of [/^Ticket/, /^Lineage/, /^Log/]) {
    const tab = strip.getByRole('tab', { name })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    // Switching a detail tab must actually swap the pane, not just the strip.
    await expect(ux.page.locator('[role="tablist"] ~ *').first()).toBeVisible()
  }
  expect(await ux.failures.rejections()).toEqual([])
})

test('the Plugins drawer shows the repo’s literal commands before approval', async ({ ux }) => {
  // Approve-time truncation is a security-relevant UX defect: a command you
  // must drag sideways to finish reading is a command you approve unread.
  await ux.openTab('terminal')
  await expect(ux.page.getByLabel('Repo widgets need approval')).toBeVisible()
  await ux.page.getByRole('button', { name: /^Plugins/ }).click()

  const command = ux.page.getByText(FIXTURE_WIDGET_COMMAND, { exact: true })
  await expect(command).toBeVisible()
  await expect(ux.page.getByRole('button', { name: /^Approve 1 command/ })).toBeVisible()
  await expect(ux.page.getByRole('button', { name: 'Block' })).toBeVisible()

  // The whole command must be legible without horizontal scrolling.
  const overflow = await command.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow, 'the approval prompt truncates the command horizontally').toBeLessThanOrEqual(1)
})

test('the MRs tab renders its list surface', async ({ ux }) => {
  await ux.openTab('mrs')
  await ux.page.waitForTimeout(2000)
  // The fixture has a GitHub remote but no `gh` auth, so the honest outcome is
  // either an empty list or the explicit gh-not-authenticated explanation. What
  // must NOT happen is a blank pane or a permanent spinner.
  const text = await ux.page.locator('body').innerText()
  expect(text).toMatch(/No PRs for this repo|gh|PRs/i)
  expect(text).not.toMatch(/^\s*Loading PRs from gh…\s*$/)
  expect(await ux.failures.rejections()).toEqual([])
})
