import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './app'

test('Run check is manual and reports configured checker failures', async ({ ux }) => {
  writeFileSync(
    join(ux.sandbox.repo, 'package.json'),
    JSON.stringify({
      scripts: { check: 'echo "src/example.ts: type mismatch" && exit 1', lint: 'echo clean' },
    }),
  )
  await ux.openTab('files')
  const pane = ux.page.locator('[data-tab-pane="files"]')
  await expect(pane.getByRole('region', { name: 'Local diagnostics' })).toHaveCount(0)
  await pane.getByRole('button', { name: 'Run check', exact: true }).click()
  const diagnostics = pane.getByRole('region', { name: 'Local diagnostics' })
  await expect(diagnostics).toContainText('type mismatch')
  await expect(diagnostics.getByRole('status')).toHaveCount(0)
  await diagnostics.getByRole('button', { name: 'Run selected check' }).click()
  await expect(diagnostics.getByRole('status')).toContainText('Check failed (exit 1)')
  await expect(diagnostics.getByRole('status')).toContainText('src/example.ts: type mismatch')
  await diagnostics.getByLabel('Local checker').selectOption('script:lint')
  await diagnostics.getByRole('button', { name: 'Run selected check' }).click()
  await expect(diagnostics.getByRole('status')).toContainText('Check passed')
})

test('path notes save independently and survive switching Notes views', async ({ ux }) => {
  await ux.openTab('notes')
  const pane = ux.page.locator('[data-tab-pane="notes"]')
  await pane.getByRole('button', { name: 'Path notes', exact: true }).click()
  const path = pane.getByRole('textbox', { name: 'Note path', exact: true })
  const content = pane.getByRole('textbox', { name: 'Path note content' })
  await path.fill('src/example.ts')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await content.fill('A local file note')
  await pane.getByRole('button', { name: 'Items', exact: true }).click()
  await pane.getByRole('button', { name: 'Path notes', exact: true }).click()
  await expect(content).toHaveValue('A local file note')
  await pane.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(pane.getByRole('status')).toContainText('Saved locally')
  await path.fill('src')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await expect(content).toHaveValue('')
  await content.fill('A folder note')
  await pane.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(pane.getByRole('status')).toContainText('Saved locally')
  await path.fill('./src/example.ts')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await expect(content).toHaveValue('A local file note')
})

test('Files links an open file to its notes and gives an actionable no-checker state', async ({
  ux,
}) => {
  writeFileSync(join(ux.sandbox.repo, 'note-target.txt'), 'A local file')
  writeFileSync(join(ux.sandbox.repo, 'package.json'), '{}')
  await ux.openTab('files')
  const files = ux.page.locator('[data-tab-pane="files"]')
  await files.getByText('note-target.txt', { exact: true }).click()
  await files.getByRole('button', { name: 'Run check', exact: true }).click()
  await expect(files.getByRole('region', { name: 'Local diagnostics' })).toContainText(
    'No checker configured',
  )
  await files.getByRole('button', { name: 'File notes', exact: true }).click()
  const notes = ux.page.locator('[data-tab-pane="notes"]')
  await expect(notes.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'note-target.txt',
  )
  await expect(notes.getByRole('textbox', { name: 'Path note content' })).toBeVisible()
  await notes.getByRole('textbox', { name: 'Note path', exact: true }).fill('other-folder')
  await notes.getByRole('button', { name: 'Open path' }).click()
  await ux.openTab('files')
  await files.getByText('note-target.txt', { exact: true }).click()
  await files.getByRole('button', { name: 'File notes', exact: true }).click()
  await expect(notes.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'note-target.txt',
  )
})
