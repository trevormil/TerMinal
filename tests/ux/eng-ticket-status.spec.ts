import { test, expect } from './app'

test('detail status select persists through the local provider', async ({ ux }) => {
  await ux.openTab('tickets')
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()
  const status = ux.page.getByRole('combobox', { name: 'Ticket status' })
  await status.selectOption('in-progress')
  await expect(status).toHaveValue('in-progress')
  await ux.openTab('files')
  await ux.openTab('tickets')
  await ux.page.getByText('Fixture open ticket').locator('visible=true').first().click()
  await expect(status).toHaveValue('in-progress')
  expect(await ux.failures.rejections()).toEqual([])
})
