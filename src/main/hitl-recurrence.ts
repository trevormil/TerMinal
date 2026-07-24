import { itemSeverity, shouldNotify, type NotifyThreshold } from './hitl-severity'

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

/** A dedup-window recurrence of an open item: bump the count, surface it as
 *  unread again (the recurrence is new information), and re-run the same
 *  severity-threshold gate a fresh filing gets — an urgent recurrence must
 *  notify even if the original was already read. */
export function hitlRecurrenceBump<
  T extends {
    severity?: string
    readAt?: number
    occurrenceCount?: number
    lastOccurredAt?: number
  },
>(
  prev: T,
  threshold: NotifyThreshold,
): {
  item: Omit<T, 'readAt' | 'occurrenceCount' | 'lastOccurredAt'> & {
    occurrenceCount: number
    lastOccurredAt: number
    readAt?: undefined
  }
  loud: boolean
} {
  const item = {
    ...prev,
    occurrenceCount: (prev.occurrenceCount || 1) + 1,
    lastOccurredAt: Date.now(),
    readAt: undefined,
  }
  return { item, loud: shouldNotify(itemSeverity(item), threshold) }
}
