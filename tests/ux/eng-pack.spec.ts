import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './app'

test('tracked quick-open navigates to a filename with spaces, then optional formatting saves locally', async ({
  ux,
}) => {
  const name = 'Quick Open Target.ts'
  writeFileSync(join(ux.sandbox.repo, name), 'const answer=42;\n')
  execFileSync('git', ['add', '--', name], { cwd: ux.sandbox.repo })
  await ux.page.keyboard.press('Meta+k')
  const input = ux.page.getByPlaceholder('Jump to anything', { exact: false })
  await input.fill('Quick Open Target')
  await ux.page.locator('button[data-idx]').filter({ hasText: name }).click()
  await expect(ux.page.locator('[data-tab-id="files"]').first()).toHaveAttribute(
    'aria-current',
    'page',
  )
  const editor = ux.page.locator('.cm-editor .cm-content').locator('visible=true').first()
  await expect(editor).toContainText('const answer=42;')
  await editor.click()
  await ux.page.keyboard.press('Meta+s')
  await expect
    .poll(() => readFileSync(join(ux.sandbox.repo, name), 'utf8'))
    .toBe('const answer=42;\n')
  await ux.page.evaluate(async () => {
    const settings = await window.gt.settings.patch({ apps: { formatOnSave: true } })
    window.dispatchEvent(new CustomEvent('gt.settings.changed', { detail: settings }))
  })
  await ux.page.keyboard.press('Meta+s')
  await expect
    .poll(() => readFileSync(join(ux.sandbox.repo, name), 'utf8'))
    .toBe('const answer = 42;\n')
  expect(await ux.failures.rejections()).toEqual([])
})

test('timeline selects recorded turn context and soft-cap controls warn and clear', async ({
  ux,
}) => {
  const id = '00000000-0000-4000-8000-000000000001'
  const dir = join(
    ux.sandbox.home,
    '.claude',
    'projects',
    ux.sandbox.repo.replace(/[^a-zA-Z0-9]/g, '-'),
  )
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${id}.jsonl`),
    [
      { type: 'user', message: { role: 'user', content: 'First timeline request' } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'First timeline answer' }],
          usage: { input_tokens: 100000, output_tokens: 100 },
        },
      },
      { type: 'user', message: { role: 'user', content: 'Second timeline request' } },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await ux.page.evaluate(() => {
    localStorage.setItem('gt.enabled', JSON.stringify(['context', 'session-timeline']))
    localStorage.setItem('gt.workColumn.cockpit.collapsed', '0')
    localStorage.setItem('gt.cockpitCollapsed', '0')
  })
  await ux.page.reload()
  const turns = ux.page.getByLabel('Session timeline turn', { exact: true })
  await expect(turns).toBeVisible()
  await expect(ux.page.getByRole('region', { name: 'Turn context' })).toContainText(
    'Second timeline request',
  )
  await turns.selectOption('1')
  await expect(ux.page.getByRole('region', { name: 'Turn context' })).toContainText(
    'First timeline answer',
  )
  await ux.page.getByRole('button', { name: 'Follow latest' }).click()
  await expect(ux.page.getByRole('region', { name: 'Turn context' })).toContainText(
    'Second timeline request',
  )
  await ux.page.locator('summary').filter({ hasText: 'Soft cap: off' }).first().click()
  const cap = ux.page.getByLabel('Context soft cap percentage')
  await cap.fill('1')
  await expect(
    ux.page.getByRole('status').filter({ hasText: 'Context reached your 1% soft cap' }),
  ).toBeVisible()
  await cap.fill('')
  await expect(ux.page.getByRole('status').filter({ hasText: 'soft cap' })).toHaveCount(0)
  expect(await ux.failures.rejections()).toEqual([])
})
