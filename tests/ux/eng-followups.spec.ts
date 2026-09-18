import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './app'

test('local symbol search jumps to definitions and reports misses', async ({ ux }) => {
  await ux.openTab('files')
  const pane = ux.page.locator('[data-tab-pane="files"]')
  await pane.getByRole('button', { name: 'File', exact: true }).click()
  const input = pane.getByRole('textbox', { name: 'File or folder name' })
  await input.fill('symbols.ts')
  await input.press('Enter')
  const editor = pane.locator('.cm-content[contenteditable="true"]')
  await editor.fill('const localValue = 1\nlocalValue')
  await pane.getByLabel('Local symbol', { exact: true }).fill('localValue')
  await pane.getByRole('button', { name: 'Find symbol', exact: true }).click()
  await pane.getByRole('button', { name: 'localValue:1', exact: true }).click()
  await expect
    .poll(() => ux.page.evaluate(() => window.getSelection()?.toString()))
    .toBe('localValue')
  await pane.getByLabel('Local symbol', { exact: true }).fill('missing')
  await pane.getByRole('button', { name: 'Find symbol', exact: true }).click()
  await expect(pane.getByRole('status')).toContainText('No local definition found')
})

test('ticket backlinks show empty state and navigate to saved scoped notes', async ({ ux }) => {
  await ux.openTab('tickets')
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()
  const backlinks = ux.page.getByRole('region', { name: 'Notes mentioning this ticket' })
  await expect(backlinks).toContainText('No saved notes mention this ticket.')
  await ux.page.evaluate(async () => {
    await window.gt.notes.write('global', 'Reference 0001-fixture-open')
  })
  await ux.openTab('notes')
  await ux.openTab('tickets')
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()
  await backlinks.getByRole('button', { name: 'global scratch (global)' }).click()
  await expect(
    ux.page.locator('[data-tab-pane="notes"] .cm-content').locator('visible=true').first(),
  ).toContainText('Reference 0001-fixture-open')
  expect(await ux.failures.rejections()).toEqual([])
})

