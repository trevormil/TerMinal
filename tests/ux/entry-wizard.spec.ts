// The entry wizard asks WHERE before WHAT. These pin the properties that
// ordering exists to guarantee — the workspace is settled before any action is
// offered, a target that cannot hold a prior session never offers to resume
// one, and a repo that is already known skips the question entirely — plus the
// rule that a selection never advances a step on its own.

import { test, expect } from './app'
import type { Page } from '@playwright/test'

/** The unlocked wizard: no repo chosen yet, so it opens on the workspace. */
const openWorkspaceWizard = async (page: Page) => {
  await page.getByRole('banner').getByRole('button', { name: 'workspace' }).click()
  await expect(page.getByText('Which workspace?')).toBeVisible()
}
const next = (page: Page) => page.getByRole('button', { name: /^Next/ }).click()

test('the wizard opens on the workspace question, not on an action', async ({ ux }) => {
  await openWorkspaceWizard(ux.page)
  await expect(ux.page.getByRole('button', { name: /^Existing repo/ })).toBeVisible()
  // "What to do" is a step-2 question and must not be on screen yet.
  await expect(ux.page.getByText('What do you want to do here?')).toHaveCount(0)
})

test('selecting a target does not advance the step on its own', async ({ ux }) => {
  await openWorkspaceWizard(ux.page)
  await ux.page.getByRole('button', { name: /^Scratch/ }).click()
  await expect(ux.page.getByText('Which workspace?')).toBeVisible()
})

test('a scratch target never offers to resume a session it cannot have', async ({ ux }) => {
  await openWorkspaceWizard(ux.page)
  await ux.page.getByRole('button', { name: /^Scratch/ }).click()
  await next(ux.page)
  // Scratch has no action to choose — it goes straight to the model question.
  await expect(ux.page.getByText('Which model?')).toBeVisible()
  await expect(ux.page.getByText('Resume a session')).toHaveCount(0)
})

test('the model step preselects Claude, so clicking through lands on it', async ({ ux }) => {
  await openWorkspaceWizard(ux.page)
  await ux.page.getByRole('button', { name: /^Scratch/ }).click()
  await next(ux.page)
  await expect(ux.page.getByText('Which model?')).toBeVisible()
  await expect(ux.page.getByRole('button', { name: /^Claude/, pressed: true })).toBeVisible()
  await expect(ux.page.getByRole('button', { name: /^Local/, pressed: true })).toHaveCount(0)
  // Claude leads the engine grid; the bare shell trails it.
  const engines = ux.page.locator('button[aria-pressed]')
  await expect(engines.first()).toHaveText(/^Claude/)
  await expect(engines.last()).toHaveText(/^Local/)
})

test('an existing repo asks what to do only after the workspace is set', async ({ ux }) => {
  await openWorkspaceWizard(ux.page)
  await ux.page.getByRole('button', { name: /^Existing repo/ }).click()
  await next(ux.page)
  await expect(ux.page.getByText('What do you want to do here?')).toBeVisible()
  await expect(ux.page.getByRole('button', { name: /^Resume a session/ })).toBeVisible()
})

test('a repo that is already known skips the workspace question', async ({ ux }) => {
  // Adding a session inside an open workspace: the repo is settled, so the
  // wizard opens on the action rather than re-asking where.
  await ux.page
    .getByRole('button', { name: /New session/ })
    .first()
    .click()
  await expect(ux.page.getByText('What do you want to do here?')).toBeVisible()
  await expect(ux.page.getByText('Which workspace?')).toHaveCount(0)
})
