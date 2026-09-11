import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './app'

test('Files git gutter renders saved changes and its toggle survives reopening', async ({ ux }) => {
  writeFileSync(join(ux.sandbox.repo, 'README.md'), '# changed fixture\n\nUX suite fixture repo.\n')
  // The harness window is hidden; simulate focus without showing the daily-driver window.
  await ux.page.evaluate(() => {
    document.hasFocus = () => true
  })
  await ux.openTab('files')
  const pane = ux.page.locator('[data-tab-pane="files"]')
  await pane.getByText('README.md', { exact: true }).first().click()
  await expect(pane.locator('.cm-git-modified')).toBeVisible()
  const toggle = pane.getByRole('button', { name: 'Git gutter on' })
  await toggle.click()
  await expect(pane.locator('.cm-git-gutter')).toHaveCount(0)
  await ux.openTab('terminal')
  await ux.openTab('files')
  await pane.getByText('README.md', { exact: true }).first().click()
  await expect(pane.getByRole('button', { name: 'Git gutter off' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await pane.getByRole('button', { name: 'Git gutter off' }).click()
  await expect(pane.locator('.cm-git-modified')).toBeVisible()
  expect(await ux.failures.rejections()).toEqual([])
})
