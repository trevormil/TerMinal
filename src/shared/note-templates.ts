export type NoteTemplate = { id: string; title: string; body: string }

export function normalizeNoteTemplates(value: unknown): NoteTemplate[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .filter((item): item is NoteTemplate => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id.startsWith('custom:') ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        typeof item.body !== 'string' ||
        !item.body.trim() ||
        seen.has(item.id)
      )
        return false
      seen.add(item.id)
      return true
    })
    .map(({ id, title, body }) => ({ id, title, body }))
}
