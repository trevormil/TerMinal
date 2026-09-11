export const NOTE_TEMPLATES = [
  {
    id: 'checklist',
    title: 'Checklist',
    body: '## Checklist\n\n- [ ] First task\n- [ ] Second task\n',
  },
  {
    id: 'meeting',
    title: 'Meeting',
    body: '## Meeting\n\nDate: \nAttendees: \n\n### Agenda\n\n- \n\n### Action items\n\n- [ ] \n',
  },
  {
    id: 'decision',
    title: 'Decision',
    body: '## Decision\n\n### Context\n\n\n### Options\n\n- \n\n### Decision and next steps\n\n- [ ] \n',
  },
]
export function appendTemplate(content: string, id: string): string {
  const template = NOTE_TEMPLATES.find((t) => t.id === id)
  if (!template) return content
  const separator =
    !content || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
  return content + separator + template.body
}