test('GitLab discussion reply failures preserve the draft and retry succeeds', async ({ ux }) => {
  await ux.electronApp.evaluate(({ ipcMain }) => {
    const mr = {
      iid: 46,
      title: 'GitLab discussion fixture',
      state: 'opened',
      author: 'reviewer',
      webUrl: 'https://gitlab.example.com/group/repo/-/merge_requests/46',
      sourceBranch: 'feature',
      targetBranch: 'main',
      draft: false,
      review: null,
      labels: [],
      workedBy: [],
      description: '',
      reviewMd: '',
      reviewMeta: null,
      findings: [],
      suggestions: [],
      screenshots: [],
      artifactShortSha: '',
      headShort: '',
    }
    const responses: Record<string, unknown> = {
      'mrs:list': { mrs: [mr] },
      'mrs:get': mr,
      'mrs:ci': null,
      'mrs:overview': null,
      'github-review:conversation': {
        supported: true,
        forge: 'gitlab',
        reviewDecision: '',
        reviewers: [],
        comments: [],
        reviews: [],
        markers: [],
        threads: [
          {
            id: 'discussion',
            discussionId: 'discussion',
            path: 'file.ts',
            line: 1,
            diffSide: 'RIGHT',
            resolved: false,
            resolvable: true,
            outdated: false,
            replyToId: null,
            comments: [
              {
                id: '1',
                databaseId: 1,
                body: 'Please check this',
                login: 'reviewer',
                avatarUrl: '',
                createdAt: '2026-09-17T12:00:00Z',
                url: '',
              },
            ],
          },
        ],
      },
    }
    for (const [channel, value] of Object.entries(responses)) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => value)
    }
    const conversation = responses['github-review:conversation'] as {
      threads: { resolved: boolean }[]
    }
    let resolves = 0
    ipcMain.removeHandler('github-review:gitlab-resolve')
    ipcMain.handle('github-review:gitlab-resolve', (_event, _repo, iid, discussion, resolved) => {
      if (iid !== 46 || discussion !== 'discussion' || typeof resolved !== 'boolean')
        throw new Error('Wrong resolution target')
      if (++resolves === 1) return { ok: false, error: 'GitLab resolution permission denied' }
      conversation.threads[0].resolved = resolved
      return { ok: true }
    })
    let attempts = 0
    ipcMain.removeHandler('github-review:gitlab-reply')
    ipcMain.handle('github-review:gitlab-reply', (_event, _repo, iid, discussion, body) => {
      if (iid !== 46 || discussion !== 'discussion' || body !== 'Keep my draft')
        throw new Error('Wrong reply target')
      return ++attempts === 1
        ? { ok: false, error: 'GitLab authentication required' }
        : { ok: true }
    })
  })
  await ux.openTab('mrs')
  await ux.page.getByText('GitLab discussion fixture', { exact: true }).first().click()
  await ux.page.getByRole('button', { name: /^Findings/ }).click()
  await ux.page.getByRole('button', { name: 'Open review threads' }).click()
  await expect(ux.page.getByText('Please check this', { exact: true })).toBeVisible()
  await ux.page.getByRole('button', { name: 'Reply', exact: true }).click()
  const draft = ux.page.getByPlaceholder('Reply in this thread…')
  await draft.fill('Keep my draft')
  await ux.page.getByRole('button', { name: 'Resolve discussion', exact: true }).click()
  await expect(ux.page.getByRole('alert')).toContainText('GitLab resolution permission denied')
  await expect(draft).toHaveValue('Keep my draft')
  await expect(ux.page.getByText('Please check this', { exact: true })).toBeVisible()
  await ux.page.getByRole('button', { name: 'Resolve discussion', exact: true }).click()
  await expect(
    ux.page.getByRole('button', { name: 'Unresolve discussion', exact: true }),
  ).toBeVisible()
  await expect(draft).toHaveValue('Keep my draft')
  await ux.page.getByRole('button', { name: 'Unresolve discussion', exact: true }).click()
  await expect(
    ux.page.getByRole('button', { name: 'Resolve discussion', exact: true }),
  ).toBeVisible()
  await ux.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(ux.page.getByRole('alert')).toContainText('GitLab authentication required')
  await expect(draft).toHaveValue('Keep my draft')
  await ux.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(draft).toHaveCount(0)
  expect(await ux.failures.rejections()).toEqual([])
})

test('tracked symbol search opens another file and outline follows the live buffer', async ({
  ux,
}) => {
  writeFileSync(join(ux.sandbox.repo, 'target.ts'), 'export function distant() {}\n')
  execFileSync('git', ['add', '--', 'target.ts'], { cwd: ux.sandbox.repo })
  await ux.openTab('files')
  const pane = ux.page.locator('[data-tab-pane="files"]')
  await pane.getByRole('button', { name: 'File', exact: true }).click()
  const input = pane.getByRole('textbox', { name: 'File or folder name' })
  await input.fill('source.ts')
  await input.press('Enter')
  await pane.locator('.cm-content[contenteditable="true"]').fill('const nearby = 1\ndistant()')
  await expect(pane.getByRole('navigation', { name: 'Current file outline' })).toHaveCount(0)
  await pane.getByRole('button', { name: 'Outline', exact: true }).click()
  const outline = pane.getByRole('navigation', { name: 'Current file outline' })
  await outline.getByRole('button', { name: 'nearby:1', exact: true }).click()
  await expect.poll(() => ux.page.evaluate(() => window.getSelection()?.toString())).toBe('nearby')
  await pane.locator('.cm-content[contenteditable="true"]').fill('callOnly()')
  await expect(outline).toContainText('No declarations in this buffer.')
  await pane.getByLabel('Local symbol', { exact: true }).fill('distant')
  await pane.getByRole('button', { name: 'Search tracked files', exact: true }).click()
  await pane.getByRole('button', { name: 'target.ts:1 — distant', exact: true }).click()
  await expect(pane.locator('.cm-content[contenteditable="true"]')).toContainText(
    'export function distant',
  )
  await pane.getByLabel('Local symbol', { exact: true }).fill('absent')
  await pane.getByRole('button', { name: 'Search tracked files', exact: true }).click()
  await expect(pane.getByRole('status')).toContainText('No tracked definition found')
  expect(await ux.failures.rejections()).toEqual([])
})
