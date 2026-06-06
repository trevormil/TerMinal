import type { HitlSource } from './hitl'

export const hitlActivityKind = (source: HitlSource): 'blocked' | 'task-complete' =>
  source === 'completion-hook' ? 'task-complete' : 'blocked'

export const hitlNotifyKind = (source: HitlSource): 'done' | 'blocked' =>
  source === 'completion-hook' ? 'done' : 'blocked'

export function hitlTelegramText(item: { source: HitlSource; title: string; action?: string }): string {
  const done = item.source === 'completion-hook'
  return `${done ? '✅ Done' : '⛔ HITL'} · ${item.title}${item.action ? ` — ${item.action}` : ''}`
}

export function hitlTelegramKeyboard(item: { id: string; runId?: string }): { text: string; callback_data: string }[][] {
  const row: { text: string; callback_data: string }[] = [
    { text: '✅ Resolve', callback_data: `hitl:resolve:${item.id}` },
  ]
  if (item.runId) row.push({ text: '🪵 Tail run', callback_data: `run:tail:${item.runId}` })
  return [row]
}
