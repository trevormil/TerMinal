export type HitlRecurrenceInput = {
  title?: string
  action?: string
  detail?: string
  repo?: string
  repoRoot?: string
  sessionId?: string
}

export function normalizeHitlIssue(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .replace(/\b(run|job|task|session|request)[-_:#\s]*[a-z0-9-]{6,}\b/g, '$1 ')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\/[^\s]+/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hitlRecurrenceKey(input: HitlRecurrenceInput): string {
  const issue = normalizeHitlIssue(
    [input.title, input.action, input.detail].filter(Boolean).join(' '),
  )
  const scope = input.sessionId || input.repoRoot || input.repo || ''
  return `${issue}|${scope}`
}
