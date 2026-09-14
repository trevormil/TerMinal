import { execFileSync } from 'node:child_process'
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

test('note templates append and persist in Global, Repo, and Path notes', async ({ ux }) => {
  await ux.openTab('notes')
  const pane = ux.page.locator('[data-tab-pane="notes"]')
  await pane.getByRole('button', { name: 'Scratch', exact: true }).click()
  for (const scope of ['Global', 'Repo']) {
    await pane.getByRole('button', { name: scope, exact: true }).click()
    await pane.getByLabel('Append note template').selectOption('checklist')
    await expect(pane.locator('.cm-content')).toContainText('First task')
    await expect(pane.getByText('saved', { exact: true })).toBeVisible()
  }
  await pane.getByRole('button', { name: 'Path notes', exact: true }).click()
  await pane.getByLabel('Note path', { exact: true }).fill('src/template.ts')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await pane.getByLabel('Path note content').fill('Existing note')
  await pane.getByLabel('Append note template').selectOption('meeting')
  await expect(pane.getByLabel('Path note content')).toHaveValue(/Existing note\n\n## Meeting/)
  await pane.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(pane.getByRole('status')).toContainText('Saved locally')
  await pane.getByLabel('Note path', { exact: true }).fill('src/other.ts')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await expect(pane.getByLabel('Path note content')).toHaveValue('')
  await pane.getByLabel('Note path', { exact: true }).fill('src/template.ts')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await expect(pane.getByLabel('Path note content')).toHaveValue(/Existing note\n\n## Meeting/)
})

test('custom note templates survive reopen and ticket mentions navigate', async ({ ux }) => {
  await ux.openTab('notes')
  const pane = ux.page.locator('[data-tab-pane="notes"]')
  await pane.getByRole('button', { name: 'Path notes', exact: true }).click()
  await pane.getByLabel('Note path', { exact: true }).fill('src/custom.ts')
  await pane.getByRole('button', { name: 'Open path' }).click()
  await pane.getByLabel('Path note content').fill('Keep my text')
  await pane.getByRole('button', { name: 'Custom templates', exact: true }).click()
  await pane.getByLabel('Template name').fill('Local follow-up')
  await pane.getByLabel('Template markdown').fill('- [ ] See 0001-fixture-open.md')
  await pane.getByRole('button', { name: 'Save template', exact: true }).click()
  await expect(pane.getByLabel('Template name')).toHaveValue('')
  await pane.getByRole('button', { name: 'Close', exact: true }).click()
  await pane.getByLabel('Append note template').selectOption({ label: 'Local follow-up' })
  await expect(pane.getByLabel('Path note content')).toHaveValue(
    'Keep my text\n\n- [ ] See 0001-fixture-open.md',
  )
  await pane.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(pane.getByRole('status')).toContainText('Saved locally')
  await pane.getByRole('button', { name: /0001-fixture-open · Fixture open ticket/ }).click()
  await expect(ux.page.locator('[data-tab-pane="tickets"]')).toBeVisible()
  await expect(ux.page.getByRole('tablist')).toBeVisible()
  await ux.openTab('notes')
  await pane.getByRole('button', { name: 'Scratch', exact: true }).click()
  await pane.getByRole('button', { name: 'Custom templates', exact: true }).click()
  await expect(pane.getByLabel('Custom note templates')).toContainText('Local follow-up')
})

test('ticket forge creation offers editable branches without creating during inspection', async ({
  ux,
}) => {
  await ux.openTab('tickets')
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()
  await ux.page.getByRole('button', { name: 'Create PR/MR', exact: true }).click()
  const dialog = ux.page.getByRole('dialog')
  await expect(dialog.getByLabel('Source branch')).toHaveValue('main')
  await dialog.getByRole('button', { name: 'Use ticket branch name' }).click()
  await expect(dialog.getByLabel('Source branch')).toHaveValue('1-fixture-open-ticket')
  await dialog.getByLabel('Source branch').fill('my/custom-branch')
  await dialog.getByLabel('Target branch').fill('main')
  await expect(dialog.getByRole('button', { name: 'Create PR', exact: true })).toBeEnabled()
  await expect(dialog.getByLabel('PR/MR description')).toContainText('0001-fixture-open')
})

test('ticket forge creation explains missing and unsupported remotes', async ({ ux }) => {
  await ux.openTab('tickets')
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()
  execFileSync('git', ['remote', 'remove', 'origin'], { cwd: ux.sandbox.repo })
  await ux.page.getByRole('button', { name: 'Create PR/MR', exact: true }).click()
  await expect(ux.page.getByRole('dialog').getByRole('status')).toContainText('origin remote')
  await ux.page.keyboard.press('Escape')
  execFileSync('git', ['remote', 'add', 'origin', 'https://bitbucket.org/fixture/repo.git'], {
    cwd: ux.sandbox.repo,
  })
  await ux.page.getByRole('button', { name: 'Create PR/MR', exact: true }).click()
  await expect(ux.page.getByRole('dialog').getByRole('status')).toContainText('unsupported')
})
