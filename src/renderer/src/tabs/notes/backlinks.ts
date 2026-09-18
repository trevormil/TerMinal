import { mentionedTickets } from './mentions'
import type { LocalNote } from '../../../../shared/types/knowledge'
export function noteBacklinks(
  notes: LocalNote[],
  ticket: Parameters<typeof mentionedTickets>[1][number],
) {
  return notes.filter((note) => mentionedTickets(note.content, [ticket]).length > 0)
}
export function noteNavigation(note: LocalNote): Record<string, unknown> {
  return note.view === 'path'
    ? { path: note.path }
    : {
        scope: note.scope,
        view: note.view,
        itemId: note.itemId,
        categoryId: note.categoryId,
      }
}
