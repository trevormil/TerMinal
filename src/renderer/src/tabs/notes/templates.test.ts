import { matchTemplates, slashCommand, appendSlashTemplate } from './templates'
import { expect, test } from 'bun:test'
import { appendTemplate, NOTE_TEMPLATES } from './templates'
test('templates append without changing existing markdown', () => {
  const checklist = NOTE_TEMPLATES.find((t) => t.id === 'checklist')!
  expect(appendTemplate('', checklist.id)).toBe(checklist.body)
  expect(appendTemplate('# Existing', checklist.id)).toBe('# Existing\n\n' + checklist.body)
  expect(appendTemplate('keep\n\n', checklist.id)).toBe('keep\n\n' + checklist.body)
  expect(appendTemplate('keep', 'unknown')).toBe('keep')
  expect(NOTE_TEMPLATES.map((t) => t.id)).toEqual(['checklist', 'meeting', 'decision'])
})

test('custom templates append verbatim and cannot shadow built-ins', () => {
  const custom = [{ id: 'custom:one', title: 'One', body: '- [ ] Local\n' }]
  expect(appendTemplate('Keep this  ', 'custom:one', custom)).toBe('Keep this  \n\n- [ ] Local\n')
  expect(appendTemplate('Keep', 'missing', custom)).toBe('Keep')
  expect(
    appendTemplate('', 'checklist', [{ id: 'checklist', title: 'Bad', body: 'bad' }]),
  ).toContain('## Checklist')
})

test('slash queries combine built-ins and custom templates with fuzzy name ranking', () => {
  const custom = [{ id: 'custom:1', title: 'Daily meeting', body: 'Daily' }]
  expect(matchTemplates('', custom)).toHaveLength(NOTE_TEMPLATES.length + 1)
  expect(matchTemplates('mtg', custom).map((t) => t.id)).toEqual(['meeting', 'custom:1'])
  expect(matchTemplates('xyz', custom)).toEqual([])
})

test('slash append removes only the command and preserves surrounding text', () => {
  const text = 'Before\n/mtg\nAfter'
  const command = slashCommand(text, 11)!
  expect(command).toEqual({ from: 7, to: 11, query: 'mtg' })
  expect(appendSlashTemplate(text, command, 'meeting')).toBe(
    appendTemplate('Before\n\nAfter', 'meeting'),
  )
  expect(slashCommand('https://site', 12)).toBeNull()
})
