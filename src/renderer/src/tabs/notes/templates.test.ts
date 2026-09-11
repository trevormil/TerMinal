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
