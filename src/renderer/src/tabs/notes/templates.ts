import type { NoteTemplate } from '../../../../shared/note-templates'
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
export function appendTemplate(content: string, id: string, custom: NoteTemplate[] = []): string {
  const template = [...NOTE_TEMPLATES, ...custom].find((t) => t.id === id)
  if (!template) return content
  const separator =
    !content || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
  return content + separator + template.body
}

export type SlashCommand = { from: number; to: number; query: string }
export function slashCommand(content: string, cursor: number): SlashCommand | null {
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(content.slice(0, cursor))
  return match ? { from: cursor - match[1].length - 1, to: cursor, query: match[1] } : null
}

export function matchTemplates(query: string, custom: NoteTemplate[] = []): NoteTemplate[] {
  const q = query.toLowerCase()
  const score = (title: string) => {
    const name = title.toLowerCase()
    let position = -1
    let cost = 0
    for (const char of q) {
      position = name.indexOf(char, position + 1)
      if (position < 0) return Infinity
      cost += position
    }
    return cost
  }
  return [...NOTE_TEMPLATES, ...custom]
    .map((template) => ({ template, score: score(template.title) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.template)
}

export function appendSlashTemplate(
  content: string,
  command: SlashCommand,
  id: string,
  custom: NoteTemplate[] = [],
): string {
  if (![...NOTE_TEMPLATES, ...custom].some((t) => t.id === id)) return content
  return appendTemplate(content.slice(0, command.from) + content.slice(command.to), id, custom)
}
