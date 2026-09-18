import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './app'

test('tree creates, renames and deletes a folder containing an open edited file', async ({
  ux,
}) => {
  await ux.openTab('files')
  const pane = ux.page.locator('[data-tab-pane="files"]')
  await pane.getByRole('button', { name: 'Folder', exact: true }).click()
  const input = pane.getByRole('textbox', { name: 'File or folder name' })
  await input.fill('eng-tree')
  await input.press('Enter')
  const folder = pane.getByText('eng-tree', { exact: true }).last()
  await folder.hover()
  await folder.locator('..').getByRole('button', { name: 'New file', exact: true }).click()
  await input.fill('draft.txt')
  await input.press('Enter')
  const editor = pane.locator('.cm-content[contenteditable="true"]')
  await editor.fill('Keep this edit')
  await folder.hover()
  await folder.locator('..').getByRole('button', { name: 'Rename', exact: true }).click()
  await input.fill('eng-renamed')
  await input.press('Enter')
  await expect.poll(() => existsSync(join(ux.sandbox.repo, 'eng-renamed/draft.txt'))).toBe(true)
  expect(readFileSync(join(ux.sandbox.repo, 'eng-renamed/draft.txt'), 'utf8')).toBe(
    'Keep this edit',
  )
  await expect(editor).toHaveText('Keep this edit')
  const renamed = pane.getByText('eng-renamed', { exact: true }).last()
  await renamed.hover()
  await renamed.locator('..').getByRole('button', { name: 'Delete', exact: true }).click()
  expect(existsSync(join(ux.sandbox.repo, 'eng-renamed'))).toBe(true)
  await pane.getByRole('button', { name: 'Cancel delete' }).click()
  expect(existsSync(join(ux.sandbox.repo, 'eng-renamed'))).toBe(true)
  await renamed.hover()
  await renamed.locator('..').getByRole('button', { name: 'Delete', exact: true }).click()
  await pane.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await expect(editor).toHaveCount(0)
  await ux.page.waitForTimeout(900)
  expect(existsSync(join(ux.sandbox.repo, 'eng-tree'))).toBe(false)
  expect(existsSync(join(ux.sandbox.repo, 'eng-renamed'))).toBe(false)
})
